use crate::AppState;
use chrono::Utc;
use notify::{EventKind, RecursiveMode, Watcher};
use sandbox_engine::{schedule::next_run, Workflow};
use serde_json::json;
use std::{path::Path, sync::{atomic::Ordering, Arc}, time::Duration};
use tauri::{menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder}, tray::TrayIconBuilder, App, AppHandle, Manager};
use tokio_util::sync::CancellationToken;

pub fn create_tray(app:&mut App,state:&AppState)->tauri::Result<()> {
    let open=MenuItemBuilder::with_id("open","Open Sandbox").build(app)?;
    let pause=CheckMenuItemBuilder::with_id("pause","Pause Automations").build(app)?;
    let quit=MenuItemBuilder::with_id("quit","Quit").build(app)?;
    let menu=MenuBuilder::new(app).items(&[&open,&pause,&quit]).build()?;
    let paused=state.paused.clone(); let quitting=state.quitting.clone();
    let mut builder=TrayIconBuilder::with_id("runner").menu(&menu).tooltip("Sandbox runner · Active").on_menu_event(move |app,event|match event.id.as_ref(){
        "open"=>{if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.set_focus();}},
        "pause"=>{let next=!paused.load(Ordering::SeqCst);paused.store(next,Ordering::SeqCst);if let Some(tray)=app.tray_by_id("runner"){let _=tray.set_tooltip(Some(if next{"Sandbox runner · Paused"}else{"Sandbox runner · Active"}));}},
        "quit"=>{quitting.store(true,Ordering::SeqCst);app.exit(0);},_=>{}});
    if let Some(icon)=app.default_window_icon(){builder=builder.icon(icon.clone());}
    builder.build(app)?; Ok(())
}

pub fn start_background_services(app:AppHandle,state:&AppState){
    let engine=state.engine.clone();let paused=state.paused.clone();let cancellations=state.cancellations.clone();
    tauri::async_runtime::spawn(async move{
        let mut interval=tokio::time::interval(Duration::from_secs(15));
        loop{interval.tick().await;if paused.load(Ordering::SeqCst){continue}let workflows=match engine.database().list_workflows(){Ok(v)=>v,Err(_)=>continue};
            for summary in workflows{let workflow=summary.workflow;if !workflow.enabled||!workflow.settings.permissions.background_execution_permitted{continue}let trigger=workflow.nodes.iter().find(|n|n.id==workflow.trigger_node_id);if trigger.is_none_or(|n|n.node_type!="schedule_trigger"){continue}let trigger=trigger.unwrap();
                let next=summary.next_run_at.or_else(||next_run(trigger,Utc::now()).ok());if let Some(next_at)=next{if summary.next_run_at.is_none(){let _=engine.database().set_next_run(&workflow.id,Some(next_at));}if next_at<=Utc::now(){let next_after=next_run(trigger,Utc::now()).ok();let _=engine.database().set_next_run(&workflow.id,next_after);spawn_run(engine.clone(),cancellations.clone(),workflow,json!({"type":"schedule","scheduledAt":next_at}));}}
            }
        }
    });
    start_file_watch_service(app,state);
}

fn spawn_run(engine:sandbox_engine::Engine,cancellations:Arc<parking_lot::Mutex<std::collections::HashMap<String,CancellationToken>>>,workflow:Workflow,trigger:serde_json::Value){tauri::async_runtime::spawn(async move{let token=CancellationToken::new();cancellations.lock().insert(workflow.id.clone(),token.clone());let id=workflow.id.clone();let _=engine.run(workflow,trigger,token).await;cancellations.lock().remove(&id);});}

fn start_file_watch_service(_app:AppHandle,state:&AppState){
    let engine=state.engine.clone();let paused=state.paused.clone();let cancellations=state.cancellations.clone();
    std::thread::spawn(move||{
        let mut watchers:Vec<notify::RecommendedWatcher>=Vec::new();
        loop{
            watchers.clear();
            if !paused.load(Ordering::SeqCst){if let Ok(workflows)=engine.database().list_workflows(){for summary in workflows{let workflow=summary.workflow;if !workflow.enabled||!workflow.settings.permissions.background_execution_permitted{continue}let Some(trigger_node)=workflow.nodes.iter().find(|n|n.id==workflow.trigger_node_id&&n.node_type=="file_watch_trigger")else{continue};let Some(folder)=trigger_node.configuration.get("folder").and_then(|v|v.as_str())else{continue};if folder.is_empty()||!workflow.settings.permissions.approved_folders.iter().any(|p|Path::new(folder).starts_with(p)){continue}
                    let wf=workflow.clone();let engine2=engine.clone();let cancel2=cancellations.clone();let events=trigger_node.configuration.get("events").and_then(|v|v.as_array()).cloned().unwrap_or_default();let pattern=trigger_node.configuration.get("pattern").and_then(|v|v.as_str()).unwrap_or("").to_string();
                    if let Ok(mut watcher)=notify::recommended_watcher(move|result:notify::Result<notify::Event>|{if let Ok(event)=result{let event_type=match event.kind{EventKind::Create(_)=>"created",EventKind::Modify(_)=>"modified",EventKind::Remove(_)=>"deleted",_=>return};if !events.is_empty()&&!events.iter().any(|v|v.as_str()==Some(event_type)){return}for path in event.paths{let filename=path.file_name().map(|v|v.to_string_lossy().to_string()).unwrap_or_default();if !pattern.is_empty()&&!glob_match(&pattern,&filename){continue}let trigger=json!({"type":"file_watch","path":path,"filename":filename,"extension":path.extension().map(|v|v.to_string_lossy().to_string()),"eventType":event_type,"timestamp":Utc::now()});spawn_run(engine2.clone(),cancel2.clone(),wf.clone(),trigger);}}}){if watcher.watch(Path::new(folder),RecursiveMode::NonRecursive).is_ok(){watchers.push(watcher);}}
                }}}
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}
fn glob_match(pattern:&str,name:&str)->bool{globset::Glob::new(pattern).ok().map(|g|g.compile_matcher().is_match(name)).unwrap_or(false)}
