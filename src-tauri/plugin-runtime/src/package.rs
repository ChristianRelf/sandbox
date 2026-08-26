use crate::{manifest::canonical_manifest, manifest::safe_relative_path, Manifest, PluginError};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ed25519_dalek::{Signature as Ed25519Signature, Verifier, VerifyingKey};
use semver::Version;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    io::{Cursor, Read},
};
use zip::ZipArchive;

const MAX_PACKAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: usize = 256;

#[derive(Default)]
pub struct PackageTrustStore {
    keys: HashMap<(String, String), VerifyingKey>,
}

impl PackageTrustStore {
    pub fn insert(
        &mut self,
        publisher_id: impl Into<String>,
        key_id: impl Into<String>,
        key: VerifyingKey,
    ) {
        self.keys.insert((publisher_id.into(), key_id.into()), key);
    }

    fn key(&self, publisher_id: &str, key_id: &str) -> Option<&VerifyingKey> {
        self.keys
            .get(&(publisher_id.to_string(), key_id.to_string()))
    }
}

#[derive(Default)]
pub struct RevocationList {
    revoked_versions: HashSet<(String, Version)>,
    revoked_integrities: HashSet<String>,
}

impl RevocationList {
    pub fn revoke_version(&mut self, plugin_id: impl Into<String>, version: Version) {
        self.revoked_versions.insert((plugin_id.into(), version));
    }

    pub fn revoke_integrity(&mut self, integrity: impl Into<String>) {
        self.revoked_integrities.insert(integrity.into());
    }

    pub fn is_revoked(&self, manifest: &Manifest) -> bool {
        self.revoked_versions
            .contains(&(manifest.plugin_id.clone(), manifest.version.clone()))
            || self
                .revoked_integrities
                .contains(&manifest.package_integrity)
    }
}

#[derive(Debug)]
pub struct VerifiedPackage {
    pub manifest: Manifest,
    pub files: BTreeMap<String, Vec<u8>>,
    pub digest: String,
}

impl VerifiedPackage {
    pub fn from_bytes(
        bytes: &[u8],
        trust: &PackageTrustStore,
        revocations: &RevocationList,
        host_version: &Version,
    ) -> Result<Self, PluginError> {
        if bytes.len() > MAX_PACKAGE_BYTES {
            return Err(PluginError::Package(
                "Package exceeds the 32 MB limit.".into(),
            ));
        }
        let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|error| {
            PluginError::Package(format!("Package is not a valid ZIP archive: {error}"))
        })?;
        if archive.len() == 0 || archive.len() > MAX_ENTRIES {
            return Err(PluginError::Package(
                "Package must contain between 1 and 256 files.".into(),
            ));
        }
        let mut files = BTreeMap::new();
        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .map_err(|error| PluginError::Package(error.to_string()))?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().to_string();
            if !safe_relative_path(&name) {
                return Err(PluginError::Package(format!(
                    "Unsafe package path '{name}'."
                )));
            }
            if file.size() > MAX_FILE_BYTES {
                return Err(PluginError::Package(format!(
                    "Package file '{name}' exceeds 16 MB."
                )));
            }
            let mut contents = Vec::with_capacity(file.size() as usize);
            file.read_to_end(&mut contents)
                .map_err(|error| PluginError::Package(error.to_string()))?;
            if files.insert(name.clone(), contents).is_some() {
                return Err(PluginError::Package(format!(
                    "Duplicate package path '{name}'."
                )));
            }
        }
        let manifest_bytes = files
            .get("manifest.json")
            .ok_or_else(|| PluginError::Package("Package has no manifest.json.".into()))?;
        let manifest: Manifest = serde_json::from_slice(manifest_bytes).map_err(|error| {
            PluginError::Package(format!("Manifest is not valid JSON: {error}"))
        })?;
        let validation = manifest.validate(host_version, true);
        if !validation.valid {
            return Err(PluginError::Manifest(validation.errors.join(" ")));
        }
        validate_contents(&manifest, &files)?;
        let digest = format!("sha256:{}", hex_digest(&package_digest(&manifest, &files)?));
        if digest != manifest.package_integrity {
            return Err(PluginError::Package(format!(
                "Package integrity mismatch: expected {}, calculated {digest}.",
                manifest.package_integrity
            )));
        }
        if revocations.is_revoked(&manifest) {
            return Err(PluginError::Package(format!(
                "{} {} has been revoked and cannot execute.",
                manifest.plugin_id, manifest.version
            )));
        }
        let key = trust
            .key(&manifest.publisher_id, &manifest.signature.key_id)
            .ok_or_else(|| PluginError::Package("Publisher signing key is not trusted.".into()))?;
        let signature_bytes = BASE64
            .decode(&manifest.signature.value)
            .map_err(|_| PluginError::Package("Package signature is not valid base64.".into()))?;
        let signature = Ed25519Signature::from_slice(&signature_bytes)
            .map_err(|_| PluginError::Package("Package signature has an invalid length.".into()))?;
        let digest_bytes = digest
            .strip_prefix("sha256:")
            .and_then(decode_hex)
            .ok_or_else(|| PluginError::Package("Package digest is invalid.".into()))?;
        key.verify(&digest_bytes, &signature)
            .map_err(|_| PluginError::Package("Publisher signature verification failed.".into()))?;
        Ok(Self {
            manifest,
            files,
            digest,
        })
    }

    pub fn entrypoint(&self, id: &str) -> Result<&[u8], PluginError> {
        let entrypoint = self
            .manifest
            .entrypoints
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| PluginError::Package(format!("Entrypoint '{id}' is not declared.")))?;
        self.files
            .get(&entrypoint.path)
            .map(Vec::as_slice)
            .ok_or_else(|| {
                PluginError::Package(format!("Entrypoint file '{}' is missing.", entrypoint.path))
            })
    }
}

pub fn package_digest(
    manifest: &Manifest,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<[u8; 32], PluginError> {
    let mut hasher = Sha256::new();
    hasher.update(b"SANDBOX-PLUGIN-PACKAGE-V1\0");
    add_digest_entry(&mut hasher, "manifest.json", &canonical_manifest(manifest)?);
    for (name, contents) in files {
        if name == "manifest.json" {
            continue;
        }
        add_digest_entry(&mut hasher, name, contents);
    }
    Ok(hasher.finalize().into())
}

fn add_digest_entry(hasher: &mut Sha256, name: &str, contents: &[u8]) {
    hasher.update((name.len() as u64).to_be_bytes());
    hasher.update(name.as_bytes());
    hasher.update((contents.len() as u64).to_be_bytes());
    hasher.update(contents);
}

fn validate_contents(
    manifest: &Manifest,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PluginError> {
    let declared_wasm: BTreeSet<_> = manifest
        .entrypoints
        .iter()
        .map(|item| item.path.as_str())
        .collect();
    for path in &declared_wasm {
        if !files.contains_key(*path) {
            return Err(PluginError::Package(format!(
                "Declared entrypoint file '{path}' is missing."
            )));
        }
    }
    let icon = manifest.icon.as_str();
    if !files.contains_key(icon) {
        return Err(PluginError::Package(format!(
            "Declared icon '{icon}' is missing."
        )));
    }
    for name in files.keys() {
        if name == "manifest.json" || declared_wasm.contains(name.as_str()) || name == icon {
            continue;
        }
        let extension = name
            .rsplit_once('.')
            .map(|(_, extension)| extension.to_ascii_lowercase())
            .unwrap_or_default();
        let allowed = match extension.as_str() {
            "md" => name.starts_with("docs/") || name.starts_with("examples/"),
            "json" => {
                name.starts_with("migrations/")
                    || name.starts_with("locales/")
                    || name.starts_with("examples/")
            }
            "png" | "jpg" | "jpeg" | "webp" | "svg" => name.starts_with("assets/"),
            _ => false,
        };
        if !allowed {
            return Err(PluginError::Package(format!(
                "Package contains undeclared executable or unsupported content '{name}'."
            )));
        }
    }
    Ok(())
}

fn hex_digest(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::tests::manifest;
    use ed25519_dalek::{Signer, SigningKey};
    use std::io::Write;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    fn package(
        mut manifest: Manifest,
        signing: &SigningKey,
        mutate_after_signing: bool,
    ) -> Vec<u8> {
        let component = if mutate_after_signing {
            b"tampered".to_vec()
        } else {
            b"wasm".to_vec()
        };
        let original_component = b"wasm".to_vec();
        let icon = b"<svg/>".to_vec();
        let mut files = BTreeMap::from([
            ("components/main.wasm".into(), original_component),
            ("assets/icon.svg".into(), icon),
        ]);
        let digest = package_digest(&manifest, &files).unwrap();
        manifest.package_integrity = format!("sha256:{}", hex_digest(&digest));
        manifest.signature.value = BASE64.encode(signing.sign(&digest).to_bytes());
        files.insert("components/main.wasm".into(), component);
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("manifest.json", options).unwrap();
        writer
            .write_all(&serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        for (name, contents) in files {
            writer.start_file(name, options).unwrap();
            writer.write_all(&contents).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn verifies_signature_integrity_and_revocation() {
        let signing = SigningKey::from_bytes(&[7; 32]);
        let manifest = manifest();
        let bytes = package(manifest.clone(), &signing, false);
        let mut trust = PackageTrustStore::default();
        trust.insert(
            &manifest.publisher_id,
            &manifest.signature.key_id,
            signing.verifying_key(),
        );
        let verified = VerifiedPackage::from_bytes(
            &bytes,
            &trust,
            &RevocationList::default(),
            &Version::new(0, 3, 0),
        )
        .unwrap();
        assert_eq!(verified.manifest.version, Version::new(1, 0, 0));
        let mut revoked = RevocationList::default();
        revoked.revoke_integrity(verified.digest);
        assert!(
            VerifiedPackage::from_bytes(&bytes, &trust, &revoked, &Version::new(0, 3, 0))
                .unwrap_err()
                .to_string()
                .contains("revoked")
        );
    }

    #[test]
    fn rejects_tampered_package() {
        let signing = SigningKey::from_bytes(&[11; 32]);
        let manifest = manifest();
        let bytes = package(manifest.clone(), &signing, true);
        let mut trust = PackageTrustStore::default();
        trust.insert(
            &manifest.publisher_id,
            &manifest.signature.key_id,
            signing.verifying_key(),
        );
        assert!(VerifiedPackage::from_bytes(
            &bytes,
            &trust,
            &RevocationList::default(),
            &Version::new(0, 3, 0)
        )
        .unwrap_err()
        .to_string()
        .contains("integrity mismatch"));
    }
}
