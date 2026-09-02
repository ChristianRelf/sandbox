use crate::{
    agent_host::AgentHost,
    client::{CommandStatus, DeviceClient, RunnerCommand, RunnerCommandAction, RunnerTriggerEvent},
    config::RunnerConfig,
    credential_vault::{CredentialVault, OsCredentialVault},
    plugin_manager::{PackageTrustMetadata, PluginManager},
    provider_adapter::ProviderOperationAdapter,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use ed25519_dalek::{pkcs8::DecodePublicKey, Signature, VerifyingKey};
use sandbox_engine::{ConnectionMetadata, ConnectionStatus, Database, Engine, Workflow};
#[cfg(test)]
use sandbox_engine::LocalHost;
use sandbox_plugin_runtime::{PackageTrustStore, RevocationList, VerifiedPackage, HOST_VERSION};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet, HashSet}, fs::OpenOptions, io::Write, path::{Path, PathBuf}, sync::Arc, time::Duration as StdDuration};
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
            RunnerCommandAction::SyncRevision => {
                let revision_id = command.workflow_revision_id.as_deref().ok_or("sync command is missing its approved revision")?;
                let payload: SyncRevisionPayload = serde_json::from_value(command.payload.clone())
                    .map_err(|error| format!("sync command payload is invalid: {error}"))?;
                verify_revision(&payload.workflow_revision_id, &payload.content_hash, &payload.workflow, revision_id)?;
                if !matches!(payload.manifest_version, 1 | 2) || !matches!(payload.invocation_version, 1 | 2) {
                    return Err("workflow requires an unsupported manifest or invocation protocol version".into());
                }
                for node in payload.workflow.nodes.iter().filter(|node| !node.disabled) {
                    if matches!(node.node_type.as_str(), "javascript_code" | "python_code")
                        || (node.node_type == "code" && node.configuration.get("executionMode").and_then(Value::as_str) == Some("run"))
                    {
                        return Err(format!("{} requires a pinned code runtime; the packaged self-hosted runner does not declare JavaScript or Python runtime capability", node.id));
                    }
                }
                let pinned = payload.workflow.nodes.iter().filter_map(|node| node.plugin.as_ref())
                    .map(|pin| (pin.plugin_id.clone(), pin.plugin_version.clone(), pin.package_integrity.clone())).collect::<BTreeSet<_>>();
                let supplied = payload.packages.iter().map(|package| (package.plugin_id.clone(), package.version.clone(), package.package_integrity.clone())).collect::<BTreeSet<_>>();
                if pinned != supplied { return Err("sync package list does not exactly match the workflow plugin pins".into()); }
                let referenced_connections = payload.workflow.nodes.iter().filter_map(|node| node.plugin.as_ref())
                    .flat_map(|pin| pin.credential_references.values().cloned()).collect::<BTreeSet<_>>();
                let required_connections = payload.required_connections.iter().map(|connection| connection.connection_id.clone()).collect::<BTreeSet<_>>();
                if referenced_connections != required_connections { return Err("sync connection list does not exactly match the workflow connection references".into()); }
                for lease in &payload.polling_leases {
                    if !(60..=300).contains(&lease.poll_interval_seconds) { return Err("polling intervals must be between 60 and 300 seconds".into()); }
                    let node=payload.workflow.nodes.iter().find(|node|node.id==lease.node_id).ok_or("polling lease references a missing node")?;
                    if node.id!=payload.workflow.trigger_node_id || node.node_type!=lease.node_type { return Err("polling lease must reference the workflow trigger node".into()); }
                    let pin=node.plugin.as_ref().ok_or("polling lease trigger has no exact plugin pin")?;
                    if pin.plugin_id!=lease.plugin_id || pin.plugin_version!=lease.plugin_version || !pin.credential_references.values().any(|id|id==&lease.connection_id) {
                        return Err("polling lease does not match the trigger's plugin and connection pins".into());
                    }
                    if polling_provider(&lease.node_type).is_none() { return Err("polling lease uses an unsupported trigger type".into()); }
                }
                Ok(VerifiedCommand::SyncRevision { payload, revision_id: revision_id.to_owned() })
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
    SyncRevision { payload: SyncRevisionPayload, revision_id: String },
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncRevisionPayload {
    pub workflow_revision_id: String,
    pub content_hash: String,
    pub workflow: Workflow,
    pub deployment_id: String,
    pub manifest_version: u16,
    pub invocation_version: u16,
    pub packages: Vec<SyncPluginPackage>,
    #[serde(default)]
    pub required_connections: Vec<SyncConnectionRequirement>,
    #[serde(default)]
    pub polling_leases: Vec<PollingLease>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncPluginPackage {
    pub plugin_id: String,
    pub version: String,
    pub package_integrity: String,
    pub publisher_id: String,
    pub publisher_key_id: String,
    pub publisher_public_key_pem: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncConnectionRequirement {
    pub connection_id: String,
    pub provider_id: String,
    #[serde(default)]
    pub required_permissions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PollingLease {
    pub node_id: String,
    pub node_type: String,
    pub connection_id: String,
    pub plugin_id: String,
    pub plugin_version: String,
    pub configuration: Value,
    pub poll_interval_seconds: i64,
}

#[derive(Clone)]
pub struct RunnerActivation {
    pub plugin_cache: PathBuf,
    pub data_directory: PathBuf,
    pub plugin_manager: PluginManager,
    pub credential_vault: Arc<dyn CredentialVault>,
    pub provider_adapter: Arc<ProviderOperationAdapter>,
}

impl RunnerActivation {
    pub fn new(config: &RunnerConfig, plugin_manager: PluginManager, credential_vault: Arc<dyn CredentialVault>, provider_adapter: Arc<ProviderOperationAdapter>) -> Self {
        Self { plugin_cache: config.plugin_cache.clone(), data_directory: config.data_directory.clone(), plugin_manager, credential_vault, provider_adapter }
    }
}

pub fn open_engine(config: &RunnerConfig) -> Result<(Engine, PluginManager, Arc<dyn CredentialVault>, Arc<ProviderOperationAdapter>), String> {
    std::fs::create_dir_all(&config.data_directory).map_err(|error| error.to_string())?;
    let database = Database::open(config.data_directory.join("runner.sqlite3"))
        .map_err(|error| error.to_string())?;
    database
        .recover_unfinished()
        .map_err(|error| error.to_string())?;
    let vault: Arc<dyn CredentialVault> = Arc::new(OsCredentialVault::new());
    let (manager,provider)=build_plugin_services(database.clone(),config.plugin_cache.clone(),vault.clone())?;
    let engine=Engine::new(database,Arc::new(AgentHost::new(manager.clone())));
    Ok((engine,manager,vault,provider))
}

fn build_plugin_services(database:Database,plugin_cache:PathBuf,vault:Arc<dyn CredentialVault>)->Result<(PluginManager,Arc<ProviderOperationAdapter>),String>{
    std::thread::spawn(move||{
        let provider=Arc::new(ProviderOperationAdapter::new(database.clone(),vault).map_err(|error|error.to_string())?);
        let network=Arc::new(sandbox_plugin_runtime::ReqwestTransport::new().map_err(|error|error.to_string())?);
        let manager=PluginManager::with_host_services(database,plugin_cache,network,provider.clone()).map_err(|error|error.to_string())?;
        Ok((manager,provider))
    }).join().map_err(|_|"Plugin host initialization worker panicked.".to_string())?
}

pub async fn process_command(
    device: &DeviceClient,
    engine: &Engine,
    verifier: &CommandVerifier,
    runner_id: &str,
    workspace_id: &str,
    environment_id: &str,
    environment: &str,
    activation: &RunnerActivation,
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
        VerifiedCommand::SyncRevision { payload, revision_id } => match activate_revision(device, engine, activation, &payload).await {
            Ok(package_count) => (CommandStatus::Completed, "completed", json!({
                "revisionId": revision_id, "deploymentId": payload.deployment_id,
                "verifiedPluginPackages": package_count, "pollingLeases": payload.polling_leases.len(), "activated": true
            })),
            Err(error) => (CommandStatus::Rejected, "rejected", json!({ "revisionId": revision_id, "reason": error })),
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

pub async fn poll_synced_triggers(device: Arc<DeviceClient>, engine: Arc<Engine>, activation: Arc<RunnerActivation>, runner_id: String) {
    let mut interval=tokio::time::interval(StdDuration::from_secs(15));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let Ok(deployments)=activation_records(&activation.data_directory) else { continue; };
        for deployment in deployments {
            for lease in &deployment.polling_leases {
                let Some(provider)=polling_provider(&lease.node_type) else { continue; };
                let state=engine.database().poll_cursor(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version).ok().flatten();
                if state.as_ref().and_then(|(_,_,next,_)|*next).is_some_and(|next|next>Utc::now()){continue;}
                let baseline_complete=state.as_ref().is_some_and(|(_,baseline,_,_)|*baseline);
                let cursor=state.as_ref().map(|(cursor,_,_,_)|cursor.clone()).filter(|cursor|!cursor.is_null());
                let failures=state.as_ref().map_or(0,|(_,_,_,failures)|*failures);
                let next_poll=Utc::now()+chrono::Duration::seconds(lease.poll_interval_seconds.clamp(60,300));
                let adapter=activation.provider_adapter.clone();let operation=lease.node_type.clone();let configuration=lease.configuration.clone();let connection=lease.connection_id.clone();
                let polled=tokio::task::spawn_blocking(move||adapter.poll(&connection,provider,&operation,&configuration,cursor.as_ref())).await;
                let batch=match polled {
                    Ok(Ok(batch))=>batch,
                    Ok(Err(error))=>{
                        let message=error.to_string();
                        if message.contains("HTTP 410") || message.contains("cursor")&&message.contains("invalid") {
                            let _=engine.database().save_poll_checkpoint(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version,&Value::Null,false,next_poll,&[]);
                        }
                        let _=engine.database().save_poll_failure(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version,Utc::now()+provider_backoff(&message,failures),&message);
                        continue;
                    }
                    Err(error)=>{let message=format!("poll worker failed: {error}");let _=engine.database().save_poll_failure(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version,Utc::now()+provider_backoff(&message,failures),&message);continue;}
                };
                if !baseline_complete {
                    let _=engine.database().save_poll_checkpoint(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version,&batch.cursor,true,next_poll,&batch.event_keys);
                    continue;
                }
                if batch.events.is_empty() {
                    let _=engine.database().save_poll_checkpoint(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version,&batch.cursor,true,next_poll,&[]);
                    continue;
                }
                let occurred_at=Utc::now();
                let submitted=batch.events.iter().zip(&batch.event_keys).map(|(event,key)|RunnerTriggerEvent{
                    event_id:uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL,format!("sndbox:{}:{}:{}",deployment.deployment_id,lease.node_id,key).as_bytes()).to_string(),
                    deployment_id:deployment.deployment_id.clone(),workflow_revision_id:deployment.workflow_revision_id.clone(),node_id:lease.node_id.clone(),
                    plugin_id:lease.plugin_id.clone(),plugin_version:lease.plugin_version.clone(),dedupe_key:key.clone(),occurred_at:occurred_at.to_rfc3339(),
                    payload:json!({"type":lease.node_type,"event":event,"polledAt":occurred_at}),provider_checkpoint:Some(json!({"observedAt":occurred_at})),
                }).collect::<Vec<_>>();
                let expected=submitted.iter().map(|event|event.event_id.clone()).collect::<HashSet<_>>();
                let acknowledgement=match device.trigger_events(submitted).await {
                    Ok(value)=>value,
                    Err(error)=>{let message=format!("trigger event submission failed: {error}");let _=engine.database().save_poll_failure(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version,Utc::now()+provider_backoff(&message,failures),&message);continue;}
                };
                let acknowledged=acknowledgement.accepted_event_ids.into_iter().chain(acknowledgement.duplicate_event_ids).collect::<HashSet<_>>();
                if acknowledged!=expected {let message="control plane returned an incomplete trigger-event acknowledgement";let _=engine.database().save_poll_failure(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version,Utc::now()+provider_backoff(message,failures),message);continue;}
                let accepted=engine.database().save_poll_checkpoint(&deployment.workflow.id,&lease.node_id,&runner_id,&lease.connection_id,&lease.plugin_id,&lease.plugin_version,&batch.cursor,true,next_poll,&batch.event_keys).unwrap_or_default().into_iter().collect::<HashSet<_>>();
                for (event,key) in batch.events.into_iter().zip(batch.event_keys) {
                    if !accepted.contains(&key){continue;}
                    let engine=engine.clone();let workflow=deployment.workflow.clone();let trigger=json!({"type":lease.node_type,"event":event,"polledAt":occurred_at});
                    tokio::spawn(async move { let _=engine.run(workflow,trigger,CancellationToken::new()).await; });
                }
            }
        }
    }
}

fn activation_records(data_directory:&Path)->Result<Vec<SyncRevisionPayload>,String>{
    let directory=data_directory.join("deployments");
    if !directory.exists(){return Ok(vec![]);}
    let mut records=Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|error|error.to_string())?.take(1000){
        let path=entry.map_err(|error|error.to_string())?.path();
        if path.extension().and_then(|value|value.to_str())!=Some("json"){continue;}
        let metadata=std::fs::metadata(&path).map_err(|error|error.to_string())?;if metadata.len()>4*1024*1024{continue;}
        if let Ok(record)=serde_json::from_slice::<SyncRevisionPayload>(&std::fs::read(path).map_err(|error|error.to_string())?){records.push(record);}
    }
    Ok(records)
}

fn polling_provider(node_type:&str)->Option<&'static str>{match node_type{
    "google.calendar.event_changed"|"google.drive.file_changed"|"google.sheets.row_added"=>Some("google_workspace"),
    "slack.channel_message_posted"=>Some("slack_oauth"),"notion.data_source_page_changed"=>Some("notion"),
    "github.issue_or_pull_request_changed"|"github.workflow_run_completed"=>Some("github_app"),_=>None,
}}

fn provider_backoff(message: &str, prior_failures: u32) -> chrono::Duration {
    if let Some(seconds) = message.split("retry after ").nth(1).and_then(|value| value.split(|character: char| !character.is_ascii_digit()).next()).and_then(|value| value.parse::<i64>().ok()) {
        return chrono::Duration::seconds(seconds.clamp(1, 3_600));
    }
    let exponential = 60_i64.saturating_mul(1_i64 << prior_failures.min(4));
    let jitter = i64::from(Utc::now().timestamp_subsec_millis() % 17);
    chrono::Duration::seconds((exponential + jitter).min(900))
}

fn verify_revision(payload_revision_id: &str, content_hash: &str, workflow: &Workflow, expected_revision_id: &str) -> Result<(), String> {
    if payload_revision_id != expected_revision_id { return Err("embedded workflow revision does not match the signed command".into()); }
    let encoded = serde_json::to_vec(workflow).map_err(|error| format!("workflow could not be hashed: {error}"))?;
    let calculated = format!("sha256:{:x}", Sha256::digest(encoded));
    if content_hash != calculated { return Err("workflow content does not match the approved revision hash".into()); }
    Ok(())
}

async fn activate_revision(device: &DeviceClient, engine: &Engine, activation: &RunnerActivation, payload: &SyncRevisionPayload) -> Result<usize, String> {
    std::fs::create_dir_all(&activation.plugin_cache).map_err(|error| error.to_string())?;
    for connection in &payload.required_connections { validate_local_connection(engine.database(), &activation.data_directory, activation.credential_vault.as_ref(), connection)?; }
    let host_version = Version::parse(HOST_VERSION).map_err(|error| error.to_string())?;
    for package in &payload.packages {
        let bytes = device.download_plugin_package(&package.download_url).await.map_err(|error| error.to_string())?;
        let mut trust = PackageTrustStore::default();
        trust.insert_public_key_pem(&package.publisher_id, &package.publisher_key_id, &package.publisher_public_key_pem).map_err(|error| error.to_string())?;
        let verified = VerifiedPackage::from_bytes(&bytes, &trust, &RevocationList::default(), &host_version).map_err(|error| error.to_string())?;
        if verified.manifest.plugin_id != package.plugin_id || verified.manifest.version.to_string() != package.version
            || verified.manifest.publisher_id != package.publisher_id || verified.manifest.signature.key_id != package.publisher_key_id
            || verified.digest != package.package_integrity { return Err(format!("verified package {} does not match its exact revision pin", package.plugin_id)); }
        for node in payload.workflow.nodes.iter().filter(|node| node.plugin.as_ref().is_some_and(|pin| pin.plugin_id == package.plugin_id)) {
            let definition = verified.manifest.node(&node.node_type, node.version).ok_or_else(|| format!("{} {} does not declare {} v{}", package.plugin_id, package.version, node.node_type, node.version))?;
            if !definition.placements.iter().any(|placement| matches!(placement, sandbox_plugin_runtime::NodePlacement::SelfHosted)) {
                return Err(format!("{} is not supported on self-hosted runners", node.node_type));
            }
        }
        let inspection=activation.plugin_manager.inspect_bytes(bytes,PackageTrustMetadata{
            publisher_id:package.publisher_id.clone(),key_id:package.publisher_key_id.clone(),publisher_public_key_pem:package.publisher_public_key_pem.clone(),
            owner_type:payload.workflow.owner.owner_type.clone(),owner_id:payload.workflow.owner.owner_id.clone(),source:"private".into(),
        }).map_err(|error|error.to_string())?;
        let installed=activation.plugin_manager.install_inspected(&inspection.inspection_id).map_err(|error|error.to_string())?;
        let approved=engine.database().approve_plugin_permissions(&installed.plugin_id,&installed.version,&installed.package_integrity,&installed.owner_type,&installed.owner_id).map_err(|error|error.to_string())?;
        engine.database().set_plugin_enabled(&approved.plugin_id,&approved.version,&approved.package_integrity,&approved.owner_type,&approved.owner_id,true).map_err(|error|error.to_string())?;
    }
    engine.database().save_workflow(payload.workflow.clone()).map_err(|error| error.to_string())?;
    let deployments = activation.data_directory.join("deployments");
    std::fs::create_dir_all(&deployments).map_err(|error| error.to_string())?;
    let activation_record = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    atomic_write(&deployments.join(format!("{}.json", payload.deployment_id)), &activation_record)?;
    Ok(payload.packages.len())
}

fn validate_local_connection(database: &Database, data_directory: &Path, vault: &dyn CredentialVault, requirement: &SyncConnectionRequirement) -> Result<(), String> {
    uuid::Uuid::parse_str(&requirement.connection_id).map_err(|_| "connection reference is not an opaque UUID")?;
    let marker = data_directory.join("connections").join(format!("{}.json", requirement.connection_id));
    let value: Value = serde_json::from_slice(&std::fs::read(&marker).map_err(|_| format!("connection {} is not locally authorized", requirement.connection_id))?)
        .map_err(|_| format!("connection {} authorization metadata is invalid", requirement.connection_id))?;
    if value.get("authorized").and_then(Value::as_bool) != Some(true) || value.get("providerId").and_then(Value::as_str) != Some(&requirement.provider_id) {
        return Err(format!("connection {} needs attention on this runner", requirement.connection_id));
    }
    if !vault.exists(&requirement.connection_id)? { return Err(format!("connection {} has no secret material in this runner's OS vault",requirement.connection_id)); }
    let scopes=value.get("scopes").and_then(Value::as_array).map(|items|items.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>()).unwrap_or_default();
    if requirement.required_permissions.iter().any(|required|!scopes.contains(required)) { return Err(format!("connection {} is missing required permissions",requirement.connection_id)); }
    database.save_connection(&ConnectionMetadata{
        id:requirement.connection_id.clone(),provider:requirement.provider_id.clone(),display_name:value.get("displayName").and_then(Value::as_str).unwrap_or(&requirement.provider_id).to_string(),
        account_identifier:value.get("accountIdentifier").and_then(Value::as_str).map(str::to_string),scopes,created_at:Utc::now(),last_used_at:None,expires_at:None,
        status:ConnectionStatus::Connected,metadata:value.get("metadata").cloned().unwrap_or_else(||json!({})),
    }).map_err(|error|error.to_string())?;
    Ok(())
}

fn atomic_write(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = destination.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|error| error.to_string())?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) { let _ = std::fs::remove_file(&temporary); return Err(error.to_string()); }
    std::fs::rename(&temporary, destination).map_err(|error| { let _ = std::fs::remove_file(&temporary); error.to_string() })
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
        let database=Database::in_memory().unwrap();
        let engine = Engine::new(database.clone(), Arc::new(LocalHost));
        let activation_directory = tempfile::tempdir().unwrap();
        let vault:Arc<dyn CredentialVault>=Arc::new(OsCredentialVault::new());
        let (plugin_manager,provider_adapter)=build_plugin_services(database.clone(),activation_directory.path().join("plugins"),vault.clone()).unwrap();
        let activation = RunnerActivation {
            plugin_cache: activation_directory.path().join("plugins"), data_directory: activation_directory.path().to_path_buf(),
            plugin_manager,credential_vault:vault,provider_adapter,
        };
        process_command(
            &device,
            &engine,
            &verifier,
            &command.target_runner_id,
            &command.workspace_id,
            "77777777-7777-4777-8777-777777777777",
            "production",
            &activation,
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
            &activation,
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
        // reqwest's blocking client owns a helper runtime that cannot be
        // dropped from inside a Tokio test runtime.
        std::mem::forget(activation);
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
