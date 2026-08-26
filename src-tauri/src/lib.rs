mod browser_sidecar;
mod commands;
mod runner;
mod templates;

use async_trait::async_trait;
use browser_sidecar::BrowserSidecar;
use parking_lot::Mutex;
use sandbox_engine::{BrowserDiagnostics, Database, Engine, EngineError, HostServices};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio_util::sync::CancellationToken;

pub struct TauriHost {
    app: tauri::AppHandle,
    database: Database,
    browser_sidecar: BrowserSidecar,
    data_dir: std::path::PathBuf,
}
#[async_trait]
impl HostServices for TauriHost {
    async fn desktop_notification(&self, title: &str, message: &str) -> Result<(), EngineError> {
        self.app
            .notification()
            .builder()
            .title(title)
            .body(message)
            .show()
            .map_err(|error| {
                EngineError::Node(format!(
                    "Desktop Notification could not be delivered: {error}"
                ))
            })
    }

    async fn browser_operation(
        &self,
        operation: &str,
        mut payload: Value,
    ) -> Result<Value, EngineError> {
        let object = payload.as_object_mut().ok_or_else(|| {
            EngineError::Node("Browser operation payload must be an object.".into())
        })?;
        if operation == "open_browser" {
            let profile_id = object
                .get("profileId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    EngineError::Node("Open Browser requires a browser profile.".into())
                })?;
            let mut profile = self
                .database
                .get_browser_profile(profile_id)?
                .ok_or_else(|| {
                    EngineError::Node("The selected browser profile no longer exists.".into())
                })?;
            object.insert(
                "profilePath".into(),
                Value::String(profile.data_path.clone()),
            );
            object
                .entry("persistent")
                .or_insert(Value::Bool(profile.persistent));
            object.entry("viewport").or_insert(json!({"width":profile.settings.viewport_width,"height":profile.settings.viewport_height}));
            if let Some(user_agent) = profile.settings.user_agent.clone() {
                object
                    .entry("userAgent")
                    .or_insert(Value::String(user_agent));
            }
            if let Some(proxy) = profile.settings.proxy.clone() {
                object.entry("proxy").or_insert(Value::String(proxy));
            }
            profile.last_used_at = Some(chrono::Utc::now());
            self.database.save_browser_profile(&profile)?;
        }
        let workflow = object
            .get("workflowId")
            .and_then(Value::as_str)
            .unwrap_or("manual");
        let node = object
            .get("nodeId")
            .and_then(Value::as_str)
            .unwrap_or(operation);
        let diagnostic_directory = self
            .data_dir
            .join("artifacts")
            .join("browser")
            .join(workflow)
            .join(node);
        object.entry("diagnosticDirectory").or_insert(Value::String(
            diagnostic_directory.to_string_lossy().to_string(),
        ));
        if operation == "screenshot" && !object.contains_key("outputPath") {
            let output =
                diagnostic_directory.join(format!("screenshot-{}.png", uuid::Uuid::new_v4()));
            object.insert(
                "outputPath".into(),
                Value::String(output.to_string_lossy().to_string()),
            );
        }
        self.browser_sidecar
            .request(operation, payload)
            .await
            .map_err(|encoded| {
                let parsed: Value =
                    serde_json::from_str(&encoded).unwrap_or_else(|_| json!({"message":encoded}));
                let message = parsed
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("The managed browser operation failed.")
                    .to_string();
                let diagnostics = parsed
                    .get("details")
                    .cloned()
                    .and_then(|value| serde_json::from_value::<BrowserDiagnostics>(value).ok());
                EngineError::Browser {
                    message,
                    diagnostics,
                }
            })
    }
}

pub struct AppState {
    pub engine: Engine,
    pub cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub paused: Arc<AtomicBool>,
    pub quitting: Arc<AtomicBool>,
    pub browser_sidecar: BrowserSidecar,
    pub data_dir: std::path::PathBuf,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let database =
                Database::open(data_dir.join("sandbox.db")).map_err(|error| error.to_string())?;
            database
                .recover_unfinished()
                .map_err(|error| error.to_string())?;
            let browser_sidecar =
                BrowserSidecar::new(app.handle()).map_err(|error| error.to_string())?;
            let sidecar_for_verify = browser_sidecar.clone();
            tauri::async_runtime::block_on(async {
                let _ = sidecar_for_verify.verify().await;
            });
            let engine = Engine::new(
                database.clone(),
                Arc::new(TauriHost {
                    app: app.handle().clone(),
                    database,
                    browser_sidecar: browser_sidecar.clone(),
                    data_dir: data_dir.clone(),
                }),
            );
            let state = AppState {
                engine: engine.clone(),
                cancellations: Arc::new(Mutex::new(HashMap::new())),
                paused: Arc::new(AtomicBool::new(false)),
                quitting: Arc::new(AtomicBool::new(false)),
                browser_sidecar,
                data_dir,
            };
            runner::create_tray(app, &state)?;
            runner::start_background_services(app.handle().clone(), &state);
            let mut events = engine.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Ok(event) = events.recv().await {
                    let _ = handle.emit("runner-event", event);
                }
            });
            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.try_state::<AppState>() {
                    if !state.quitting.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_workflows,
            commands::get_workflow,
            commands::save_workflow,
            commands::delete_workflow,
            commands::create_workflow,
            commands::validate_workflow,
            commands::run_workflow,
            commands::retry_failed_node,
            commands::cancel_execution,
            commands::list_executions,
            commands::get_execution,
            commands::clear_execution_history,
            commands::approve_permissions,
            commands::runner_status,
            commands::browser_engine_status,
            commands::restart_browser_engine,
            commands::list_browser_profiles,
            commands::create_browser_profile,
            commands::update_browser_profile,
            commands::duplicate_browser_profile,
            commands::delete_browser_profile,
            commands::clear_browser_profile_data,
            commands::open_browser_profile,
            commands::start_browser_recording,
            commands::get_browser_recording,
            commands::stop_browser_recording,
            commands::test_browser_locator
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Sandbox");
}
