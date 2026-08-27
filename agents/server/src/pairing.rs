use crate::{config::RunnerConfig,identity::StoredIdentity,ENGINE_VERSION,PLUGIN_RUNTIME_VERSION,RUNNER_PROTOCOL_VERSION};
use base64::{engine::general_purpose::STANDARD as BASE64,Engine};
use chrono::Utc;
use ed25519_dalek::Signer;
use serde::{Deserialize,Serialize};

#[derive(Debug,Serialize)]#[serde(rename_all="camelCase")]struct ChallengeRequest<'a>{device_public_key_der_base64:&'a str,operating_system:&'static str,architecture:&'static str,application_version:&'static str,protocol_version:u16,plugin_runtime_version:&'static str,capabilities:serde_json::Value,safe_folder_labels:Vec<String>,browser_engine:Option<serde_json::Value>,installed_plugin_versions:Vec<serde_json::Value>,tags:&'a[String]}
#[derive(Debug,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct ChallengeResponse{challenge_id:String,challenge:String,expires_at:String}
#[derive(Debug,Serialize)]#[serde(rename_all="camelCase")]struct ConfirmationRequest<'a>{challenge_id:&'a str,challenge:&'a str,signature_base64:String,workspace_id:&'a str,display_name:&'a str}
#[derive(Debug,Deserialize)]#[serde(rename_all="camelCase")]struct PairResponse{runner:PairedRunner}
#[derive(Debug,Deserialize)]#[serde(rename_all="camelCase")]struct PairedRunner{runner_id:String}

pub async fn pair(config:&RunnerConfig,token:&str)->Result<(StoredIdentity,String),String>{
 if token.trim().len()<24{return Err("Pairing token is invalid.".into());}
 let(key,public_key,fingerprint)=StoredIdentity::create_request()?;let client=reqwest::Client::new();let base=config.control_plane_url.trim_end_matches('/');
 let capabilities=serde_json::json!({"runnerType":"self_hosted_server","environment":config.environment,"concurrency":config.concurrency,"managedChromium":config.enable_managed_chromium,"simpleCommands":config.allow_simple_commands,"approvedNetworkTargets":config.approved_network_targets});
 let request=ChallengeRequest{device_public_key_der_base64:&public_key,operating_system:"linux",architecture:std::env::consts::ARCH,application_version:ENGINE_VERSION,protocol_version:RUNNER_PROTOCOL_VERSION,plugin_runtime_version:PLUGIN_RUNTIME_VERSION,capabilities,safe_folder_labels:config.allowed_working_directories.iter().map(|value|value.display().to_string()).collect(),browser_engine:None,installed_plugin_versions:vec![],tags:&config.tags};
 let challenged=client.post(format!("{base}/v1/runners/pairing/challenges")).bearer_auth(token).header("x-sandbox-request-time",Utc::now().to_rfc3339()).json(&request).send().await.map_err(|error|error.to_string())?;if !challenged.status().is_success(){return Err(format!("Pairing challenge failed with status {}.",challenged.status()));}let challenge:ChallengeResponse=challenged.json().await.map_err(|error|error.to_string())?;if chrono::DateTime::parse_from_rfc3339(&challenge.expires_at).map_err(|_|"Pairing challenge expiry is invalid.")?<=Utc::now(){return Err("Pairing challenge expired.".into());}
 let signature=BASE64.encode(key.sign(challenge.challenge.as_bytes()).to_bytes());let confirmation=ConfirmationRequest{challenge_id:&challenge.challenge_id,challenge:&challenge.challenge,signature_base64:signature,workspace_id:&config.workspace_id,display_name:&config.runner_name};let confirmed=client.post(format!("{base}/v1/runners/pairing/confirm")).bearer_auth(token).header("x-sandbox-request-time",Utc::now().to_rfc3339()).json(&confirmation).send().await.map_err(|error|error.to_string())?;if !confirmed.status().is_success(){return Err(format!("Pairing confirmation failed with status {}.",confirmed.status()));}let paired:PairResponse=confirmed.json().await.map_err(|error|error.to_string())?;
 Ok((StoredIdentity{runner_id:paired.runner.runner_id.clone(),key_id:format!("device-{}",paired.runner.runner_id),private_key_base64:BASE64.encode(key.to_bytes())},fingerprint))
}
