use crate::identity::StoredIdentity;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{SecondsFormat, Utc};
use ed25519_dalek::{Signer, SigningKey};
use reqwest::{Client, Method, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;
use url::Url;

const MAX_PLUGIN_PACKAGE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("runner identity is invalid: {0}")]
    Identity(String),
    #[error("control-plane request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("control plane rejected the runner request with status {0}")]
    Rejected(StatusCode),
    #[error("control-plane response was invalid: {0}")]
    Response(String),
    #[error("plugin package download was rejected: {0}")]
    PackageDownload(String),
}

#[derive(Clone)]
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
        self.post::<Value>(
            "/v1/runner/heartbeat",
            serde_json::json!({ "currentWorkload": current_workload, "status": status }),
        )
        .await
        .map(|_| ())
    }

    pub async fn commands(&self, limit: u16) -> Result<Vec<RunnerCommand>, ClientError> {
        let path = format!("/v1/runner/commands?limit={}", limit.clamp(1, 50));
        self.request::<CommandPage>(Method::GET, &path, Value::Null)
            .await
            .map(|page| page.items)
    }

    pub async fn command_status(
        &self,
        command_id: &str,
        status: CommandStatus,
        result_summary: Option<Value>,
    ) -> Result<(), ClientError> {
        self.post::<Value>(
            &format!("/v1/runner/commands/{command_id}/status"),
            serde_json::json!({ "status": status, "resultSummary": result_summary }),
        )
        .await
        .map(|_| ())
    }

    pub async fn download_plugin_package(&self, download_url: &str) -> Result<Vec<u8>, ClientError> {
        let url = Url::parse(download_url).map_err(|_| ClientError::PackageDownload("URL is invalid".into()))?;
        let control = Url::parse(&self.base_url).map_err(|_| ClientError::PackageDownload("control-plane URL is invalid".into()))?;
        if url.scheme() != "https" && !(url.scheme() == "http" && control.host_str() == Some("localhost") && url.host_str() == Some("localhost")) {
            return Err(ClientError::PackageDownload("URL must use HTTPS".into()));
        }
        let response = self.client.get(url).send().await?;
        if !response.status().is_success() { return Err(ClientError::Rejected(response.status())); }
        if response.content_length().is_some_and(|size| size > MAX_PLUGIN_PACKAGE_BYTES as u64) {
            return Err(ClientError::PackageDownload("package exceeds 32 MB".into()));
        }
        let bytes = response.bytes().await?;
        if bytes.len() > MAX_PLUGIN_PACKAGE_BYTES { return Err(ClientError::PackageDownload("package exceeds 32 MB".into())); }
        Ok(bytes.to_vec())
    }

    pub async fn trigger_events(&self, events: Vec<RunnerTriggerEvent>) -> Result<TriggerEventAcknowledgement, ClientError> {
        self.post("/v1/runner/trigger-events", serde_json::json!({ "events": events })).await
    }

    async fn post<T: DeserializeOwned>(&self, path: &str, body: Value) -> Result<T, ClientError> {
        self.request(Method::POST, path, body).await
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Value,
    ) -> Result<T, ClientError> {
        let request_time = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let nonce = Uuid::new_v4().simple().to_string();
        let canonical = canonical_request(
            &self.identity.runner_id,
            &self.identity.key_id,
            &request_time,
            &nonce,
            method.as_str(),
            path,
            &body,
        );
        let signature = BASE64.encode(self.signing_key.sign(&canonical).to_bytes());
        let request = self
            .client
            .request(method, format!("{}{path}", self.base_url))
            .header("x-sandbox-runner-id", &self.identity.runner_id)
            .header("x-sandbox-key-id", &self.identity.key_id)
            .header("x-sandbox-request-time", request_time)
            .header("x-sandbox-request-nonce", nonce)
            .header("x-sandbox-signature", signature);
        let request = if body.is_null() {
            request
        } else {
            request.json(&body)
        };
        let response = request.send().await?;
        if !response.status().is_success() {
            return Err(ClientError::Rejected(response.status()));
        }
        response
            .json::<T>()
            .await
            .map_err(|error| ClientError::Response(error.to_string()))
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunnerStatus {
    Online,
    Draining,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    Accepted,
    Rejected,
    Completed,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerCommand {
    pub command_id: String,
    pub issuer_account_id: String,
    pub workspace_id: String,
    pub target_runner_id: String,
    pub action: RunnerCommandAction,
    pub workflow_revision_id: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    pub idempotency_key: String,
    pub payload: Value,
    pub authorization_context: RunnerAuthorizationContext,
    pub key_id: String,
    pub signature: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerAuthorizationContext {
    pub principal_type: String,
    pub principal_id: String,
    pub credential_id: Option<String>,
    pub required_permission: String,
    pub environment_id: String,
    pub environment: String,
    pub credential_scopes: Option<Vec<String>>,
    pub workspace_restrictions: Option<Vec<String>>,
    pub environment_restrictions: Option<Vec<String>>,
    pub principal_permissions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunnerCommandAction {
    RunWorkflow,
    CancelExecution,
    PauseWorkflow,
    ResumeWorkflow,
    RequestDiagnostics,
    SyncRevision,
}

#[derive(Deserialize)]
struct CommandPage {
    items: Vec<RunnerCommand>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerTriggerEvent {
    pub event_id: String,
    pub deployment_id: String,
    pub workflow_revision_id: String,
    pub node_id: String,
    pub plugin_id: String,
    pub plugin_version: String,
    pub dedupe_key: String,
    pub occurred_at: String,
    pub payload: Value,
    pub provider_checkpoint: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerEventAcknowledgement {
    pub accepted_event_ids: Vec<String>,
    pub duplicate_event_ids: Vec<String>,
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
    use wiremock::{
        matchers::{header_exists, method, path, query_param},
        Mock, MockServer, ResponseTemplate,
    };

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

    #[tokio::test]
    async fn polls_and_reports_commands_with_signed_device_requests() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/runner/commands"))
            .and(query_param("limit", "1"))
            .and(header_exists("x-sandbox-signature"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"items":[{
                "commandId":"11111111-1111-4111-8111-111111111111","issuerAccountId":"22222222-2222-4222-8222-222222222222",
                "workspaceId":"33333333-3333-4333-8333-333333333333","targetRunnerId":"44444444-4444-4444-8444-444444444444",
                "action":"run_workflow","workflowRevisionId":"55555555-5555-4555-8555-555555555555","createdAt":"2026-08-28T00:00:00Z",
                "expiresAt":"2026-08-29T00:00:00Z","idempotencyKey":"idempotency-key-0001","payload":{},"keyId":"release","signature":"signed","status":"delivered"
                ,"authorizationContext":{"principalType":"user","principalId":"22222222-2222-4222-8222-222222222222","credentialId":null,"requiredPermission":"workflows.run","environmentId":"55555555-5555-4555-8555-555555555556","environment":"production","credentialScopes":null,"workspaceRestrictions":null,"environmentRestrictions":null,"principalPermissions":null}
            }]})))
            .mount(&server).await;
        Mock::given(method("POST"))
            .and(path(
                "/v1/runner/commands/11111111-1111-4111-8111-111111111111/status",
            ))
            .and(header_exists("x-sandbox-signature"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"updated":true})),
            )
            .mount(&server)
            .await;
        let key = SigningKey::from_bytes(&[7; 32]);
        let identity = StoredIdentity {
            runner_id: "44444444-4444-4444-8444-444444444444".into(),
            key_id: "device".into(),
            private_key_base64: BASE64.encode(key.to_bytes()),
        };
        let client = DeviceClient::new(&server.uri(), Client::new(), identity).unwrap();
        let commands = client.commands(1).await.unwrap();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].action, RunnerCommandAction::RunWorkflow);
        client
            .command_status(&commands[0].command_id, CommandStatus::Accepted, None)
            .await
            .unwrap();
    }
}
