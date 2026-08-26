use crate::{
    permissions::{require_domain, require_path}, redaction::{bounded_log, redact_value}, references::{resolve_value},
    validation::{topological_order, validate}, Database, EngineError, ExecutionRecord, ExecutionStatus,
    NodeExecution, NodeStatus, Workflow, WorkflowNode,
};
use async_trait::async_trait;
use chrono::Utc;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, process::Stdio, sync::Arc, time::{Duration, Instant}};
use tokio::{io::AsyncReadExt, process::Command, sync::{broadcast, Mutex}};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    ExecutionUpdated { record: ExecutionRecord },
    NodeStarted { execution_id: String, node_id: String },
}

#[async_trait]
pub trait HostServices: Send + Sync {
    async fn desktop_notification(&self, title: &str, message: &str) -> Result<(), EngineError>;
}

pub struct LocalHost;
#[async_trait]
impl HostServices for LocalHost {
    async fn desktop_notification(&self, _title: &str, _message: &str) -> Result<(), EngineError> { Ok(()) }
}

#[derive(Clone)]
pub struct Engine {
    db: Database,
    host: Arc<dyn HostServices>,
    active: Arc<Mutex<HashSet<String>>>,
    events: broadcast::Sender<EngineEvent>,
}

impl Engine {
    pub fn new(db: Database, host: Arc<dyn HostServices>) -> Self {
        let (events, _) = broadcast::channel(128);
        Self { db, host, active: Arc::new(Mutex::new(HashSet::new())), events }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<EngineEvent> { self.events.subscribe() }
    pub fn database(&self) -> &Database { &self.db }

    pub async fn run(&self, workflow: Workflow, trigger: Value, cancellation: CancellationToken) -> Result<ExecutionRecord, EngineError> {
        {
            let mut active = self.active.lock().await;
            if !active.insert(workflow.id.clone()) {
                let now = Utc::now();
                let record = ExecutionRecord { id:Uuid::new_v4().to_string(),workflow_id:workflow.id.clone(),workflow_version:workflow.schema_version,trigger,status:ExecutionStatus::Skipped,started_at:now,completed_at:Some(now),duration_ms:Some(0),node_executions:vec![],error:None,skip_reason:Some("Previous execution is still running.".into()),recovered_after_crash:false };
                self.db.save_execution(&record)?;
                let _ = self.events.send(EngineEvent::ExecutionUpdated { record: record.clone() });
                return Ok(record);
            }
        }
        let result = self.run_inner(&workflow, trigger, cancellation).await;
        self.active.lock().await.remove(&workflow.id);
        result
    }

    async fn run_inner(&self, workflow: &Workflow, trigger: Value, cancellation: CancellationToken) -> Result<ExecutionRecord, EngineError> {
        let issues = validate(workflow);
        if !issues.is_empty() {
            return Err(EngineError::Validation(issues.into_iter().map(|i| i.message).collect::<Vec<_>>().join(" ")));
        }
        let order = topological_order(workflow)?;
        let started = Utc::now();
        let mut record = ExecutionRecord {
            id:Uuid::new_v4().to_string(), workflow_id:workflow.id.clone(), workflow_version:workflow.schema_version,
            trigger: redact_value(&trigger), status:ExecutionStatus::Running, started_at:started, completed_at:None,
            duration_ms:None, node_executions:workflow.nodes.iter().map(|node| NodeExecution { node_id:node.id.clone(),status:NodeStatus::Waiting,started_at:None,completed_at:None,duration_ms:None,input:Value::Null,output:Value::Null,logs:vec![],retry_count:0,error:None,skip_reason:None,branch_followed:None }).collect(), error:None,skip_reason:None,recovered_after_crash:false
        };
        self.publish(&record)?;
        let mut outputs: HashMap<String, Value> = HashMap::new();
        let mut active_edges: HashMap<String, bool> = workflow.edges.iter().map(|edge| {
            let condition = workflow.nodes.iter().find(|n| n.id == edge.source_node_id).is_some_and(|n| n.node_type == "condition");
            (edge.id.clone(), !condition)
        }).collect();

        for node_id in order {
            let node = workflow.nodes.iter().find(|node| node.id == node_id).unwrap();
            let idx = record.node_executions.iter().position(|execution| execution.node_id == node.id).unwrap();
            if cancellation.is_cancelled() {
                mark_node(&mut record.node_executions[idx], NodeStatus::Cancelled, "Execution was cancelled.");
                continue;
            }
            if node.disabled {
                mark_node(&mut record.node_executions[idx], NodeStatus::Skipped, "Node is disabled.");
                continue;
            }
            let incoming: Vec<_> = workflow.edges.iter().filter(|edge| edge.target_node_id == node.id).collect();
            let active_incoming: Vec<_> = incoming.iter().filter(|edge| *active_edges.get(&edge.id).unwrap_or(&false)).collect();
            if node.id != workflow.trigger_node_id && active_incoming.is_empty() {
                mark_node(&mut record.node_executions[idx], NodeStatus::Skipped, "The node was not reached because its branch was not followed.");
                continue;
            }
            let failed_dependency = active_incoming.iter().find_map(|edge| {
                record.node_executions.iter().find(|execution| execution.node_id == edge.source_node_id)
                    .filter(|execution| !matches!(execution.status, NodeStatus::Successful))
                    .map(|execution| (edge.source_node_id.as_str(), execution.status))
            });
            if let Some((dependency, status)) = failed_dependency {
                mark_node(&mut record.node_executions[idx], NodeStatus::Skipped, &format!("Dependency '{dependency}' finished with status {status:?}."));
                continue;
            }
            let dependencies: Map<String, Value> = active_incoming.iter().filter_map(|edge| outputs.get(&edge.source_node_id).map(|value| (edge.source_node_id.clone(), value.clone()))).collect();
            record.node_executions[idx].input = redact_value(&json!({"dependencies": dependencies, "trigger": trigger}));
            record.node_executions[idx].status = NodeStatus::Running;
            record.node_executions[idx].started_at = Some(Utc::now());
            let _ = self.events.send(EngineEvent::NodeStarted { execution_id:record.id.clone(),node_id:node.id.clone() });
            self.publish(&record)?;
            let instant = Instant::now();
            let timeout_ms = node.configuration.get("timeoutMs").and_then(Value::as_u64).unwrap_or(workflow.settings.default_node_timeout_ms).clamp(100, 600_000);
            let execution = tokio::select! {
                _ = cancellation.cancelled() => Err(EngineError::Cancelled),
                result = tokio::time::timeout(Duration::from_millis(timeout_ms), self.execute_node(node, workflow, &trigger, &outputs, cancellation.clone())) => {
                    match result { Ok(value) => value, Err(_) => Err(EngineError::Node(format!("{} exceeded its {}-second timeout.", node.name, timeout_ms as f64 / 1000.0))) }
                }
            };
            let completed = Utc::now();
            let node_record = &mut record.node_executions[idx];
            node_record.completed_at = Some(completed);
            node_record.duration_ms = Some(instant.elapsed().as_millis() as u64);
            match execution {
                Ok(result) => {
                    node_record.status = NodeStatus::Successful;
                    node_record.output = redact_value(&result.output);
                    node_record.logs = result.logs.into_iter().map(bounded_log).take(100).collect();
                    node_record.retry_count = result.retry_count;
                    if let Some(branch) = result.branch {
                        node_record.branch_followed = Some(branch.clone());
                        for edge in workflow.edges.iter().filter(|edge| edge.source_node_id == node.id) { active_edges.insert(edge.id.clone(), edge.source_handle == branch); }
                    }
                    outputs.insert(node.id.clone(), result.output);
                }
                Err(error) => {
                    node_record.status = if matches!(error, EngineError::Cancelled) { NodeStatus::Cancelled } else { NodeStatus::Failed };
                    node_record.error = Some(error.execution_error());
                    node_record.logs.push(bounded_log(error.to_string()));
                }
            }
            self.publish(&record)?;
        }
        let completed = Utc::now();
        record.completed_at = Some(completed);
        record.duration_ms = Some((completed - started).num_milliseconds().max(0) as u64);
        record.status = if cancellation.is_cancelled() || record.node_executions.iter().any(|n| n.status == NodeStatus::Cancelled) { ExecutionStatus::Cancelled }
            else if record.node_executions.iter().any(|n| n.status == NodeStatus::Failed) { ExecutionStatus::Failed }
            else { ExecutionStatus::Successful };
        record.error = record.node_executions.iter().find_map(|node| node.error.clone());
        self.publish(&record)?;
        Ok(record)
    }

    fn publish(&self, record: &ExecutionRecord) -> Result<(), EngineError> {
        self.db.save_execution(record)?;
        let _ = self.events.send(EngineEvent::ExecutionUpdated { record:record.clone() });
        Ok(())
    }

    async fn execute_node(&self, node: &WorkflowNode, workflow: &Workflow, trigger: &Value, outputs: &HashMap<String, Value>, cancellation: CancellationToken) -> Result<NodeResult, EngineError> {
        match node.node_type.as_str() {
            "manual_trigger" | "schedule_trigger" | "file_watch_trigger" => Ok(NodeResult::new(json!({"executionTime":Utc::now(),"workflowId":workflow.id,"triggerType":node.node_type,"event":trigger}))),
            "condition" => execute_condition(node, trigger, outputs),
            "set_data" => Ok(NodeResult::new(resolve_value(node.configuration.get("values").unwrap_or(&json!({})), trigger, outputs)?).log("Constructed a new data object.")),
            "delay" => {
                let amount = node.configuration.get("amount").and_then(Value::as_f64).unwrap_or(1.0).max(0.0);
                let multiplier = if node.configuration.get("unit").and_then(Value::as_str) == Some("minutes") { 60.0 } else { 1.0 };
                let duration = Duration::from_millis((amount * multiplier * 1000.0) as u64);
                tokio::select! { _ = cancellation.cancelled() => Err(EngineError::Cancelled), _ = tokio::time::sleep(duration) => Ok(NodeResult::new(json!({"delayedMs":duration.as_millis()})).log(format!("Waited for {:.1} seconds.", duration.as_secs_f64()))) }
            }
            "http_request" => self.execute_http(node, workflow, trigger, outputs, cancellation).await,
            "desktop_notification" => {
                let config = resolve_value(&node.configuration, trigger, outputs)?;
                let title = config.get("title").and_then(Value::as_str).unwrap_or("Sandbox");
                let message = config.get("message").and_then(Value::as_str).unwrap_or("");
                self.host.desktop_notification(title, message).await?;
                Ok(NodeResult::new(json!({"delivered":true,"title":title})).log("Desktop notification delivered."))
            }
            "move_file" => execute_move(node, workflow, trigger, outputs).await,
            "run_command" => execute_command(node, workflow, trigger, outputs, cancellation).await,
            other => Err(EngineError::Node(format!("Node type '{other}' is not supported by this runner."))),
        }
    }

    async fn execute_http(&self, node: &WorkflowNode, workflow: &Workflow, trigger: &Value, outputs: &HashMap<String, Value>, cancellation: CancellationToken) -> Result<NodeResult, EngineError> {
        let config = resolve_value(&node.configuration, trigger, outputs)?;
        let url = config.get("url").and_then(Value::as_str).ok_or_else(|| EngineError::Node("HTTP Request requires a URL.".into()))?;
        require_domain(url, &workflow.settings.permissions)?;
        let method = Method::from_bytes(config.get("method").and_then(Value::as_str).unwrap_or("GET").as_bytes()).map_err(|_| EngineError::Node("HTTP Request method is invalid.".into()))?;
        let retries = config.get("retryCount").and_then(Value::as_u64).unwrap_or(0).min(5) as u32;
        let timeout_ms = config.get("timeoutMs").and_then(Value::as_u64).unwrap_or(30_000).clamp(100, 120_000);
        let client = reqwest::Client::builder().timeout(Duration::from_millis(timeout_ms)).redirect(reqwest::redirect::Policy::limited(10)).build().map_err(|e| EngineError::Node(e.to_string()))?;
        let mut last_error = None;
        for attempt in 0..=retries {
            if cancellation.is_cancelled() { return Err(EngineError::Cancelled); }
            let mut request = client.request(method.clone(), url);
            if let Some(query) = config.get("query").and_then(Value::as_object) { request = request.query(&query); }
            if let Some(headers) = config.get("headers").and_then(Value::as_object) {
                for (key, value) in headers { if let Some(value) = value.as_str() { request = request.header(key, value); } }
            }
            if !matches!(method, Method::GET | Method::DELETE) { if let Some(body) = config.get("body") { request = request.json(body); } }
            let started = Instant::now();
            match request.send().await {
                Ok(response) => {
                    let status = response.status().as_u16();
                    let final_url = response.url().to_string();
                    let headers: Map<String, Value> = response.headers().iter().map(|(k,v)|(k.to_string(),Value::String(v.to_str().unwrap_or("<binary>").to_string()))).collect();
                    let bytes = response.bytes().await.map_err(|e| EngineError::Node(format!("HTTP Request could not read its response: {e}")))?;
                    if bytes.len() > 1_048_576 { return Err(EngineError::Node("HTTP Request response exceeded the 1 MB output limit.".into())); }
                    let body = serde_json::from_slice(&bytes).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).to_string()));
                    return Ok(NodeResult { output:json!({"status":status,"headers":headers,"body":body,"durationMs":started.elapsed().as_millis(),"finalUrl":final_url}), logs:vec![format!("{} {} completed with status {}.", method, final_url, status)], retry_count:attempt, branch:None });
                }
                Err(error) => { last_error = Some(error); if attempt < retries { tokio::time::sleep(Duration::from_millis(250 * 2u64.pow(attempt))).await; } }
            }
        }
        let error = last_error.unwrap();
        let message = if error.is_timeout() { format!("HTTP Request exceeded its {}-second timeout.", timeout_ms as f64 / 1000.0) } else { format!("HTTP Request to '{url}' failed: {error}") };
        Err(EngineError::Node(message))
    }
}

struct NodeResult { output: Value, logs: Vec<String>, retry_count: u32, branch: Option<String> }
impl NodeResult { fn new(output: Value) -> Self { Self { output,logs:vec![],retry_count:0,branch:None } } fn log(mut self, message: impl Into<String>) -> Self { self.logs.push(message.into()); self } }

fn execute_condition(node: &WorkflowNode, trigger: &Value, outputs: &HashMap<String, Value>) -> Result<NodeResult, EngineError> {
    let left = resolve_value(node.configuration.get("left").ok_or_else(|| EngineError::Node("Condition has no value to compare.".into()))?, trigger, outputs)?;
    let right = resolve_value(node.configuration.get("right").unwrap_or(&Value::Null), trigger, outputs)?;
    let operator = node.configuration.get("operator").and_then(Value::as_str).unwrap_or("equals");
    let result = match operator {
        "equals" => left == right, "not_equals" => left != right,
        "contains" => contains(&left,&right), "not_contains" => !contains(&left,&right),
        "greater_than" => numbers(&left,&right).is_some_and(|(a,b)|a>b), "less_than" => numbers(&left,&right).is_some_and(|(a,b)|a<b),
        "exists" => !left.is_null(), "not_exists" => left.is_null(),
        "starts_with" => strings(&left,&right).is_some_and(|(a,b)|a.starts_with(b)), "ends_with" => strings(&left,&right).is_some_and(|(a,b)|a.ends_with(b)),
        _ => return Err(EngineError::Node(format!("Condition operator '{operator}' is not supported."))),
    };
    let branch = if result { "true" } else { "false" }.to_string();
    Ok(NodeResult { output:json!({"result":result,"left":left,"right":right,"operator":operator}),logs:vec![format!("Condition evaluated to {result}; followed the {branch} branch.")],retry_count:0,branch:Some(branch) })
}
fn contains(left:&Value,right:&Value)->bool { match (left,right) { (Value::String(a),Value::String(b))=>a.contains(b),(Value::Array(a),b)=>a.contains(b),_=>false } }
fn strings<'a>(left:&'a Value,right:&'a Value)->Option<(&'a str,&'a str)> { Some((left.as_str()?,right.as_str()?)) }
fn numbers(left:&Value,right:&Value)->Option<(f64,f64)> { Some((left.as_f64()?,right.as_f64()?)) }

async fn execute_move(node:&WorkflowNode, workflow:&Workflow, trigger:&Value, outputs:&HashMap<String,Value>) -> Result<NodeResult,EngineError> {
    let config=resolve_value(&node.configuration,trigger,outputs)?;
    let source=PathBuf::from(config.get("source").and_then(Value::as_str).ok_or_else(||EngineError::Node("Move File requires a source path.".into()))?);
    let destination=PathBuf::from(config.get("destinationFolder").and_then(Value::as_str).ok_or_else(||EngineError::Node("Move File requires a destination folder.".into()))?);
    let source=require_path(&source,&workflow.settings.permissions)?; let destination=require_path(&destination,&workflow.settings.permissions)?;
    let name=config.get("renameTo").and_then(Value::as_str).filter(|s|!s.is_empty()).map(str::to_string).or_else(||source.file_name().map(|s|s.to_string_lossy().to_string())).ok_or_else(||EngineError::Node("Move File could not determine the file name.".into()))?;
    let target=destination.join(name); require_path(&target,&workflow.settings.permissions)?;
    if target.exists() && !config.get("overwrite").and_then(Value::as_bool).unwrap_or(false) { return Err(EngineError::Node(format!("Move File cannot overwrite '{}'. Enable overwrite or choose another name.",target.display()))); }
    if target.exists() { tokio::fs::remove_file(&target).await.map_err(|e|EngineError::Node(format!("Move File could not replace '{}': {e}",target.display())))?; }
    tokio::fs::rename(&source,&target).await.map_err(|e|EngineError::Node(format!("Move File could not move '{}' to '{}': {e}",source.display(),target.display())))?;
    Ok(NodeResult::new(json!({"source":source,"destination":target})).log(format!("Moved '{}' to '{}'.",source.display(),target.display())))
}

async fn execute_command(node:&WorkflowNode, workflow:&Workflow, trigger:&Value, outputs:&HashMap<String,Value>, cancellation:CancellationToken) -> Result<NodeResult,EngineError> {
    if !workflow.settings.permissions.command_execution_permitted || workflow.settings.permissions.approval_revision.is_none() { return Err(EngineError::Permission("Run Command requires approval before it can run in the background.".into())); }
    let config=resolve_value(&node.configuration,trigger,outputs)?;
    let executable=config.get("executable").and_then(Value::as_str).ok_or_else(||EngineError::Node("Run Command requires an executable.".into()))?;
    let args:Vec<String>=config.get("arguments").and_then(Value::as_array).map(|v|v.iter().filter_map(|v|v.as_str().map(str::to_string)).collect()).unwrap_or_default();
    let mut command=Command::new(executable); command.args(&args).kill_on_drop(true).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir)=config.get("workingDirectory").and_then(Value::as_str).filter(|s|!s.is_empty()) { command.current_dir(require_path(Path::new(dir),&workflow.settings.permissions)?); }
    let mut child=command.spawn().map_err(|e|EngineError::Node(format!("Run Command could not start '{executable}': {e}")))?;
    let stdout=child.stdout.take().unwrap(); let stderr=child.stderr.take().unwrap();
    let output=tokio::select! { _=cancellation.cancelled()=>{ let _=child.kill().await; return Err(EngineError::Cancelled); }, status=child.wait()=>status.map_err(|e|EngineError::Node(format!("Run Command could not wait for '{executable}': {e}")))? };
    let mut out=Vec::new(); let mut err=Vec::new(); stdout.take(65_536).read_to_end(&mut out).await.ok(); stderr.take(65_536).read_to_end(&mut err).await.ok();
    let stdout=String::from_utf8_lossy(&out).to_string(); let stderr=String::from_utf8_lossy(&err).to_string();
    if !output.success() { return Err(EngineError::Node(format!("Run Command exited with code {}. {}",output.code().map(|v|v.to_string()).unwrap_or_else(||"unknown".into()),bounded_log(&stderr)))); }
    Ok(NodeResult::new(json!({"exitCode":output.code(),"stdout":stdout,"stderr":stderr})).log(format!("Executed '{}' with {} argument(s).",executable,args.len())))
}

fn mark_node(node:&mut NodeExecution,status:NodeStatus,reason:&str) { let now=Utc::now(); node.status=status; node.completed_at=Some(now); node.duration_ms=Some(0); node.skip_reason=Some(reason.into()); }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Position, WorkflowEdge, WorkflowSettings};
    use serde_json::json;
    struct TestHost(Arc<std::sync::Mutex<Vec<String>>>);
    #[async_trait] impl HostServices for TestHost { async fn desktop_notification(&self,title:&str,message:&str)->Result<(),EngineError>{self.0.lock().unwrap().push(format!("{title}:{message}"));Ok(())} }
    fn node(id:&str,node_type:&str,config:Value)->WorkflowNode{WorkflowNode{id:id.into(),node_type:node_type.into(),version:1,name:id.replace('_'," "),position:Position{x:0.,y:0.},configuration:config,disabled:false}}
    fn edge(id:&str,s:&str,handle:&str,t:&str)->WorkflowEdge{WorkflowEdge{id:id.into(),source_node_id:s.into(),source_handle:handle.into(),target_node_id:t.into(),target_handle:"input".into()}}
    fn base(nodes:Vec<WorkflowNode>,edges:Vec<WorkflowEdge>)->Workflow{let now=Utc::now();Workflow{id:Uuid::new_v4().to_string(),schema_version:1,name:"Test".into(),description:"".into(),enabled:true,trigger_node_id:"trigger".into(),nodes,edges,settings:WorkflowSettings{permissions:crate::PermissionSummary{approved_network_domains:vec!["127.0.0.1".into()],..Default::default()},..Default::default()},created_at:now,updated_at:now}}
    #[tokio::test] async fn condition_follows_true_and_skips_false(){let host=Arc::new(TestHost(Arc::new(std::sync::Mutex::new(vec![]))));let engine=Engine::new(Database::in_memory().unwrap(),host);let wf=base(vec![node("trigger","manual_trigger",json!({})),node("condition","condition",json!({"left":5,"operator":"greater_than","right":2})),node("yes","set_data",json!({"values":{"path":"yes"}})),node("no","set_data",json!({"values":{"path":"no"}}))],vec![edge("a","trigger","output","condition"),edge("b","condition","true","yes"),edge("c","condition","false","no")]);engine.database().save_workflow(wf.clone()).unwrap();let run=engine.run(wf,json!({}),CancellationToken::new()).await.unwrap();assert_eq!(run.status,ExecutionStatus::Successful);assert_eq!(run.node_executions.iter().find(|n|n.node_id=="yes").unwrap().status,NodeStatus::Successful);assert_eq!(run.node_executions.iter().find(|n|n.node_id=="no").unwrap().status,NodeStatus::Skipped);}
    #[tokio::test] async fn cancellation_marks_delay(){let engine=Engine::new(Database::in_memory().unwrap(),Arc::new(LocalHost));let wf=base(vec![node("trigger","manual_trigger",json!({})),node("delay","delay",json!({"amount":10,"unit":"seconds"}))],vec![edge("a","trigger","output","delay")]);engine.database().save_workflow(wf.clone()).unwrap();let token=CancellationToken::new();let cancel=token.clone();tokio::spawn(async move{tokio::time::sleep(Duration::from_millis(20)).await;cancel.cancel();});let run=engine.run(wf,json!({}),token).await.unwrap();assert_eq!(run.status,ExecutionStatus::Cancelled);}
    #[tokio::test] async fn node_timeout_is_recorded(){let engine=Engine::new(Database::in_memory().unwrap(),Arc::new(LocalHost));let mut wf=base(vec![node("trigger","manual_trigger",json!({})),node("delay","delay",json!({"amount":1,"unit":"seconds","timeoutMs":100}))],vec![edge("a","trigger","output","delay")]);wf.settings.default_node_timeout_ms=100;engine.database().save_workflow(wf.clone()).unwrap();let run=engine.run(wf,json!({}),CancellationToken::new()).await.unwrap();assert_eq!(run.status,ExecutionStatus::Failed);assert!(run.error.unwrap().message.contains("timeout"));}
}
