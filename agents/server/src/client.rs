use crate::identity::StoredIdentity;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{SecondsFormat, Utc};
use ed25519_dalek::{Signer, SigningKey};
use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::{Map, Value};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("runner identity is invalid: {0}")]
    Identity(String),
    #[error("control-plane request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("control plane rejected the runner request with status {0}")]
    Rejected(StatusCode),
}

pub struct DeviceClient {
    base_url: String,
    client: Client,
    identity: StoredIdentity,
    signing_key: SigningKey,
}

impl DeviceClient {
    pub fn new(
        base_url: &str,
        client: Client,
        identity: StoredIdentity,
    ) -> Result<Self, ClientError> {
        let signing_key = identity.signing_key().map_err(ClientError::Identity)?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            client,
            identity,
            signing_key,
        })
    }

    pub async fn heartbeat(
        &self,
        current_workload: u16,
        status: RunnerStatus,
    ) -> Result<(), ClientError> {
        self.post(
            "/v1/runner/heartbeat",
            serde_json::json!({ "currentWorkload": current_workload, "status": status }),
        )
        .await
    }

    async fn post(&self, path: &str, body: Value) -> Result<(), ClientError> {
        let request_time = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let nonce = Uuid::new_v4().simple().to_string();
        let canonical = canonical_request(
            &self.identity.runner_id,
            &self.identity.key_id,
            &request_time,
            &nonce,
            "POST",
            path,
            &body,
        );
        let signature = BASE64.encode(self.signing_key.sign(&canonical).to_bytes());
        let response = self
            .client
            .post(format!("{}{path}", self.base_url))
            .header("x-sandbox-runner-id", &self.identity.runner_id)
            .header("x-sandbox-key-id", &self.identity.key_id)
            .header("x-sandbox-request-time", request_time)
            .header("x-sandbox-request-nonce", nonce)
            .header("x-sandbox-signature", signature)
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ClientError::Rejected(response.status()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunnerStatus {
    Online,
    Draining,
}

fn canonical_request(
    runner_id: &str,
    key_id: &str,
    request_time: &str,
    nonce: &str,
    method: &str,
    path: &str,
    body: &Value,
) -> Vec<u8> {
    let value = serde_json::json!({ "runnerId": runner_id, "keyId": key_id, "requestTime": request_time, "nonce": nonce, "method": method, "path": path, "body": body });
    serde_json::to_vec(&sort_value(value)).expect("canonical request is serializable")
}

fn sort_value(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(sort_value).collect()),
        Value::Object(values) => {
            let mut entries: Vec<_> = values.into_iter().collect();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            Value::Object(Map::from_iter(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, sort_value(value))),
            ))
        }
        value => value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    #[test]
    fn canonical_request_sorts_nested_objects_and_signs() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let request = canonical_request(
            "11111111-1111-4111-8111-111111111111",
            "device-1",
            "2026-08-27T12:00:00.000Z",
            "unique-request-nonce-1",
            "POST",
            "/v1/runner/heartbeat",
            &serde_json::json!({ "status": "online", "currentWorkload": 0, "nested": { "z": 1, "a": 2 } }),
        );
        assert_eq!(
            String::from_utf8(request.clone()).unwrap(),
            r#"{"body":{"currentWorkload":0,"nested":{"a":2,"z":1},"status":"online"},"keyId":"device-1","method":"POST","nonce":"unique-request-nonce-1","path":"/v1/runner/heartbeat","requestTime":"2026-08-27T12:00:00.000Z","runnerId":"11111111-1111-4111-8111-111111111111"}"#
        );
        let signature = key.sign(&request);
        key.verifying_key().verify(&request, &signature).unwrap();
    }
}
