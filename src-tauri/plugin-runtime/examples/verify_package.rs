use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ed25519_dalek::VerifyingKey;
use sandbox_plugin_runtime::{PackageTrustStore, RevocationList, VerifiedPackage};
use semver::Version;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.len() != 6 {
        return Err("usage: verify_package <package> <publisher-id> <key-id> <raw-public-key-base64> <host-version>".into());
    }
    let key_bytes: [u8; 32] = BASE64.decode(&arguments[4])?.try_into().map_err(|_| "Ed25519 public key must contain 32 bytes")?;
    let mut trust = PackageTrustStore::default();
    trust.insert(&arguments[2], &arguments[3], VerifyingKey::from_bytes(&key_bytes)?);
    let verified = VerifiedPackage::from_bytes(
        &std::fs::read(&arguments[1])?,
        &trust,
        &RevocationList::default(),
        &Version::parse(&arguments[5])?,
    )?;
    println!("{}@{} {}", verified.manifest.plugin_id, verified.manifest.version, verified.digest);
    Ok(())
}
