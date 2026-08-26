use crate::{templates, AppState};
use sandbox_engine::{
    validation::{validate, ValidationIssue},
    ExecutionRecord, PermissionSummary, Workflow, WorkflowSummary,
};
use serde::Serialize;
use serde_json::json;
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
    state
        .cancellations
        .lock()
        .insert(workflow.id.clone(), token.clone());
    let result = state
        .engine
        .run(
            workflow,
            trigger.unwrap_or_else(|| json!({"type":"manual"})),
            token,
        )
        .await
        .map_err(err);
    state.cancellations.lock().remove(&id);
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
