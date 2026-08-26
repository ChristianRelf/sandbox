use crate::{
    account_auth, oauth,
    plugin_manager::{PackageTrustMetadata, PluginPackageInspection},
    sync_crypto::EncryptedWorkflowRevision,
    templates, AppState,
};
use chrono::{DateTime, Utc};
use sandbox_engine::{
    validation::{validate, ValidationIssue},
    BrowserProfile, BrowserProfileSettings, ConnectionMetadata, ConnectionStatus, ExecutionRecord,
    InstalledPlugin, PendingApproval, PermissionSummary, StructuredLocator, Workflow,
    WorkflowSummary,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::hash_map::Entry;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
pub async fn inspect_plugin_package(
    trust: PackageTrustMetadata,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<PluginPackageInspection>> {
    let selection = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Inspect signed plugin package")
            .add_filter("Sandbox plugin", &["sandbox-plugin"])
            .blocking_pick_file()
    })
    .await
    .map_err(err)?;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection.into_path().map_err(err)?;
    state
        .plugin_manager
        .inspect_path(&path, trust)
        .map(Some)
        .map_err(err)
}

#[tauri::command]
pub fn install_inspected_plugin(
    inspection_id: String,
    state: State<'_, AppState>,
) -> Result<InstalledPlugin> {
    state
        .plugin_manager
        .install_inspected(&inspection_id)
        .map_err(err)
}

#[tauri::command]
pub fn list_installed_plugins(
    owner_type: Option<String>,
    owner_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<InstalledPlugin>> {
    state
        .engine
        .database()
        .list_installed_plugins(
            owner_type.as_deref().unwrap_or("personal"),
            owner_id.as_deref().unwrap_or("local"),
        )
        .map_err(err)
}

#[tauri::command]
pub fn approve_plugin_permissions(
    plugin_id: String,
    version: String,
    package_integrity: String,
    owner_type: String,
    owner_id: String,
    state: State<'_, AppState>,
) -> Result<InstalledPlugin> {
    state
        .engine
        .database()
        .approve_plugin_permissions(
            &plugin_id,
            &version,
            &package_integrity,
            &owner_type,
            &owner_id,
        )
        .map_err(err)
}

#[tauri::command]
pub fn set_plugin_enabled(
    plugin_id: String,
    version: String,
    package_integrity: String,
    owner_type: String,
    owner_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<InstalledPlugin> {
    state
        .engine
        .database()
        .set_plugin_enabled(
            &plugin_id,
            &version,
            &package_integrity,
            &owner_type,
            &owner_id,
            enabled,
        )
        .map_err(err)
}

#[tauri::command]
pub fn prepare_workflow_sync(
    id: String,
    parent_revision_id: Option<String>,
    editor_device_id: String,
    state: State<'_, AppState>,
) -> Result<EncryptedWorkflowRevision> {
    if !state
        .credential_vault
        .exists(account_auth::ACCOUNT_VAULT_ID)
        .map_err(err)?
    {
        return Err("Sign in before enabling workflow sync. Local workflows remain available without an account.".into());
    }
    let workflow = state
        .engine
        .database()
        .get_workflow(&id)
        .map_err(err)?
        .ok_or_else(|| "Workflow no longer exists.".to_string())?;
    let mut definition = serde_json::to_value(&workflow).map_err(err)?;
    let mut required_connections = Vec::new();
    let mut required_profiles = Vec::new();
    let mut local_path_fields = Vec::new();
    sanitize_export_definition(
        &mut definition,
        &state,
        &mut required_connections,
        &mut required_profiles,
        &mut local_path_fields,
    )?;
    if contains_secret_material(&definition) {
        return Err(
            "Workflow sync stopped because the definition contains secret-shaped material.".into(),
        );
    }
    let sanitized: Workflow = serde_json::from_value(definition).map_err(err)?;
    state
        .sync_crypto
        .encrypt(&sanitized, parent_revision_id, editor_device_id)
}

#[tauri::command]
pub fn import_synced_revision_copy(
    revision: EncryptedWorkflowRevision,
    state: State<'_, AppState>,
) -> Result<Workflow> {
    let mut workflow = state.sync_crypto.decrypt(&revision)?;
    workflow.id = Uuid::new_v4().to_string();
    workflow.name = format!("{} (synced conflict copy)", workflow.name);
    workflow.enabled = false;
    workflow.owner = Default::default();
    workflow.settings.permissions = PermissionSummary::default();
    workflow.created_at = Utc::now();
    workflow.updated_at = Utc::now();
    state.engine.database().save_workflow(workflow).map_err(err)
}

#[tauri::command]
pub fn list_workflows(state: State<'_, AppState>) -> Result<Vec<WorkflowSummary>> {
    state.engine.database().list_workflows().map_err(err)
}
#[tauri::command]
pub fn get_workflow(id: String, state: State<'_, AppState>) -> Result<Option<Workflow>> {
    state.engine.database().get_workflow(&id).map_err(err)
}
#[tauri::command]
pub fn save_workflow(workflow: Workflow, state: State<'_, AppState>) -> Result<Workflow> {
    if workflow.id.trim().is_empty() || workflow.name.trim().is_empty() {
        return Err("Workflow name and identifier are required.".into());
    }
    state.engine.database().save_workflow(workflow).map_err(err)
}
#[tauri::command]
pub fn delete_workflow(id: String, state: State<'_, AppState>) -> Result<()> {
    state.engine.database().delete_workflow(&id).map_err(err)
}
#[tauri::command]
pub fn create_workflow(
    template_key: Option<String>,
    name: Option<String>,
    state: State<'_, AppState>,
) -> Result<Workflow> {
    let workflow = templates::by_key(template_key.as_deref().unwrap_or("blank"), name);
    state.engine.database().save_workflow(workflow).map_err(err)
}

#[tauri::command]
pub async fn export_workflow(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>> {
    let workflow = state
        .engine
        .database()
        .get_workflow(&id)
        .map_err(err)?
        .ok_or_else(|| "Workflow no longer exists.".to_string())?;
    let mut definition = serde_json::to_value(&workflow).map_err(err)?;
    let mut required_connections = Vec::<Value>::new();
    let mut required_profiles = Vec::<Value>::new();
    let mut local_path_fields = Vec::<String>::new();
    sanitize_export_definition(
        &mut definition,
        &state,
        &mut required_connections,
        &mut required_profiles,
        &mut local_path_fields,
    )?;
    if let Some(object) = definition.as_object_mut() {
        object.insert("enabled".into(), Value::Bool(false));
    }
    let mut node_types = workflow
        .nodes
        .iter()
        .map(|node| node.node_type.clone())
        .collect::<Vec<_>>();
    node_types.sort();
    node_types.dedup();
    let package = json!({
        "format": "sandbox-workflow",
        "formatVersion": 1,
        "schemaVersion": workflow.schema_version,
        "exportedAt": Utc::now(),
        "workflow": definition,
        "requiredNodeTypes": node_types,
        "requiredConnections": required_connections,
        "requiredBrowserProfiles": required_profiles,
        "requiredPermissions": {
            "networkDomains": workflow.settings.permissions.approved_network_domains,
            "folderAccessCount": workflow.settings.permissions.approved_folders.len(),
            "commandExecution": workflow.nodes.iter().any(|node| node.node_type == "run_command"),
            "backgroundExecution": workflow.nodes.iter().any(|node| matches!(node.node_type.as_str(), "schedule_trigger" | "file_watch_trigger" | "gmail_new_email_trigger")),
            "externalCommunication": workflow.nodes.iter().any(|node| matches!(node.node_type.as_str(), "gmail_create_draft" | "gmail_send_email" | "gmail_add_label" | "discord_webhook" | "discord_embed" | "slack_webhook"))
        },
        "localPathRequirements": local_path_fields,
        "templateMetadata": Value::Null,
        "warnings": if local_path_fields.is_empty() { Vec::<String>::new() } else { vec!["Local absolute paths were removed. Select approved files or folders after import.".to_string()] }
    });
    let suggested = format!("{}.sandbox-workflow.json", safe_filename(&workflow.name));
    let selection = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Export workflow")
            .set_file_name(suggested)
            .add_filter("Sandbox workflow", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(err)?;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection.into_path().map_err(err)?;
    let encoded = serde_json::to_vec_pretty(&package).map_err(err)?;
    if encoded.len() > 2 * 1024 * 1024 {
        return Err("This workflow export exceeds the 2 MB definition limit.".into());
    }
    std::fs::write(&path, encoded).map_err(err)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn import_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Workflow>> {
    let selection = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import workflow")
            .add_filter("Sandbox workflow", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(err)?;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection.into_path().map_err(err)?;
    let metadata = std::fs::metadata(&path).map_err(err)?;
    if metadata.len() > 2 * 1024 * 1024 {
        return Err("The selected workflow exceeds the 2 MB import limit.".into());
    }
    let package: Value = serde_json::from_slice(&std::fs::read(&path).map_err(err)?)
        .map_err(|error| format!("The selected file is not valid workflow JSON: {error}"))?;
    if package.get("format").and_then(Value::as_str) != Some("sandbox-workflow") {
        return Err("The selected file is not a Sandbox workflow export.".into());
    }
    if contains_secret_material(&package) {
        return Err("The import contains raw secret material. Remove tokens, passwords, cookies, and webhook URLs before importing.".into());
    }
    let schema = package
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| "The workflow export does not declare a schema version.".to_string())?
        as u32;
    if schema > sandbox_engine::CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "This workflow uses schema version {schema}, but this build supports up to version {}.",
            sandbox_engine::CURRENT_SCHEMA_VERSION
        ));
    }
    if schema == 0 {
        return Err("Workflow schema version 0 is not supported.".into());
    }
    let mut definition = package
        .get("workflow")
        .cloned()
        .ok_or_else(|| "The export does not contain a workflow definition.".to_string())?;
    if let Some(object) = definition.as_object_mut() {
        object.insert(
            "schemaVersion".into(),
            json!(sandbox_engine::CURRENT_SCHEMA_VERSION),
        );
    }
    let mut workflow: Workflow = serde_json::from_value(definition)
        .map_err(|error| format!("The workflow definition is incomplete: {error}"))?;
    workflow.id = Uuid::new_v4().to_string();
    workflow.name = format!("{} (imported)", workflow.name.trim());
    workflow.enabled = false;
    workflow.schema_version = sandbox_engine::CURRENT_SCHEMA_VERSION;
    workflow.created_at = Utc::now();
    workflow.updated_at = Utc::now();
    workflow.settings.permissions = PermissionSummary {
        approved_network_domains: package
            .pointer("/requiredPermissions/networkDomains")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        ..PermissionSummary::default()
    };
    let saved = state
        .engine
        .database()
        .save_workflow(workflow)
        .map_err(err)?;
    Ok(Some(saved))
}
#[tauri::command]
pub fn validate_workflow(workflow: Workflow) -> Vec<ValidationIssue> {
    validate(&workflow)
}

#[tauri::command]
pub async fn run_workflow(
    id: String,
    trigger: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<ExecutionRecord> {
    let workflow = state
        .engine
        .database()
        .get_workflow(&id)
        .map_err(err)?
        .ok_or_else(|| "Workflow no longer exists.".to_string())?;
    let token = CancellationToken::new();
    let owns_token = {
        let mut active = state.cancellations.lock();
        match active.entry(workflow.id.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(token.clone());
                true
            }
            Entry::Occupied(_) => false,
        }
    };
    let result = state
        .engine
        .run(
            workflow,
            trigger.unwrap_or_else(|| json!({"type":"manual"})),
            token,
        )
        .await
        .map_err(err);
    if owns_token {
        state.cancellations.lock().remove(&id);
    }
    result
}
#[tauri::command]
pub async fn retry_failed_node(
    execution_id: String,
    node_id: String,
    state: State<'_, AppState>,
) -> Result<ExecutionRecord> {
    let execution = state
        .engine
        .database()
        .get_execution(&execution_id)
        .map_err(err)?
        .ok_or_else(|| "Execution no longer exists.".to_string())?;
    let token = CancellationToken::new();
    let owns_token = {
        let mut active = state.cancellations.lock();
        match active.entry(execution.workflow_id.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(token.clone());
                true
            }
            Entry::Occupied(_) => false,
        }
    };
    let result = state
        .engine
        .retry_failed_node(&execution_id, &node_id, token)
        .await
        .map_err(err);
    if owns_token {
        state.cancellations.lock().remove(&execution.workflow_id);
    }
    result
}

#[tauri::command]
pub async fn retry_browser_execution_headed(
    execution_id: String,
    state: State<'_, AppState>,
) -> Result<ExecutionRecord> {
    let previous = state
        .engine
        .database()
        .get_execution(&execution_id)
        .map_err(err)?
        .ok_or_else(|| "Execution no longer exists.".to_string())?;
    let mut workflow = state
        .engine
        .database()
        .get_workflow(&previous.workflow_id)
        .map_err(err)?
        .ok_or_else(|| "Workflow no longer exists.".to_string())?;
    let mut browser_found = false;
    for node in &mut workflow.nodes {
        if node.node_type == "open_browser" {
            let configuration = node
                .configuration
                .as_object_mut()
                .ok_or_else(|| "Open Browser has invalid configuration.".to_string())?;
            configuration.insert("headed".into(), Value::Bool(true));
            browser_found = true;
        }
    }
    if !browser_found {
        return Err("This execution does not contain an Open Browser node.".into());
    }
    let token = CancellationToken::new();
    let owns_token = {
        let mut active = state.cancellations.lock();
        match active.entry(workflow.id.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(token.clone());
                true
            }
            Entry::Occupied(_) => false,
        }
    };
    let workflow_id = workflow.id.clone();
    let result = state
        .engine
        .run(workflow, previous.trigger, token)
        .await
        .map_err(err);
    if owns_token {
        state.cancellations.lock().remove(&workflow_id);
    }
    result
}

#[tauri::command]
pub fn open_execution_artifact(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let artifact_root = state.data_dir.join("artifacts");
    let root = std::fs::canonicalize(&artifact_root).map_err(|_| {
        "Execution artifacts are no longer available. Run the workflow again to capture new evidence."
            .to_string()
    })?;
    let candidate = std::fs::canonicalize(&path).map_err(|_| {
        "This execution artifact no longer exists. It may have expired under the retention policy."
            .to_string()
    })?;
    if !candidate.is_file() || !candidate.starts_with(&root) {
        return Err(
            "Only files created inside the execution artifact directory can be opened.".into(),
        );
    }
    app.opener()
        .open_path(candidate.to_string_lossy().to_string(), None::<&str>)
        .map_err(err)
}
#[tauri::command]
pub fn cancel_execution(execution_id: String, state: State<'_, AppState>) -> Result<()> {
    let execution = state
        .engine
        .database()
        .get_execution(&execution_id)
        .map_err(err)?
        .ok_or_else(|| "Execution no longer exists.".to_string())?;
    state
        .cancellations
        .lock()
        .get(&execution.workflow_id)
        .ok_or_else(|| "This execution is no longer active.".to_string())?
        .cancel();
    Ok(())
}
#[tauri::command]
pub fn list_executions(
    workflow_id: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<ExecutionRecord>> {
    state
        .engine
        .database()
        .list_executions(workflow_id.as_deref(), limit.unwrap_or(100).min(500))
        .map_err(err)
}
#[tauri::command]
pub fn get_execution(id: String, state: State<'_, AppState>) -> Result<Option<ExecutionRecord>> {
    state.engine.database().get_execution(&id).map_err(err)
}
#[tauri::command]
pub fn clear_execution_history(keep: Option<usize>, state: State<'_, AppState>) -> Result<usize> {
    let (removed, artifacts) = state
        .engine
        .database()
        .clear_old_executions(keep.unwrap_or(0))
        .map_err(err)?;
    let artifact_root = state.data_dir.join("artifacts");
    for path in artifacts {
        let candidate = std::path::PathBuf::from(path);
        if candidate.is_file() && candidate.starts_with(&artifact_root) {
            let _ = std::fs::remove_file(candidate);
        }
    }
    Ok(removed)
}
#[tauri::command]
pub fn approve_permissions(
    id: String,
    mut permissions: PermissionSummary,
    state: State<'_, AppState>,
) -> Result<Workflow> {
    let mut workflow = state
        .engine
        .database()
        .get_workflow(&id)
        .map_err(err)?
        .ok_or_else(|| "Workflow no longer exists.".to_string())?;
    permissions.approval_revision = Some(Uuid::new_v4().to_string());
    workflow.settings.permissions = permissions;
    state.engine.database().save_workflow(workflow).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStatus {
    paused: bool,
    active_workflow_ids: Vec<String>,
    local_schedules_stop_on_quit: bool,
}
#[tauri::command]
pub fn runner_status(state: State<'_, AppState>) -> RunnerStatus {
    RunnerStatus {
        paused: state.paused.load(Ordering::SeqCst),
        active_workflow_ids: state.cancellations.lock().keys().cloned().collect(),
        local_schedules_stop_on_quit: true,
    }
}

#[tauri::command]
pub async fn browser_engine_status(
    state: State<'_, AppState>,
) -> Result<crate::browser_sidecar::BrowserEngineStatus> {
    Ok(state.browser_sidecar.status().await)
}

#[tauri::command]
pub async fn restart_browser_engine(
    state: State<'_, AppState>,
) -> Result<crate::browser_sidecar::BrowserEngineStatus> {
    state.browser_sidecar.restart().await
}

#[tauri::command]
pub fn list_browser_profiles(state: State<'_, AppState>) -> Result<Vec<BrowserProfile>> {
    state.engine.database().list_browser_profiles().map_err(err)
}

#[tauri::command]
pub fn create_browser_profile(
    name: String,
    persistent: Option<bool>,
    settings: Option<BrowserProfileSettings>,
    state: State<'_, AppState>,
) -> Result<BrowserProfile> {
    let name = name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err("Browser profile name must contain 1 to 80 characters.".into());
    }
    let id = Uuid::new_v4().to_string();
    let path = state.data_dir.join("browser-profiles").join(&id);
    std::fs::create_dir_all(&path).map_err(err)?;
    let profile = BrowserProfile {
        id,
        name: name.into(),
        persistent: persistent.unwrap_or(true),
        data_path: path.to_string_lossy().to_string(),
        settings: settings.unwrap_or_default(),
        created_at: chrono::Utc::now(),
        last_used_at: None,
    };
    state
        .engine
        .database()
        .save_browser_profile(&profile)
        .map_err(err)?;
    Ok(profile)
}

#[tauri::command]
pub fn update_browser_profile(
    id: String,
    name: String,
    persistent: bool,
    settings: BrowserProfileSettings,
    state: State<'_, AppState>,
) -> Result<BrowserProfile> {
    let mut profile = state
        .engine
        .database()
        .get_browser_profile(&id)
        .map_err(err)?
        .ok_or_else(|| "Browser profile no longer exists.".to_string())?;
    if name.trim().is_empty() || name.len() > 80 {
        return Err("Browser profile name must contain 1 to 80 characters.".into());
    }
    profile.name = name.trim().into();
    profile.persistent = persistent;
    profile.settings = settings;
    state
        .engine
        .database()
        .save_browser_profile(&profile)
        .map_err(err)?;
    Ok(profile)
}

#[tauri::command]
pub fn duplicate_browser_profile(id: String, state: State<'_, AppState>) -> Result<BrowserProfile> {
    let source = state
        .engine
        .database()
        .get_browser_profile(&id)
        .map_err(err)?
        .ok_or_else(|| "Browser profile no longer exists.".to_string())?;
    let new_id = Uuid::new_v4().to_string();
    let path = state.data_dir.join("browser-profiles").join(&new_id);
    std::fs::create_dir_all(&path).map_err(err)?;
    let profile = BrowserProfile {
        id: new_id,
        name: format!("{} copy", source.name),
        persistent: source.persistent,
        data_path: path.to_string_lossy().to_string(),
        settings: source.settings,
        created_at: chrono::Utc::now(),
        last_used_at: None,
    };
    state
        .engine
        .database()
        .save_browser_profile(&profile)
        .map_err(err)?;
    Ok(profile)
}

#[tauri::command]
pub async fn clear_browser_profile_data(id: String, state: State<'_, AppState>) -> Result<()> {
    let profile = state
        .engine
        .database()
        .get_browser_profile(&id)
        .map_err(err)?
        .ok_or_else(|| "Browser profile no longer exists.".to_string())?;
    state
        .browser_sidecar
        .request("close_all", json!({}))
        .await
        .map_err(err)?;
    let path = checked_profile_path(&state, &profile)?;
    if path.exists() {
        std::fs::remove_dir_all(&path).map_err(err)?;
    }
    std::fs::create_dir_all(&path).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_browser_profile(id: String, state: State<'_, AppState>) -> Result<()> {
    let profile = state
        .engine
        .database()
        .get_browser_profile(&id)
        .map_err(err)?
        .ok_or_else(|| "Browser profile no longer exists.".to_string())?;
    let used = state
        .engine
        .database()
        .workflows_using_reference(&id)
        .map_err(err)?;
    if !used.is_empty() {
        return Err(format!("This browser profile is used by {} workflow(s). Remove those references before deleting it.",used.len()));
    }
    state
        .browser_sidecar
        .request("close_all", json!({}))
        .await
        .map_err(err)?;
    let path = checked_profile_path(&state, &profile)?;
    if path.exists() {
        std::fs::remove_dir_all(&path).map_err(err)?;
    }
    state
        .engine
        .database()
        .delete_browser_profile(&id)
        .map_err(err)
}

#[tauri::command]
pub async fn open_browser_profile(
    id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let profile = state
        .engine
        .database()
        .get_browser_profile(&id)
        .map_err(err)?
        .ok_or_else(|| "Browser profile no longer exists.".to_string())?;
    state.browser_sidecar.request("open_browser",json!({"profileId":profile.id,"profilePath":profile.data_path,"persistent":profile.persistent,"headed":true,"viewport":{"width":profile.settings.viewport_width,"height":profile.settings.viewport_height},"userAgent":profile.settings.user_agent,"proxy":profile.settings.proxy,"closeAutomatically":false})).await.map_err(err)
}

#[tauri::command]
pub async fn start_browser_recording(
    profile_id: String,
    initial_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let opened = open_browser_profile(profile_id, state.clone()).await?;
    let session_id = opened
        .get("browserSession")
        .and_then(|value| value.get("sessionId"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "The browser recorder did not receive a session.".to_string())?;
    state
        .browser_sidecar
        .request(
            "recorder_start",
            json!({"sessionId":session_id,"initialUrl":initial_url}),
        )
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn stop_browser_recording(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let result = state
        .browser_sidecar
        .request("recorder_stop", json!({"sessionId":session_id}))
        .await
        .map_err(err)?;
    let _ = state
        .browser_sidecar
        .request("close_browser", json!({"sessionId":session_id}))
        .await;
    Ok(result)
}

#[tauri::command]
pub async fn get_browser_recording(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    state
        .browser_sidecar
        .request("recorder_snapshot", json!({"sessionId":session_id}))
        .await
        .map_err(err)
}

#[tauri::command]
pub fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionMetadata>> {
    state.engine.database().list_connections().map_err(err)
}

#[tauri::command]
pub fn create_connection(
    provider: String,
    display_name: String,
    account_identifier: Option<String>,
    scopes: Vec<String>,
    expires_at: Option<DateTime<Utc>>,
    metadata: Value,
    secret: Value,
    state: State<'_, AppState>,
) -> Result<ConnectionMetadata> {
    validate_connection_input(&provider, &display_name, &metadata, &secret)?;
    let connection = ConnectionMetadata {
        id: Uuid::new_v4().to_string(),
        provider: provider.to_lowercase(),
        display_name: display_name.trim().to_string(),
        account_identifier: account_identifier.filter(|value| !value.trim().is_empty()),
        scopes,
        created_at: Utc::now(),
        last_used_at: None,
        expires_at,
        status: ConnectionStatus::Connected,
        metadata,
    };
    state.credential_vault.put(&connection.id, &secret)?;
    if let Err(error) = state.engine.database().save_connection(&connection) {
        let _ = state.credential_vault.delete(&connection.id);
        return Err(error.to_string());
    }
    Ok(connection)
}

#[tauri::command]
pub fn rename_connection(
    id: String,
    display_name: String,
    state: State<'_, AppState>,
) -> Result<ConnectionMetadata> {
    if display_name.trim().is_empty() {
        return Err("Connection name is required.".into());
    }
    let mut connection = state
        .engine
        .database()
        .get_connection(&id)
        .map_err(err)?
        .ok_or_else(|| "Connection no longer exists.".to_string())?;
    connection.display_name = display_name.trim().to_string();
    state
        .engine
        .database()
        .save_connection(&connection)
        .map_err(err)?;
    Ok(connection)
}

#[tauri::command]
pub fn reconnect_connection(
    id: String,
    secret: Value,
    expires_at: Option<DateTime<Utc>>,
    state: State<'_, AppState>,
) -> Result<ConnectionMetadata> {
    let mut connection = state
        .engine
        .database()
        .get_connection(&id)
        .map_err(err)?
        .ok_or_else(|| "Connection no longer exists.".to_string())?;
    validate_connection_input(
        &connection.provider,
        &connection.display_name,
        &connection.metadata,
        &secret,
    )?;
    state.credential_vault.put(&id, &secret)?;
    connection.expires_at = expires_at;
    connection.status = ConnectionStatus::Connected;
    state
        .engine
        .database()
        .save_connection(&connection)
        .map_err(err)?;
    Ok(connection)
}

#[tauri::command]
pub fn test_connection(id: String, state: State<'_, AppState>) -> Result<Value> {
    let connection = state
        .engine
        .database()
        .get_connection(&id)
        .map_err(err)?
        .ok_or_else(|| "Connection no longer exists.".to_string())?;
    if !state.credential_vault.exists(&id)? {
        return Err(format!(
            "{} has no secret in the operating-system credential store. Reconnect it.",
            connection.display_name
        ));
    }
    Ok(
        json!({"healthy":true,"provider":connection.provider,"message":"Credential is available in the operating-system store."}),
    )
}

#[tauri::command]
pub async fn revoke_connection(
    id: String,
    state: State<'_, AppState>,
) -> Result<ConnectionMetadata> {
    let mut connection = state
        .engine
        .database()
        .get_connection(&id)
        .map_err(err)?
        .ok_or_else(|| "Connection no longer exists.".to_string())?;
    if state.credential_vault.exists(&id)? {
        if connection.provider == "gmail" {
            let secret = state.credential_vault.get(&id)?;
            let token = secret.get("refreshToken").or_else(|| secret.get("accessToken")).and_then(Value::as_str).ok_or_else(|| "The Gmail token is unavailable. Delete the local connection if it was already revoked at Google.".to_string())?;
            let response = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(err)?
                .post(oauth::GMAIL_REVOKE_URL)
                .form(&[("token", token)])
                .send()
                .await
                .map_err(|error| format!("Gmail revocation could not connect: {error}"))?;
            if !response.status().is_success() {
                return Err(format!("Gmail rejected token revocation with HTTP {}. The local secret was retained so you can retry.", response.status()));
            }
        }
        state.credential_vault.delete(&id)?;
    }
    connection.status = ConnectionStatus::Revoked;
    state
        .engine
        .database()
        .save_connection(&connection)
        .map_err(err)?;
    Ok(connection)
}

#[tauri::command]
pub fn delete_connection(id: String, state: State<'_, AppState>) -> Result<()> {
    if state.credential_vault.exists(&id)? {
        state.credential_vault.delete(&id)?;
    }
    state.engine.database().delete_connection(&id).map_err(err)
}

#[tauri::command]
pub fn workflows_using_connection(id: String, state: State<'_, AppState>) -> Result<Vec<String>> {
    state
        .engine
        .database()
        .workflows_using_reference(&id)
        .map_err(err)
}

#[tauri::command]
pub fn account_status(state: State<'_, AppState>) -> Result<account_auth::AccountStatus> {
    let configuration = account_auth::configured();
    let metadata = state
        .engine
        .database()
        .get_setting::<account_auth::AccountMetadata>(account_auth::ACCOUNT_METADATA_KEY)
        .map_err(err)?;
    let has_secret = state
        .credential_vault
        .exists(account_auth::ACCOUNT_VAULT_ID)?;
    Ok(account_auth::AccountStatus {
        configured: configuration.is_ok(),
        signed_in: metadata.is_some() && has_secret,
        metadata,
        local_workflows_available: true,
        configuration_error: configuration.err(),
    })
}

#[tauri::command]
pub async fn start_account_auth(
    create_account: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<account_auth::AccountAuthStart> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| {
            format!("Sandbox could not open a local account callback port: {error}")
        })?;
    let address = listener.local_addr().map_err(err)?;
    let redirect_uri = format!("http://127.0.0.1:{}/account/callback", address.port());
    let (attempt, start) = account_auth::start(redirect_uri, create_account)?;
    app.opener()
        .open_url(&start.authorization_url, None::<&str>)
        .map_err(|error| {
            format!("The account page could not be opened in the system browser: {error}")
        })?;
    let database = state.engine.database().clone();
    let vault = state.credential_vault.clone();
    tauri::async_runtime::spawn(async move {
        let result: Result<account_auth::AccountMetadata> = async {
            let (mut stream, _) =
                tokio::time::timeout(std::time::Duration::from_secs(300), listener.accept())
                    .await
                    .map_err(|_| "Account authorization expired after five minutes.".to_string())?
                    .map_err(|error| format!("Account callback could not be accepted: {error}"))?;
            let mut request = vec![0_u8; 16 * 1024];
            let count = stream.read(&mut request).await.map_err(err)?;
            let request = String::from_utf8_lossy(&request[..count]);
            let target = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .ok_or_else(|| "Account callback request was invalid.".to_string())?;
            let callback_url = format!("http://127.0.0.1:{}{}", address.port(), target);
            let code = match attempt.validate_callback(&callback_url) {
                Ok(code) => code,
                Err(error) => {
                    write_oauth_response(&mut stream, false, &error).await;
                    return Err(error);
                }
            };
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(err)?;
            let (secret, metadata) = match attempt.exchange(&client, &code).await {
                Ok(value) => value,
                Err(error) => {
                    write_oauth_response(&mut stream, false, &error).await;
                    return Err(error);
                }
            };
            vault.put(account_auth::ACCOUNT_VAULT_ID, &secret)?;
            if let Err(error) = database.set_setting(account_auth::ACCOUNT_METADATA_KEY, &metadata)
            {
                let _ = vault.delete(account_auth::ACCOUNT_VAULT_ID);
                return Err(error.to_string());
            }
            write_oauth_response(
                &mut stream,
                true,
                "Sandbox is connected. You can close this tab and return to the desktop app.",
            )
            .await;
            Ok(metadata)
        }
        .await;
        match result {
            Ok(metadata) => {
                let _ = app.emit("account-session-updated", metadata);
            }
            Err(error) => {
                let _ = app.emit("account-session-error", error);
            }
        }
    });
    Ok(start)
}

#[tauri::command]
pub fn sign_out_account(state: State<'_, AppState>) -> Result<()> {
    if state
        .credential_vault
        .exists(account_auth::ACCOUNT_VAULT_ID)?
    {
        state
            .credential_vault
            .delete(account_auth::ACCOUNT_VAULT_ID)?;
    }
    state
        .engine
        .database()
        .delete_setting(account_auth::ACCOUNT_METADATA_KEY)
        .map_err(err)
}

#[tauri::command]
pub fn list_pending_approvals(state: State<'_, AppState>) -> Result<Vec<PendingApproval>> {
    state
        .engine
        .database()
        .list_pending_approvals()
        .map_err(err)
}

#[tauri::command]
pub fn resolve_pending_approval(
    id: String,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<()> {
    let changed = state
        .engine
        .database()
        .resolve_pending_approval(&id, if approved { "approved" } else { "rejected" })
        .map_err(err)?;
    if changed {
        Ok(())
    } else {
        Err("This approval was already resolved or has expired.".into())
    }
}

fn validate_connection_input(
    provider: &str,
    display_name: &str,
    metadata: &Value,
    secret: &Value,
) -> Result<()> {
    if !matches!(
        provider.to_lowercase().as_str(),
        "gmail" | "discord" | "slack"
    ) {
        return Err("Only Gmail, Discord, and Slack connections are supported in v0.2.0.".into());
    }
    if display_name.trim().is_empty() {
        return Err("Connection name is required.".into());
    }
    if !secret.is_object() || secret.as_object().is_some_and(|object| object.is_empty()) {
        return Err("Connection secret material is required and will be stored only in the operating-system vault.".into());
    }
    if contains_sensitive_metadata(metadata) {
        return Err("Connection metadata contains a secret-like field. Tokens, passwords, and webhook URLs must be stored in the credential vault.".into());
    }
    Ok(())
}

fn contains_sensitive_metadata(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let key = key.to_lowercase();
            [
                "secret",
                "token",
                "password",
                "webhook",
                "authorization",
                "cookie",
            ]
            .iter()
            .any(|part| key.contains(part))
                || contains_sensitive_metadata(value)
        }),
        Value::Array(values) => values.iter().any(contains_sensitive_metadata),
        _ => false,
    }
}

#[tauri::command]
pub async fn start_gmail_oauth(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<oauth::OAuthStart> {
    let client_id = oauth::gmail_client_id()?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Sandbox could not open a local OAuth callback port: {error}"))?;
    let address = listener.local_addr().map_err(err)?;
    let redirect_uri = format!("http://127.0.0.1:{}/oauth/callback", address.port());
    let (attempt, start) = oauth::start_gmail(&client_id, redirect_uri.clone())?;
    app.opener()
        .open_url(&start.authorization_url, None::<&str>)
        .map_err(|error| format!("The Gmail authorization page could not be opened: {error}"))?;
    let database = state.engine.database().clone();
    let vault = state.credential_vault.clone();
    tauri::async_runtime::spawn(async move {
        let result: Result<ConnectionMetadata> = async {
            let (mut stream, _) =
                tokio::time::timeout(std::time::Duration::from_secs(300), listener.accept())
                    .await
                    .map_err(|_| "Gmail authorization expired after five minutes.".to_string())?
                    .map_err(|error| format!("OAuth callback could not be accepted: {error}"))?;
            let mut request = vec![0_u8; 16 * 1024];
            let count = stream.read(&mut request).await.map_err(err)?;
            let request = String::from_utf8_lossy(&request[..count]);
            let target = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .ok_or_else(|| "OAuth callback request was invalid.".to_string())?;
            let callback_url = format!("http://127.0.0.1:{}{}", address.port(), target);
            let code = match attempt.validate_callback(&callback_url) {
                Ok(code) => code,
                Err(error) => {
                    write_oauth_response(&mut stream, false, &error).await;
                    return Err(error);
                }
            };
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(err)?;
            let token = match oauth::exchange_gmail_code(&client, &client_id, &attempt, &code).await
            {
                Ok(token) => token,
                Err(error) => {
                    write_oauth_response(&mut stream, false, &error).await;
                    return Err(error);
                }
            };
            let profile: Value = client
                .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
                .bearer_auth(&token.access_token)
                .send()
                .await
                .map_err(|error| format!("Gmail profile could not be read: {error}"))?
                .json()
                .await
                .map_err(|error| format!("Gmail profile response was invalid: {error}"))?;
            let email = profile
                .get("emailAddress")
                .and_then(Value::as_str)
                .unwrap_or("Gmail account")
                .to_string();
            let connection = ConnectionMetadata {
                id: Uuid::new_v4().to_string(),
                provider: "gmail".into(),
                display_name: email.clone(),
                account_identifier: Some(email),
                scopes: token
                    .scope
                    .as_deref()
                    .unwrap_or(oauth::GMAIL_SCOPES)
                    .split_whitespace()
                    .map(str::to_string)
                    .collect(),
                created_at: Utc::now(),
                last_used_at: None,
                expires_at: token
                    .expires_in
                    .map(|seconds| Utc::now() + chrono::Duration::seconds(seconds)),
                status: ConnectionStatus::Connected,
                metadata: json!({"authType":"oauth2_pkce"}),
            };
            vault.put(&connection.id, &oauth::token_secret(&token))?;
            if let Err(error) = database.save_connection(&connection) {
                let _ = vault.delete(&connection.id);
                return Err(error.to_string());
            }
            write_oauth_response(
                &mut stream,
                true,
                "Gmail is connected. You can close this tab and return to Sandbox.",
            )
            .await;
            Ok(connection)
        }
        .await;
        match result {
            Ok(connection) => {
                let _ = app.emit("connection-updated", connection);
            }
            Err(error) => {
                let _ = app.emit("connection-error", error);
            }
        }
    });
    Ok(start)
}

async fn write_oauth_response(stream: &mut tokio::net::TcpStream, success: bool, message: &str) {
    let title = if success {
        "Connected"
    } else {
        "Connection failed"
    };
    let safe_message = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let body = format!("<!doctype html><meta charset=utf-8><title>{title}</title><style>body{{margin:0;background:#09090b;color:#f4f4f5;font:14px system-ui;display:grid;place-items:center;height:100vh}}main{{max-width:460px;border:1px solid #29292d;border-radius:8px;padding:24px;background:#111113}}h1{{font-size:18px}}p{{color:#a1a1aa;line-height:1.5}}</style><main><h1>{title}</h1><p>{safe_message}</p></main>");
    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[tauri::command]
pub async fn test_browser_locator(
    session_id: String,
    locator: StructuredLocator,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    state
        .browser_sidecar
        .request(
            "test_locator",
            json!({"sessionId":session_id,"locator":locator}),
        )
        .await
        .map_err(err)
}

fn checked_profile_path(state: &AppState, profile: &BrowserProfile) -> Result<std::path::PathBuf> {
    let root = state.data_dir.join("browser-profiles");
    let path = std::path::PathBuf::from(&profile.data_path);
    if !path.starts_with(&root) || path == root {
        return Err("Browser profile path failed its safety check.".into());
    }
    Ok(path)
}

fn sanitize_export_definition(
    definition: &mut Value,
    state: &AppState,
    required_connections: &mut Vec<Value>,
    required_profiles: &mut Vec<Value>,
    local_path_fields: &mut Vec<String>,
) -> Result<()> {
    let nodes = definition
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "The workflow definition does not contain nodes.".to_string())?;
    for node in nodes {
        let node_id = node
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("unknown-node")
            .to_string();
        let Some(configuration) = node.get_mut("configuration").and_then(Value::as_object_mut)
        else {
            continue;
        };
        if let Some(credential_id) = configuration
            .remove("credentialId")
            .and_then(|value| value.as_str().map(str::to_string))
            .filter(|value| !value.is_empty())
        {
            let connection = state
                .engine
                .database()
                .get_connection(&credential_id)
                .map_err(err)?;
            let requirement_id = format!("connection-{}", required_connections.len() + 1);
            required_connections.push(json!({
                "requirementId": requirement_id.clone(),
                "nodeId": node_id,
                "provider": connection.as_ref().map(|item| item.provider.as_str()).unwrap_or("unknown"),
                "displayName": connection.as_ref().map(|item| item.display_name.as_str()).unwrap_or("Connection required"),
                "scopes": connection.as_ref().map(|item| item.scopes.clone()).unwrap_or_default()
            }));
            configuration.insert(
                "connectionRequirementId".into(),
                Value::String(requirement_id),
            );
        }
        if let Some(profile_id) = configuration
            .remove("profileId")
            .and_then(|value| value.as_str().map(str::to_string))
            .filter(|value| !value.is_empty())
        {
            let profile = state
                .engine
                .database()
                .get_browser_profile(&profile_id)
                .map_err(err)?;
            let requirement_id = format!("browser-profile-{}", required_profiles.len() + 1);
            required_profiles.push(json!({
                "requirementId": requirement_id.clone(),
                "nodeId": node_id,
                "displayName": profile.as_ref().map(|item| item.name.as_str()).unwrap_or("Managed browser profile")
            }));
            configuration.insert(
                "browserProfileRequirementId".into(),
                Value::String(requirement_id),
            );
        }
        if let Some(headers) = configuration
            .get_mut("headers")
            .and_then(Value::as_object_mut)
        {
            headers.retain(|key, _| {
                !matches!(
                    key.to_ascii_lowercase().as_str(),
                    "authorization" | "proxy-authorization" | "cookie" | "set-cookie" | "x-api-key"
                )
            });
        }
        for key in [
            "folder",
            "destinationFolder",
            "downloadFolder",
            "file",
            "workingDirectory",
            "source",
            "outputPath",
        ] {
            let Some(value) = configuration.get_mut(key) else {
                continue;
            };
            let Some(path) = value.as_str() else { continue };
            if std::path::Path::new(path).is_absolute() {
                local_path_fields.push(format!("{node_id}.{key}"));
                *value = Value::String(String::new());
            }
        }
    }
    if let Some(permissions) = definition
        .pointer_mut("/settings/permissions")
        .and_then(Value::as_object_mut)
    {
        permissions.insert("approvedFolders".into(), json!([]));
        permissions.insert("approvedBrowserProfileIds".into(), json!([]));
        permissions.insert("commandExecutionPermitted".into(), Value::Bool(false));
        permissions.insert("backgroundExecutionPermitted".into(), Value::Bool(false));
        permissions.insert("browserAutomationPermitted".into(), Value::Bool(false));
        permissions.insert("externalCommunicationPermitted".into(), Value::Bool(false));
        permissions.insert("approvalRevision".into(), Value::Null);
        permissions.insert("communicationApprovalRevision".into(), Value::Null);
    }
    Ok(())
}

fn contains_secret_material(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized = key.to_ascii_lowercase().replace(['_', '-'], "");
            matches!(
                normalized.as_str(),
                "password"
                    | "accesstoken"
                    | "refreshtoken"
                    | "clientsecret"
                    | "webhookurl"
                    | "authorization"
                    | "cookies"
                    | "cookie"
            ) || contains_secret_material(value)
        }),
        Value::Array(values) => values.iter().any(contains_secret_material),
        _ => false,
    }
}

fn safe_filename(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if sanitized.is_empty() {
        "workflow".into()
    } else {
        sanitized
    }
}
