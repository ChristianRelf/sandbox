use crate::AppState;
use chrono::{DateTime, Utc};
use notify::{EventKind, RecursiveMode, Watcher};
use sandbox_engine::{schedule::next_run, Workflow};
use serde_json::json;
use std::{
    collections::hash_map::Entry,
    path::Path,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    App, AppHandle, Manager,
};
use tokio_util::sync::CancellationToken;

pub fn create_tray(app: &mut App, state: &AppState) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "Open Sandbox").build(app)?;
    let pause = CheckMenuItemBuilder::with_id("pause", "Pause Automations").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &pause, &quit])
        .build()?;
    let paused = state.paused.clone();
    let quitting = state.quitting.clone();
    let mut builder = TrayIconBuilder::with_id("runner")
        .menu(&menu)
        .tooltip("Sandbox runner · Active")
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "pause" => {
                let next = !paused.load(Ordering::SeqCst);
                paused.store(next, Ordering::SeqCst);
                if let Some(tray) = app.tray_by_id("runner") {
                    let _ = tray.set_tooltip(Some(if next {
                        "Sandbox runner · Paused"
                    } else {
                        "Sandbox runner · Active"
                    }));
                }
            }
            "quit" => {
                quitting.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn start_background_services(app: AppHandle, state: &AppState) {
    let engine = state.engine.clone();
    let paused = state.paused.clone();
    let cancellations = state.cancellations.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            if paused.load(Ordering::SeqCst) {
                continue;
            }
            for (workflow, scheduled_at) in due_schedule_workflows(&engine, Utc::now()) {
                spawn_run(
                    engine.clone(),
                    cancellations.clone(),
                    workflow,
                    json!({"type":"schedule","scheduledAt":scheduled_at}),
                );
            }
        }
    });
    start_file_watch_service(app, state);
}

fn due_schedule_workflows(
    engine: &sandbox_engine::Engine,
    now: DateTime<Utc>,
) -> Vec<(Workflow, DateTime<Utc>)> {
    let Ok(workflows) = engine.database().list_workflows() else {
        return vec![];
    };
    workflows
        .into_iter()
        .filter_map(|summary| {
            let workflow = summary.workflow;
            if !workflow.enabled || !workflow.settings.permissions.background_execution_permitted {
                return None;
            }
            let trigger = workflow
                .nodes
                .iter()
                .find(|node| node.id == workflow.trigger_node_id)?;
            if trigger.node_type != "schedule_trigger" {
                return None;
            }
            let next_at = summary
                .next_run_at
                .or_else(|| next_run(trigger, now).ok())?;
            if summary.next_run_at.is_none() {
                let _ = engine.database().set_next_run(&workflow.id, Some(next_at));
            }
            if next_at > now {
                return None;
            }
            let next_after = next_run(trigger, now).ok();
            let _ = engine.database().set_next_run(&workflow.id, next_after);
            Some((workflow, next_at))
        })
        .collect()
}

fn spawn_run(
    engine: sandbox_engine::Engine,
    cancellations: Arc<parking_lot::Mutex<std::collections::HashMap<String, CancellationToken>>>,
    workflow: Workflow,
    trigger: serde_json::Value,
) {
    tauri::async_runtime::spawn(async move {
        let token = CancellationToken::new();
        let id = workflow.id.clone();
        let owns_token = {
            let mut active = cancellations.lock();
            match active.entry(id.clone()) {
                Entry::Vacant(entry) => {
                    entry.insert(token.clone());
                    true
                }
                Entry::Occupied(_) => false,
            }
        };
        let _ = engine.run(workflow, trigger, token).await;
        if owns_token {
            cancellations.lock().remove(&id);
        }
    });
}

fn start_file_watch_service(_app: AppHandle, state: &AppState) {
    let engine = state.engine.clone();
    let paused = state.paused.clone();
    let cancellations = state.cancellations.clone();
    std::thread::spawn(move || {
        let mut watchers: Vec<notify::RecommendedWatcher> = Vec::new();
        loop {
            watchers.clear();
            if !paused.load(Ordering::SeqCst) {
                if let Ok(workflows) = engine.database().list_workflows() {
                    for summary in workflows {
                        let workflow = summary.workflow;
                        if !workflow.enabled
                            || !workflow.settings.permissions.background_execution_permitted
                        {
                            continue;
                        }
                        let Some(trigger_node) = workflow.nodes.iter().find(|n| {
                            n.id == workflow.trigger_node_id && n.node_type == "file_watch_trigger"
                        }) else {
                            continue;
                        };
                        let Some(folder) = trigger_node
                            .configuration
                            .get("folder")
                            .and_then(|v| v.as_str())
                        else {
                            continue;
                        };
                        if folder.is_empty()
                            || !workflow
                                .settings
                                .permissions
                                .approved_folders
                                .iter()
                                .any(|p| Path::new(folder).starts_with(p))
                        {
                            continue;
                        }
                        let wf = workflow.clone();
                        let engine2 = engine.clone();
                        let cancel2 = cancellations.clone();
                        let events = trigger_node
                            .configuration
                            .get("events")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let pattern = trigger_node
                            .configuration
                            .get("pattern")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if let Ok(mut watcher) = notify::recommended_watcher(
                            move |result: notify::Result<notify::Event>| {
                                if let Ok(event) = result {
                                    let event_type = match event.kind {
                                        EventKind::Create(_) => "created",
                                        EventKind::Modify(_) => "modified",
                                        EventKind::Remove(_) => "deleted",
                                        _ => return,
                                    };
                                    if !events.is_empty()
                                        && !events.iter().any(|v| v.as_str() == Some(event_type))
                                    {
                                        return;
                                    }
                                    for path in event.paths {
                                        let filename = path
                                            .file_name()
                                            .map(|v| v.to_string_lossy().to_string())
                                            .unwrap_or_default();
                                        if !pattern.is_empty() && !glob_match(&pattern, &filename) {
                                            continue;
                                        }
                                        let trigger = json!({"type":"file_watch","path":path,"filename":filename,"extension":path.extension().map(|v|v.to_string_lossy().to_string()),"eventType":event_type,"timestamp":Utc::now()});
                                        spawn_run(
                                            engine2.clone(),
                                            cancel2.clone(),
                                            wf.clone(),
                                            trigger,
                                        );
                                    }
                                }
                            },
                        ) {
                            if watcher
                                .watch(Path::new(folder), RecursiveMode::NonRecursive)
                                .is_ok()
                            {
                                watchers.push(watcher);
                            }
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}
fn glob_match(pattern: &str, name: &str) -> bool {
    globset::Glob::new(pattern)
        .ok()
        .map(|g| g.compile_matcher().is_match(name))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::templates;
    use chrono::Duration as ChronoDuration;
    use sandbox_engine::{Database, Engine, LocalHost};

    #[test]
    fn due_schedule_tick_advances_state_and_returns_workflow() {
        let engine = Engine::new(Database::in_memory().unwrap(), Arc::new(LocalHost));
        let mut workflow = templates::by_key("blank", Some("Scheduled".into()));
        workflow.enabled = true;
        workflow.settings.permissions.background_execution_permitted = true;
        workflow.nodes[0].node_type = "schedule_trigger".into();
        workflow.nodes[0].configuration = json!({"scheduleType":"minutes","every":5});
        engine.database().save_workflow(workflow.clone()).unwrap();
        let now = Utc::now();
        engine
            .database()
            .set_next_run(&workflow.id, Some(now - ChronoDuration::seconds(1)))
            .unwrap();

        let due = due_schedule_workflows(&engine, now);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0.id, workflow.id);
        assert!(engine
            .database()
            .get_next_run(&workflow.id)
            .unwrap()
            .is_some_and(|next| next > now));
    }
}
