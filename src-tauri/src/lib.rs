mod commands;
mod runner;
mod templates;

use async_trait::async_trait;
use parking_lot::Mutex;
use sandbox_engine::{Database, Engine, EngineError, HostServices};
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
}

pub struct AppState {
    pub engine: Engine,
    pub cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub paused: Arc<AtomicBool>,
    pub quitting: Arc<AtomicBool>,
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
            let engine = Engine::new(
                database,
                Arc::new(TauriHost {
                    app: app.handle().clone(),
                }),
            );
            let state = AppState {
                engine: engine.clone(),
                cancellations: Arc::new(Mutex::new(HashMap::new())),
                paused: Arc::new(AtomicBool::new(false)),
                quitting: Arc::new(AtomicBool::new(false)),
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
            commands::runner_status
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Sandbox");
}
