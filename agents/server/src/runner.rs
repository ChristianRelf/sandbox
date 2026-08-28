use crate::{
    client::{CommandStatus, DeviceClient, RunnerCommand, RunnerCommandAction},
    config::RunnerConfig,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use ed25519_dalek::{pkcs8::DecodePublicKey, Signature, VerifyingKey};
use sandbox_engine::{Database, Engine, LocalHost, Workflow};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Arc};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct CommandVerifier {
    keys: BTreeMap<String, VerifyingKey>,
}

impl CommandVerifier {
    pub fn from_config(config: &RunnerConfig) -> Result<Self, String> {
        let mut keys = BTreeMap::new();
        for (key_id, encoded) in &config.command_signing_keys {
            let der = BASE64
                .decode(encoded)
                .map_err(|_| format!("command signing key '{key_id}' is not valid base64"))?;
            let key = VerifyingKey::from_public_key_der(&der).map_err(|_| {
                format!("command signing key '{key_id}' is not an Ed25519 SPKI key")
            })?;
            keys.insert(key_id.clone(), key);
        }
        Ok(Self { keys })
    }

    pub fn verify(
        &self,
        command: &RunnerCommand,
        runner_id: &str,
        workspace_id: &str,
        environment_id: &str,
        environment: &str,
    ) -> Result<VerifiedCommand, String> {
        if command.target_runner_id != runner_id || command.workspace_id != workspace_id {
            return Err("command target does not match this runner and workspace".into());
        }
        verify_authorization_context(command, workspace_id, environment_id, environment)?;
        let expires_at = DateTime::parse_from_rfc3339(&command.expires_at)
            .map_err(|_| "command expiry is invalid")?
            .with_timezone(&Utc);
        if expires_at <= Utc::now() {
            return Err("command has expired".into());
        }
        DateTime::parse_from_rfc3339(&command.created_at)
            .map_err(|_| "command creation time is invalid")?;
        let key = self
            .keys
            .get(&command.key_id)
            .ok_or_else(|| format!("command signing key '{}' is not trusted", command.key_id))?;
        let signature = Signature::from_slice(
            &BASE64
                .decode(&command.signature)
                .map_err(|_| "command signature is not valid base64")?,
        )
        .map_err(|_| "command signature length is invalid")?;
        key.verify_strict(&canonical_command(command)?, &signature)
            .map_err(|_| "command signature verification failed")?;

        match command.action {
            RunnerCommandAction::RunWorkflow => {
                let revision_id = command
                    .workflow_revision_id
                    .as_deref()
                    .ok_or("run command is missing its approved revision")?;
                let payload: RunWorkflowPayload =
                    serde_json::from_value(command.payload.clone())
                        .map_err(|error| format!("run command payload is invalid: {error}"))?;
                if payload.workflow_revision_id != revision_id {
                    return Err(
                        "embedded workflow revision does not match the signed command".into(),
                    );
                }
                let encoded = serde_json::to_vec(&payload.workflow)
                    .map_err(|error| format!("workflow could not be hashed: {error}"))?;
                let calculated = format!("sha256:{:x}", Sha256::digest(encoded));
                if payload.content_hash != calculated {
                    return Err("workflow content does not match the approved revision hash".into());
                }
                Ok(VerifiedCommand::RunWorkflow {
                    workflow: payload.workflow,
                    trigger: payload.trigger,
                    revision_id: revision_id.to_owned(),
                })
            }
            _ => Err("this runner does not support the requested command action".into()),
        }
    }
}

#[derive(Debug)]
pub enum VerifiedCommand {
    RunWorkflow {
        workflow: Workflow,
        trigger: Value,
        revision_id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunWorkflowPayload {
    workflow_revision_id: String,
    content_hash: String,
    workflow: Workflow,
    #[serde(default)]
    trigger: Value,
}

pub fn open_engine(config: &RunnerConfig) -> Result<Engine, String> {
    std::fs::create_dir_all(&config.data_directory).map_err(|error| error.to_string())?;
    let database = Database::open(config.data_directory.join("runner.sqlite3"))
        .map_err(|error| error.to_string())?;
    database
        .recover_unfinished()
        .map_err(|error| error.to_string())?;
    Ok(Engine::new(database, Arc::new(LocalHost)))
}

pub async fn process_command(
    device: &DeviceClient,
    engine: &Engine,
    verifier: &CommandVerifier,
    runner_id: &str,
    workspace_id: &str,
    environment_id: &str,
    environment: &str,
    command: RunnerCommand,
) {
    let verified = match verifier.verify(
        &command,
        runner_id,
        workspace_id,
        environment_id,
        environment,
    ) {
        Ok(command) => command,
        Err(error) => {
            let _ = device
                .command_status(
                    &command.command_id,
                    CommandStatus::Rejected,
                    Some(json!({ "reason": error })),
                )
                .await;
            return;
        }
    };
    let expires_at = match DateTime::parse_from_rfc3339(&command.expires_at) {
        Ok(value) => value.with_timezone(&Utc),
        Err(_) => return,
    };
    let database = engine.database();
    match database.remote_command_status(&command.command_id) {
        Ok(Some(status)) if status == "completed" => {
            let _ = device
                .command_status(
                    &command.command_id,
                    CommandStatus::Completed,
                    Some(json!({ "idempotentReplay": true })),
                )
                .await;
            return;
        }
        Ok(Some(_)) => {
            let _ = database.complete_remote_command(&command.command_id, "rejected");
            let _ = device
                .command_status(
                    &command.command_id,
                    CommandStatus::Rejected,
                    Some(json!({ "reason": "runner_restarted_before_completion" })),
                )
                .await;
            return;
        }
        Err(error) => {
            let _ = device
                .command_status(
                    &command.command_id,
                    CommandStatus::Rejected,
                    Some(json!({ "reason": error.to_string() })),
                )
                .await;
            return;
        }
        Ok(None) => {}
    }
    match database.claim_remote_command(
        &command.command_id,
        runner_id,
        workspace_id,
        &command.idempotency_key,
        expires_at,
    ) {
        Ok(true) => {}
        Ok(false) => {
            let _ = device
                .command_status(
                    &command.command_id,
                    CommandStatus::Rejected,
                    Some(json!({ "reason": "idempotency_key_already_claimed" })),
                )
                .await;
            return;
        }
        Err(error) => {
            let _ = device
                .command_status(
                    &command.command_id,
                    CommandStatus::Rejected,
                    Some(json!({ "reason": error.to_string() })),
                )
                .await;
            return;
        }
    }
    if let Err(error) = device
        .command_status(
            &command.command_id,
            CommandStatus::Accepted,
            Some(json!({ "revisionId": command.workflow_revision_id })),
        )
        .await
    {
        let _ = database.complete_remote_command(&command.command_id, "rejected");
        eprintln!("failed to accept command {}: {error}", command.command_id);
        return;
    }

    let (status, receipt_status, summary) = match verified {
        VerifiedCommand::RunWorkflow {
            workflow,
            trigger,
            revision_id,
        } => match engine.database().save_workflow(workflow) {
            Err(error) => (
                CommandStatus::Rejected,
                "rejected",
                json!({ "revisionId": revision_id, "reason": error.to_string() }),
            ),
            Ok(workflow) => match engine
                .run(workflow, trigger, CancellationToken::new())
                .await
            {
                Ok(record) => {
                    let failed_node_id = record
                        .node_executions
                        .iter()
                        .find(|node| matches!(node.status, sandbox_engine::NodeStatus::Failed))
                        .map(|node| node.node_id.clone());
                    (
                        CommandStatus::Completed,
                        "completed",
                        json!({
                            "revisionId": revision_id, "executionId": record.id, "status": record.status,
                            "startedAt": record.started_at, "durationMs": record.duration_ms, "failedNodeId": failed_node_id,
                            "errorCode": record.error.map(|error| error.code)
                        }),
                    )
                }
                Err(error) => (
                    CommandStatus::Rejected,
                    "rejected",
                    json!({ "revisionId": revision_id, "reason": error.to_string() }),
                ),
            },
        },
    };
    if let Err(error) = database.complete_remote_command(&command.command_id, receipt_status) {
        eprintln!(
            "failed to persist command {} completion: {error}",
            command.command_id
        );
        return;
    }
    if let Err(error) = device
        .command_status(&command.command_id, status, Some(summary))
        .await
    {
        eprintln!(
            "failed to report command {} completion: {error}",
            command.command_id
        );
    }
}

fn canonical_command(command: &RunnerCommand) -> Result<Vec<u8>, String> {
    let value = json!({
        "commandId": command.command_id,
        "issuerAccountId": command.issuer_account_id,
        "workspaceId": command.workspace_id,
        "targetRunnerId": command.target_runner_id,
        "action": command.action,
        "workflowRevisionId": command.workflow_revision_id,
        "createdAt": command.created_at,
        "expiresAt": command.expires_at,
        "idempotencyKey": command.idempotency_key,
        "payload": command.payload,
        "authorizationContext": command.authorization_context,
        "keyId": command.key_id,
    });
    serde_json::to_vec(&sort_value(value)).map_err(|error| error.to_string())
}

fn verify_authorization_context(
    command: &RunnerCommand,
    workspace_id: &str,
    environment_id: &str,
    environment: &str,
) -> Result<(), String> {
    let context = &command.authorization_context;
    let required = match command.action {
        RunnerCommandAction::RequestDiagnostics => "runners.manage",
        RunnerCommandAction::CancelExecution
        | RunnerCommandAction::PauseWorkflow
        | RunnerCommandAction::ResumeWorkflow => "workflows.pause",
        RunnerCommandAction::RunWorkflow | RunnerCommandAction::SyncRevision => "workflows.run",
    };
    if context.required_permission != required {
        return Err("authorization permission does not match the command action".into());
    }
    if context.environment_id != environment_id || context.environment != environment {
        return Err("command environment does not match this runner".into());
    }
    if context
        .workspace_restrictions
        .as_ref()
        .is_some_and(|items| !items.is_empty() && !items.iter().any(|item| item == workspace_id))
    {
        return Err("credential is restricted to another workspace".into());
    }
    if context
        .environment_restrictions
        .as_ref()
        .is_some_and(|items| !items.is_empty() && !items.iter().any(|item| item == environment_id))
    {
        return Err("credential is restricted to another environment".into());
    }
    match context.principal_type.as_str() {
        "user" => {
            if context.credential_id.is_some() || context.principal_id != command.issuer_account_id
            {
                return Err("human authorization identity is inconsistent".into());
            }
        }
        "personal_access_token" => {
            if context.credential_id.is_none()
                || !context
                    .credential_scopes
                    .as_ref()
                    .is_some_and(|items| items.iter().any(|item| item == required))
            {
                return Err("credential scope does not authorize the command".into());
            }
        }
        "service_account" => {
            if context.credential_id.is_none()
                || !context
                    .credential_scopes
                    .as_ref()
                    .is_some_and(|items| items.iter().any(|item| item == required))
                || !context
                    .principal_permissions
                    .as_ref()
                    .is_some_and(|items| items.iter().any(|item| item == required))
            {
                return Err(
                    "service account role or credential scope does not authorize the command"
                        .into(),
                );
            }
        }
        _ => return Err("authorization principal type is unsupported".into()),
    }
    Ok(())
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
    use crate::client::RunnerAuthorizationContext;
    use crate::identity::StoredIdentity;
    use ed25519_dalek::{pkcs8::EncodePublicKey, Signer, SigningKey};
    use reqwest::Client;
    use wiremock::{
        matchers::{method, path_regex},
        Mock, MockServer, ResponseTemplate,
    };

    #[test]
    fn verifies_signature_target_and_exact_embedded_revision() {
        let key = SigningKey::from_bytes(&[9; 32]);
        let mut command = sample_command();
        command.signature =
            BASE64.encode(key.sign(&canonical_command(&command).unwrap()).to_bytes());
        let verifier = CommandVerifier {
            keys: BTreeMap::from([("release".into(), key.verifying_key())]),
        };
        assert!(verifier
            .verify(
                &command,
                &command.target_runner_id,
                &command.workspace_id,
                "77777777-7777-4777-8777-777777777777",
                "production"
            )
            .is_ok());
        command.payload["workflow"]["name"] = json!("Tampered");
        command.signature =
            BASE64.encode(key.sign(&canonical_command(&command).unwrap()).to_bytes());
        assert!(verifier
            .verify(
                &command,
                &command.target_runner_id,
                &command.workspace_id,
                "77777777-7777-4777-8777-777777777777",
                "production"
            )
            .unwrap_err()
            .contains("content"));
        command.payload["workflowRevisionId"] = json!("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        assert!(verifier
            .verify(
                &command,
                &command.target_runner_id,
                &command.workspace_id,
                "77777777-7777-4777-8777-777777777777",
                "production"
            )
            .is_err());
        let mut restricted = sample_command();
        restricted.authorization_context.environment_restrictions =
            Some(vec!["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into()]);
        restricted.signature = BASE64.encode(
            key.sign(&canonical_command(&restricted).unwrap())
                .to_bytes(),
        );
        assert!(verifier
            .verify(
                &restricted,
                &restricted.target_runner_id,
                &restricted.workspace_id,
                "77777777-7777-4777-8777-777777777777",
                "production"
            )
            .unwrap_err()
            .contains("restricted"));
        let der = key.verifying_key().to_public_key_der().unwrap();
        assert!(VerifyingKey::from_public_key_der(der.as_bytes()).is_ok());
    }

    #[tokio::test]
    async fn executes_once_and_replays_a_durable_completion() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"^/v1/runner/commands/.+/status$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"updated":true})))
            .mount(&server)
            .await;
        let device_key = SigningKey::from_bytes(&[7; 32]);
        let identity = StoredIdentity {
            runner_id: "44444444-4444-4444-8444-444444444444".into(),
            key_id: "device".into(),
            private_key_base64: BASE64.encode(device_key.to_bytes()),
        };
        let device = DeviceClient::new(&server.uri(), Client::new(), identity).unwrap();
        let command_key = SigningKey::from_bytes(&[9; 32]);
        let mut command = sample_command();
        command.signature = BASE64.encode(
            command_key
                .sign(&canonical_command(&command).unwrap())
                .to_bytes(),
        );
        let verifier = CommandVerifier {
            keys: BTreeMap::from([("release".into(), command_key.verifying_key())]),
        };
        let engine = Engine::new(Database::in_memory().unwrap(), Arc::new(LocalHost));
        process_command(
            &device,
            &engine,
            &verifier,
            &command.target_runner_id,
            &command.workspace_id,
            "77777777-7777-4777-8777-777777777777",
            "production",
            command.clone(),
        )
        .await;
        assert_eq!(
            engine
                .database()
                .remote_command_status(&command.command_id)
                .unwrap()
                .as_deref(),
            Some("completed")
        );
        process_command(
            &device,
            &engine,
            &verifier,
            &command.target_runner_id,
            &command.workspace_id,
            "77777777-7777-4777-8777-777777777777",
            "production",
            command.clone(),
        )
        .await;
        assert_eq!(
            engine
                .database()
                .remote_command_status(&command.command_id)
                .unwrap()
                .as_deref(),
            Some("completed")
        );
    }

    fn sample_command() -> RunnerCommand {
        let mut command = RunnerCommand {
            command_id: "11111111-1111-4111-8111-111111111111".into(),
            issuer_account_id: "22222222-2222-4222-8222-222222222222".into(),
            workspace_id: "33333333-3333-4333-8333-333333333333".into(),
            target_runner_id: "44444444-4444-4444-8444-444444444444".into(),
            action: RunnerCommandAction::RunWorkflow,
            workflow_revision_id: Some("55555555-5555-4555-8555-555555555555".into()),
            created_at: Utc::now().to_rfc3339(),
            expires_at: (Utc::now() + chrono::Duration::minutes(5)).to_rfc3339(),
            idempotency_key: "idempotency-key-0001".into(),
            payload: json!({
                "workflowRevisionId": "55555555-5555-4555-8555-555555555555",
                "contentHash": "",
                "trigger": {},
                "workflow": {
                    "id": "66666666-6666-4666-8666-666666666666", "schemaVersion": 3, "name": "Approved", "description": "", "enabled": true,
                    "triggerNodeId": "trigger", "nodes": [{"id":"trigger","type":"manual_trigger","version":1,"name":"Manual","position":{"x":0,"y":0},"configuration":{},"disabled":false}],
                    "edges": [], "settings": {}, "createdAt": Utc::now(), "updatedAt": Utc::now()
                }
            }),
            authorization_context: RunnerAuthorizationContext {
                principal_type: "personal_access_token".into(),
                principal_id: "88888888-8888-4888-8888-888888888888".into(),
                credential_id: Some("99999999-9999-4999-8999-999999999999".into()),
                required_permission: "workflows.run".into(),
                environment_id: "77777777-7777-4777-8777-777777777777".into(),
                environment: "production".into(),
                credential_scopes: Some(vec!["workflows.run".into()]),
                workspace_restrictions: Some(vec!["33333333-3333-4333-8333-333333333333".into()]),
                environment_restrictions: Some(vec!["77777777-7777-4777-8777-777777777777".into()]),
                principal_permissions: None,
            },
            key_id: "release".into(),
            signature: String::new(),
            status: "delivered".into(),
        };
        let workflow: Workflow =
            serde_json::from_value(command.payload["workflow"].clone()).unwrap();
        command.payload["contentHash"] = json!(format!(
            "sha256:{:x}",
            Sha256::digest(serde_json::to_vec(&workflow).unwrap())
        ));
        command
    }
}
