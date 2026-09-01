use crate::plugin_manager::PluginManager;
use async_trait::async_trait;
use sandbox_engine::{EngineError, HostServices, PendingApproval, PluginHostResult, Workflow, WorkflowNode};
use serde_json::Value;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use tokio_util::sync::CancellationToken;

pub struct AgentHost { plugin_manager: PluginManager }

impl AgentHost { pub fn new(plugin_manager: PluginManager) -> Self { Self { plugin_manager } } }

#[async_trait]
impl HostServices for AgentHost {
    async fn desktop_notification(&self, _title: &str, _message: &str) -> Result<(), EngineError> { Ok(()) }

    async fn plugin_operation(&self, workflow: &Workflow, node: &WorkflowNode, execution_id: &str, input: Value, cancellation: CancellationToken) -> Result<PluginHostResult, EngineError> {
        let cancelled=Arc::new(AtomicBool::new(false));
        let monitor_flag=cancelled.clone();
        let monitor=tokio::spawn(async move { cancellation.cancelled().await; monitor_flag.store(true,Ordering::SeqCst); });
        let manager=self.plugin_manager.clone();let workflow=workflow.clone();let node=node.clone();let execution_id=execution_id.to_string();
        let result=tokio::task::spawn_blocking(move||manager.execute_node(&workflow,&node,&execution_id,input,cancelled)).await
            .map_err(|error|EngineError::Node(format!("Plugin worker failed: {error}")))??;
        monitor.abort();
        Ok(PluginHostResult{output:result.output,diagnostics:result.diagnostics.into_iter().map(|diagnostic|format!("{}: {}",diagnostic.code,diagnostic.message)).collect()})
    }

    async fn approval_requested(&self, _approval: &PendingApproval) -> Result<(), EngineError> { Ok(()) }
}
