use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ed25519_dalek::{pkcs8::EncodePublicKey, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredIdentity {
    pub runner_id: String,
    pub key_id: String,
    pub private_key_base64: String,
}

impl StoredIdentity {
    pub fn create_request() -> Result<(SigningKey, String, String), String> {
        let key = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
        let der = key
            .verifying_key()
            .to_public_key_der()
            .map_err(|error| error.to_string())?;
        let fingerprint = Sha256::digest(der.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        Ok((key, BASE64.encode(der.as_bytes()), fingerprint))
    }
    pub fn load(path: &Path) -> Result<Self, String> {
        let identity: Self =
            serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        identity.signing_key()?;
        Ok(identity)
    }
    pub fn signing_key(&self) -> Result<SigningKey, String> {
        let decoded = BASE64
            .decode(&self.private_key_base64)
            .map_err(|_| "private key is not valid base64".to_owned())?;
        let bytes: [u8; 32] = decoded
            .try_into()
            .map_err(|_| "private key must contain exactly 32 bytes".to_owned())?;
        Ok(SigningKey::from_bytes(&bytes))
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let data = serde_json::to_vec(self).map_err(|error| error.to_string())?;
        write_private_new(path, &data)
    }
}

#[cfg(unix)]
fn write_private_new(path: &Path, data: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(data).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}
#[cfg(not(unix))]
fn write_private_new(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(data).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_identity_round_trips_and_loads_its_signing_key() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("identity.json");
        let (key, _, _) = StoredIdentity::create_request().unwrap();
        let identity = StoredIdentity {
            runner_id: "11111111-1111-4111-8111-111111111111".into(),
            key_id: "device-1".into(),
            private_key_base64: BASE64.encode(key.to_bytes()),
        };
        identity.save(&path).unwrap();
        assert_eq!(
            StoredIdentity::load(&path)
                .unwrap()
                .signing_key()
                .unwrap()
                .to_bytes(),
            key.to_bytes()
        );
    }
}
