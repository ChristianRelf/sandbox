use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Position { pub x: f64, pub y: f64 }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub version: u32,
    pub name: String,
    pub position: Position,
    #[serde(default)]
    pub configuration: Value,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEdge {
    pub id: String,
    pub source_node_id: String,
    pub source_handle: String,
    pub target_node_id: String,
    pub target_handle: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CredentialReference { pub provider: String, pub key: String }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSummary {
    #[serde(default)]
    pub approved_folders: Vec<String>,
    #[serde(default)]
    pub approved_network_domains: Vec<String>,
    #[serde(default)]
    pub command_execution_permitted: bool,
    #[serde(default)]
    pub background_execution_permitted: bool,
    #[serde(default)]
    pub approval_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSettings {
    #[serde(default = "default_timeout")]
    pub default_node_timeout_ms: u64,
    #[serde(default = "default_concurrency")]
    pub max_concurrent_nodes: usize,
    #[serde(default)]
    pub permissions: PermissionSummary,
}
fn default_timeout() -> u64 { 30_000 }
fn default_concurrency() -> usize { 4 }
impl Default for WorkflowSettings {
    fn default() -> Self { Self { default_node_timeout_ms: default_timeout(), max_concurrent_nodes: default_concurrency(), permissions: PermissionSummary::default() } }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub schema_version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub trigger_node_id: String,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
    #[serde(default)]
    pub settings: WorkflowSettings,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus { Queued, Running, Successful, Failed, Skipped, Cancelled }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus { Idle, Waiting, Running, Successful, Failed, Skipped, Cancelled }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeExecution {
    pub node_id: String,
    pub status: NodeStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<u64>,
    #[serde(default)] pub input: Value,
    #[serde(default)] pub output: Value,
    #[serde(default)] pub logs: Vec<String>,
    #[serde(default)] pub retry_count: u32,
    pub error: Option<ExecutionError>,
    pub skip_reason: Option<String>,
    pub branch_followed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    pub workflow_id: String,
    pub workflow_version: u32,
    pub trigger: Value,
    pub status: ExecutionStatus,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<u64>,
    pub node_executions: Vec<NodeExecution>,
    pub error: Option<ExecutionError>,
    pub skip_reason: Option<String>,
    #[serde(default)] pub recovered_after_crash: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub workflow: Workflow,
    pub last_execution: Option<ExecutionRecord>,
    pub next_run_at: Option<DateTime<Utc>>,
}
