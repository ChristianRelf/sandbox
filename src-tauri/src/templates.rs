use chrono::Utc;
use sandbox_engine::{PermissionSummary, Position, Workflow, WorkflowEdge, WorkflowNode, WorkflowSettings, CURRENT_SCHEMA_VERSION};
use serde_json::json;
use uuid::Uuid;

fn node(id:&str, node_type:&str, name:&str, x:f64, y:f64, configuration:serde_json::Value) -> WorkflowNode {
    WorkflowNode { id:id.into(),node_type:node_type.into(),version:1,name:name.into(),position:Position{x,y},configuration,disabled:false }
}
fn edge(id:&str, source:&str, handle:&str, target:&str) -> WorkflowEdge {
    WorkflowEdge{id:id.into(),source_node_id:source.into(),source_handle:handle.into(),target_node_id:target.into(),target_handle:"input".into()}
}
fn base(name:&str,nodes:Vec<WorkflowNode>,edges:Vec<WorkflowEdge>,trigger:&str,permissions:PermissionSummary)->Workflow {
    let now=Utc::now(); Workflow{id:Uuid::new_v4().to_string(),schema_version:CURRENT_SCHEMA_VERSION,name:name.into(),description:"".into(),enabled:false,trigger_node_id:trigger.into(),nodes,edges,settings:WorkflowSettings{permissions,..Default::default()},created_at:now,updated_at:now}
}

pub fn blank(name: Option<String>) -> Workflow {
    base(name.as_deref().unwrap_or("Untitled workflow"),vec![node("manual_trigger","manual_trigger","Manual Trigger",80.,220.,json!({}))],vec![],"manual_trigger",PermissionSummary::default())
}

pub fn website_health() -> Workflow {
    base("Website Health Monitor",vec![
        node("manual_trigger","manual_trigger","Manual Trigger",60.,220.,json!({})),
        node("http_request","http_request","HTTP Request",340.,220.,json!({"method":"GET","url":"https://example.com","query":{},"headers":{},"body":null,"timeoutMs":30000,"retryCount":1})),
        node("condition","condition","Condition",620.,220.,json!({"left":"{{nodes.http_request.output.status}}","operator":"equals","right":200})),
        node("notification_success","desktop_notification","Desktop Notification",920.,150.,json!({"title":"Website is healthy","message":"example.com returned status {{nodes.http_request.output.status}}"})),
        node("notification_failed","desktop_notification","Desktop Notification",920.,330.,json!({"title":"Website needs attention","message":"example.com returned status {{nodes.http_request.output.status}}"})),
    ],vec![edge("e1","manual_trigger","output","http_request"),edge("e2","http_request","output","condition"),edge("e3","condition","true","notification_success"),edge("e4","condition","false","notification_failed")],"manual_trigger",PermissionSummary{approved_network_domains:vec!["example.com".into()],..Default::default()})
}

pub fn downloads_organiser() -> Workflow {
    base("Downloads Folder Organiser",vec![
        node("file_watch","file_watch_trigger","File Watch Trigger",60.,220.,json!({"folder":"","events":["created"],"pattern":"*.pdf"})),
        node("condition","condition","Condition",340.,220.,json!({"left":"{{trigger.extension}}","operator":"equals","right":"pdf"})),
        node("move_file","move_file","Move File",650.,150.,json!({"source":"{{trigger.path}}","destinationFolder":"","renameTo":"","overwrite":false})),
    ],vec![edge("e1","file_watch","output","condition"),edge("e2","condition","true","move_file")],"file_watch",PermissionSummary::default())
}

pub fn by_key(key:&str,name:Option<String>)->Workflow { match key { "website-health"=>website_health(),"downloads-organiser"=>downloads_organiser(),_=>blank(name) } }
