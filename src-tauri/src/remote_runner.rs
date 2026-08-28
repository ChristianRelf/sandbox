use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Duration, Utc};
use ed25519_dalek::{pkcs8::DecodePublicKey, Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRunnerCommand {
    pub command_id: String,
    pub issuer_account_id: String,
    pub workspace_id: String,
    pub target_runner_id: String,
    pub action: String,
    pub workflow_revision_id: Option<String>,
    pub payload: Value,
    pub authorization_context: RemoteAuthorizationContext,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub idempotency_key: String,
    pub key_id: String,
    pub signature: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAuthorizationContext {
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

pub struct LocalCommandPolicy<'a> {
    pub runner_id: &'a str,
    pub workspace_id: &'a str,
    pub environment_id: &'a str,
    pub environment: &'a str,
    pub allowed_actions: &'a HashSet<String>,
    pub approved_revision_ids: &'a HashSet<String>,
    pub seen_idempotency_keys: &'a HashSet<String>,
}

#[derive(Default)]
pub struct CommandTrustStore {
    keys: HashMap<String, VerifyingKey>,
}

impl CommandTrustStore {
    pub fn insert_public_key_pem(
        &mut self,
        key_id: impl Into<String>,
        pem: &str,
    ) -> Result<(), String> {
        let key = VerifyingKey::from_public_key_pem(pem)
            .map_err(|_| "Control-plane command key is not valid Ed25519 PEM.".to_string())?;
        self.keys.insert(key_id.into(), key);
        Ok(())
    }
}

pub fn verify_remote_command(
    command: &RemoteRunnerCommand,
    trust: &CommandTrustStore,
    policy: &LocalCommandPolicy<'_>,
    now: DateTime<Utc>,
) -> Result<(), String> {
    if command.target_runner_id != policy.runner_id || command.workspace_id != policy.workspace_id {
        return Err("Command target or workspace does not match this runner identity.".into());
    }
    verify_authorization_context(command, policy)?;
    if !matches!(command.status.as_str(), "queued" | "delivered") {
        return Err("Command is not in an executable delivery state.".into());
    }
    if command.created_at > now + Duration::minutes(5)
        || command.expires_at <= now
        || command.expires_at <= command.created_at
    {
        return Err("Command is not fresh or has expired.".into());
    }
    if !policy.allowed_actions.contains(&command.action) {
        return Err(format!(
            "Local policy does not allow action '{}'.",
            command.action
        ));
    }
    if policy
        .seen_idempotency_keys
        .contains(&command.idempotency_key)
    {
        return Err("Command idempotency key has already been claimed.".into());
    }
    if matches!(command.action.as_str(), "run_workflow" | "sync_revision") {
        let revision = command
            .workflow_revision_id
            .as_deref()
            .ok_or_else(|| "Command requires an exact workflow revision.".to_string())?;
        if !policy.approved_revision_ids.contains(revision) {
            return Err("Exact workflow revision is not approved by this runner.".into());
        }
    }
    let key = trust
        .keys
        .get(&command.key_id)
        .ok_or_else(|| "Command signing key is unknown or revoked.".to_string())?;
    let signature_bytes = BASE64
        .decode(&command.signature)
        .map_err(|_| "Command signature is not valid base64.".to_string())?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "Command signature has the wrong length.".to_string())?;
    key.verify(&canonical_unsigned_command(command)?, &signature)
        .map_err(|_| "Command signature verification failed.".to_string())
}

fn verify_authorization_context(
    command: &RemoteRunnerCommand,
    policy: &LocalCommandPolicy<'_>,
) -> Result<(), String> {
    let context = &command.authorization_context;
    let required = match command.action.as_str() {
        "request_diagnostics" => "runners.manage",
        "cancel_execution" | "pause_workflow" | "resume_workflow" => "workflows.pause",
        "run_workflow" | "sync_revision" => "workflows.run",
        _ => return Err("Command action has no authorization mapping.".into()),
    };
    if context.required_permission != required {
        return Err("Authorization permission does not match the command action.".into());
    }
    if context.environment_id != policy.environment_id || context.environment != policy.environment
    {
        return Err("Command environment does not match this runner.".into());
    }
    if context
        .workspace_restrictions
        .as_ref()
        .is_some_and(|items| {
            !items.is_empty() && !items.iter().any(|item| item == policy.workspace_id)
        })
    {
        return Err("Credential is restricted to another workspace.".into());
    }
    if context
        .environment_restrictions
        .as_ref()
        .is_some_and(|items| {
            !items.is_empty() && !items.iter().any(|item| item == policy.environment_id)
        })
    {
        return Err("Credential is restricted to another environment.".into());
    }
    match context.principal_type.as_str() {
        "user"
            if context.credential_id.is_none()
                && context.principal_id == command.issuer_account_id =>
        {
            Ok(())
        }
        "personal_access_token"
            if context.credential_id.is_some()
                && context
                    .credential_scopes
                    .as_ref()
                    .is_some_and(|items| items.iter().any(|item| item == required)) =>
        {
            Ok(())
        }
        "service_account"
            if context.credential_id.is_some()
                && context
                    .credential_scopes
                    .as_ref()
                    .is_some_and(|items| items.iter().any(|item| item == required))
                && context
                    .principal_permissions
                    .as_ref()
                    .is_some_and(|items| items.iter().any(|item| item == required)) =>
        {
            Ok(())
        }
        _ => Err("Principal role or credential scope does not authorize this command.".into()),
    }
}

fn canonical_unsigned_command(command: &RemoteRunnerCommand) -> Result<Vec<u8>, String> {
    let mut value = serde_json::to_value(command).map_err(|error| error.to_string())?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Command must serialize as an object.".to_string())?;
    object.remove("signature");
    object.remove("status");
    serde_json::to_vec(&sort_json(value)).map_err(|error| error.to_string())
}

fn sort_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(sort_json).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, sort_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{pkcs8::EncodePublicKey, Signer, SigningKey};

    fn signed_command() -> (
        RemoteRunnerCommand,
        CommandTrustStore,
        LocalCommandPolicy<'static>,
    ) {
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let pem = signing
            .verifying_key()
            .to_public_key_pem(Default::default())
            .unwrap();
        let mut trust = CommandTrustStore::default();
        trust
            .insert_public_key_pem("control-plane-1", &pem)
            .unwrap();
        let mut command = RemoteRunnerCommand {
            command_id: "11111111-1111-4111-8111-111111111111".into(),
            issuer_account_id: "22222222-2222-4222-8222-222222222222".into(),
            workspace_id: "workspace-1".into(),
            target_runner_id: "runner-1".into(),
            action: "run_workflow".into(),
            workflow_revision_id: Some("revision-1".into()),
            payload: serde_json::json!({"z":1,"a":{"second":2,"first":1}}),
            authorization_context: RemoteAuthorizationContext {
                principal_type: "personal_access_token".into(),
                principal_id: "principal-1".into(),
                credential_id: Some("credential-1".into()),
                required_permission: "workflows.run".into(),
                environment_id: "environment-1".into(),
                environment: "production".into(),
                credential_scopes: Some(vec!["workflows.run".into()]),
                workspace_restrictions: Some(vec!["workspace-1".into()]),
                environment_restrictions: Some(vec!["environment-1".into()]),
                principal_permissions: None,
            },
            created_at: Utc::now(),
            expires_at: Utc::now() + Duration::minutes(5),
            idempotency_key: "unique-command-key-1".into(),
            key_id: "control-plane-1".into(),
            signature: String::new(),
            status: "queued".into(),
        };
        command.signature = BASE64.encode(
            signing
                .sign(&canonical_unsigned_command(&command).unwrap())
                .to_bytes(),
        );
        let allowed_actions = Box::leak(Box::new(HashSet::from(["run_workflow".to_string()])));
        let approved_revision_ids = Box::leak(Box::new(HashSet::from(["revision-1".to_string()])));
        let seen_idempotency_keys = Box::leak(Box::new(HashSet::new()));
        let policy = LocalCommandPolicy {
            runner_id: "runner-1",
            workspace_id: "workspace-1",
            environment_id: "environment-1",
            environment: "production",
            allowed_actions,
            approved_revision_ids,
            seen_idempotency_keys,
        };
        (command, trust, policy)
    }

    #[test]
    fn accepts_a_signed_fresh_approved_command_and_rejects_mutation() {
        let (mut command, trust, policy) = signed_command();
        expect_ok(verify_remote_command(&command, &trust, &policy, Utc::now()));
        command.payload = serde_json::json!({"changed":true});
        assert!(verify_remote_command(&command, &trust, &policy, Utc::now())
            .unwrap_err()
            .contains("signature"));
    }

    #[test]
    fn rejects_a_validly_signed_command_outside_credential_environment_scope() {
        let (mut command, trust, policy) = signed_command();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        command.authorization_context.environment_restrictions =
            Some(vec!["another-environment".into()]);
        command.signature = BASE64.encode(
            signing
                .sign(&canonical_unsigned_command(&command).unwrap())
                .to_bytes(),
        );
        assert!(verify_remote_command(&command, &trust, &policy, Utc::now())
            .unwrap_err()
            .contains("restricted"));
    }

    #[test]
    fn rejects_duplicate_expired_and_unapproved_commands() {
        let (mut command, trust, mut policy) = signed_command();
        policy.seen_idempotency_keys =
            Box::leak(Box::new(HashSet::from([command.idempotency_key.clone()])));
        assert!(verify_remote_command(&command, &trust, &policy, Utc::now())
            .unwrap_err()
            .contains("already been claimed"));
        policy.seen_idempotency_keys = Box::leak(Box::new(HashSet::new()));
        command.expires_at = Utc::now() - Duration::seconds(1);
        assert!(verify_remote_command(&command, &trust, &policy, Utc::now())
            .unwrap_err()
            .contains("expired"));
    }

    fn expect_ok(result: Result<(), String>) {
        if let Err(error) = result {
            panic!("{error}");
        }
    }
}
