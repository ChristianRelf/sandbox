use keyring::v1::Entry;
use serde_json::Value;
use zeroize::Zeroizing;

const SERVICE: &str = "com.sandbox.desktop.credentials";
const MAX_SECRET_BYTES: usize = 64 * 1024;

pub trait CredentialVault: Send + Sync {
    fn put(&self, credential_id: &str, secret: &Value) -> Result<(), String>;
    fn get(&self, credential_id: &str) -> Result<Value, String>;
    fn delete(&self, credential_id: &str) -> Result<(), String>;
    fn exists(&self, credential_id: &str) -> Result<bool, String>;
}

#[derive(Default)]
pub struct OsCredentialVault;

impl OsCredentialVault {
    pub fn new() -> Self {
        Self
    }

    fn entry(credential_id: &str) -> Result<Entry, String> {
        validate_id(credential_id)?;
        Entry::new(SERVICE, &format!("credential:{credential_id}")).map_err(|error| {
            format!("The operating-system credential store is unavailable: {error}")
        })
    }
}

impl CredentialVault for OsCredentialVault {
    fn put(&self, credential_id: &str, secret: &Value) -> Result<(), String> {
        let encoded = Zeroizing::new(
            serde_json::to_vec(secret)
                .map_err(|error| format!("Credential data is invalid: {error}"))?,
        );
        if encoded.len() > MAX_SECRET_BYTES {
            return Err("Credential material exceeds the 64 KB vault limit.".into());
        }
        Self::entry(credential_id)?
            .set_secret(encoded.as_slice())
            .map_err(|error| format!("The credential could not be stored securely: {error}"))
    }

    fn get(&self, credential_id: &str) -> Result<Value, String> {
        let encoded =
            Zeroizing::new(Self::entry(credential_id)?.get_secret().map_err(|error| {
                format!("The credential is unavailable or requires reconnection: {error}")
            })?);
        serde_json::from_slice(encoded.as_slice())
            .map_err(|_| "Stored credential data is corrupt. Reconnect the account.".into())
    }

    fn delete(&self, credential_id: &str) -> Result<(), String> {
        Self::entry(credential_id)?
            .delete_credential()
            .map_err(|error| {
                format!(
                    "The credential could not be removed from the operating-system store: {error}"
                )
            })
    }

    fn exists(&self, credential_id: &str) -> Result<bool, String> {
        match Self::entry(credential_id)?.get_secret() {
            Ok(mut secret) => {
                use zeroize::Zeroize;
                secret.zeroize();
                Ok(true)
            }
            Err(keyring::v1::Error::NoEntry) => Ok(false),
            Err(error) => Err(format!(
                "The operating-system credential store could not be checked: {error}"
            )),
        }
    }
}

fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("Credential identifier is invalid.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_credential_identifiers() {
        assert!(validate_id("gmail_123-a").is_ok());
        assert!(validate_id("../credential").is_err());
        assert!(validate_id("").is_err());
    }
    #[test]
    fn limits_secret_size_before_touching_os_store() {
        let vault = OsCredentialVault::new();
        let value = Value::String("x".repeat(MAX_SECRET_BYTES + 1));
        assert!(vault
            .put("oversized", &value)
            .unwrap_err()
            .contains("64 KB"));
    }
}
