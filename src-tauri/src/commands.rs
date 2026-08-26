use crate::{templates, AppState};
use sandbox_engine::{
    validation::{validate, ValidationIssue},
    BrowserProfile, BrowserProfileSettings, ExecutionRecord, PermissionSummary, StructuredLocator,
    Workflow, WorkflowSummary,
};
use serde::Serialize;
use serde_json::json;
use std::collections::hash_map::Entry;
use std::sync::atomic::Ordering;
use tauri::State;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
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
    state
        .engine
        .database()
        .clear_old_executions(keep.unwrap_or(0))
        .map_err(err)
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
