use base64::{engine::general_purpose::STANDARD as BASE64,Engine};
use ed25519_dalek::{pkcs8::EncodePublicKey,SigningKey};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{fs,path::Path};

#[derive(Debug,Serialize,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct StoredIdentity{pub runner_id:String,pub key_id:String,pub private_key_base64:String}
impl StoredIdentity{pub fn create_request()->Result<(SigningKey,String,String),String>{let key=SigningKey::from_bytes(&rand::random::<[u8;32]>());let der=key.verifying_key().to_public_key_der().map_err(|error|error.to_string())?;let fingerprint=Sha256::digest(der.as_bytes()).iter().map(|byte|format!("{byte:02x}")).collect::<String>();Ok((key,BASE64.encode(der.as_bytes()),fingerprint))}pub fn save(&self,path:&Path)->Result<(),String>{let data=serde_json::to_vec(self).map_err(|error|error.to_string())?;fs::write(path,data).map_err(|error|error.to_string())?;set_private_permissions(path)?;Ok(())}}
#[cfg(unix)]fn set_private_permissions(path:&Path)->Result<(),String>{use std::os::unix::fs::PermissionsExt;fs::set_permissions(path,fs::Permissions::from_mode(0o600)).map_err(|error|error.to_string())}
#[cfg(not(unix))]fn set_private_permissions(_path:&Path)->Result<(),String>{Ok(())}
