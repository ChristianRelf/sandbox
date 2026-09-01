use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CURRENT_SCHEMA_VERSION: u32 = 4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InputBinding {
    Literal {
        value: Value,
    },
    NodeOutput {
        node_id: String,
        #[serde(default)]
        path: Vec<String>,
    },
    Template {
        template: String,
    },
    ProtectedVariable {
        name: String,
    },
    Connection {
        connection_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

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
    /// Versioned, typed data mappings. Static configuration remains in
    /// `configuration`; bindings replace individual top-level fields at run
    /// time without embedding secret material in the workflow document.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub input_bindings: std::collections::BTreeMap<String, InputBinding>,
    /// Present only for third-party nodes. Built-in v0.1/v0.2 nodes keep this
    /// field absent and therefore require no migration choice from the user.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<PluginNodePin>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginNodePin {
    pub plugin_id: String,
    pub plugin_version: String,
    pub package_integrity: String,
    pub publisher_id: String,
    /// Host-resolved node input mapping. References use the same expression
    /// syntax as built-in node configuration and default to an empty object.
    #[serde(default = "empty_object", skip_serializing_if = "is_empty_object")]
    pub input: Value,
    /// Friendly manifest references mapped to opaque host connection IDs. The
    /// referenced secret remains in the operating-system credential store.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub credential_references: std::collections::BTreeMap<String, String>,
}

fn empty_object() -> Value {
    Value::Object(Default::default())
}

fn is_empty_object(value: &Value) -> bool {
    value.as_object().is_some_and(serde_json::Map::is_empty)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowOwner {
    pub owner_type: String,
    pub owner_id: String,
}

impl Default for WorkflowOwner {
    fn default() -> Self {
        Self {
            owner_type: "personal".into(),
            owner_id: "local".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PluginInstallState {
    Disabled,
    Enabled,
    Revoked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub plugin_id: String,
    pub version: String,
    pub package_integrity: String,
    pub publisher_id: String,
    pub publisher_key_id: String,
    /// Public verification material retained so every execution can re-check
    /// the immutable package instead of trusting installation-time state.
    #[serde(skip, default)]
    pub publisher_public_key_pem: Option<String>,
    pub owner_type: String,
    pub owner_id: String,
    pub source: String,
    pub development: bool,
    pub state: PluginInstallState,
    pub manifest: Value,
    pub requested_permissions: Vec<String>,
    pub approved_permissions: Vec<String>,
    pub update_requires_review: bool,
    pub package_path: String,
    pub installed_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRevocation {
    pub plugin_id: String,
    pub version: Option<String>,
    pub package_integrity: Option<String>,
    pub reason: String,
    pub security_notice_url: Option<String>,
    pub revoked_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEdge {
    pub id: String,
    pub source_node_id: String,
    pub source_handle: String,
    pub target_node_id: String,
    pub target_handle: String,
    #[serde(default = "control_edge_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_port: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_port: Option<String>,
}

fn control_edge_kind() -> String {
    "control".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CredentialReference {
    pub provider: String,
    pub key: String,
}

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
    #[serde(default)]
    pub approved_browser_profile_ids: Vec<String>,
    #[serde(default)]
    pub browser_automation_permitted: bool,
    #[serde(default)]
    pub external_communication_permitted: bool,
    #[serde(default)]
    pub external_data_write_permitted: bool,
    #[serde(default)]
    pub communication_approval_revision: Option<String>,
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
fn default_timeout() -> u64 {
    30_000
}
fn default_concurrency() -> usize {
    4
}
impl Default for WorkflowSettings {
    fn default() -> Self {
        Self {
            default_node_timeout_ms: default_timeout(),
            max_concurrent_nodes: default_concurrency(),
            permissions: PermissionSummary::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub schema_version: u32,
    #[serde(default)]
    pub owner: WorkflowOwner,
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
pub enum ExecutionStatus {
    Queued,
    Running,
    Successful,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Idle,
    Waiting,
    Running,
    Successful,
    Failed,
    Skipped,
    Cancelled,
}

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
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub output: Value,
    #[serde(default)]
    pub logs: Vec<String>,
    #[serde(default)]
    pub retry_count: u32,
    pub error: Option<ExecutionError>,
    pub skip_reason: Option<String>,
    pub branch_followed: Option<String>,
    #[serde(default)]
    pub browser_diagnostics: Option<BrowserDiagnostics>,
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
    #[serde(default)]
    pub recovered_after_crash: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub workflow: Workflow,
    pub metadata: WorkflowMetadata,
    pub last_execution: Option<ExecutionRecord>,
    pub next_run_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRevisionSummary {
    pub revision_id: String,
    pub workflow_id: String,
    pub parent_revision_id: Option<String>,
    pub schema_version: u32,
    pub content_hash: String,
    pub change_summary: String,
    pub created_at: DateTime<Utc>,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowMetadata {
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub archived_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_opened_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowMetadataPatch {
    pub favorite: Option<bool>,
    pub folder: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub archived_at: Option<Option<DateTime<Utc>>>,
    pub last_opened_at: Option<Option<DateTime<Utc>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileSettings {
    #[serde(default = "default_viewport_width")]
    pub viewport_width: u32,
    #[serde(default = "default_viewport_height")]
    pub viewport_height: u32,
    #[serde(default)]
    pub download_folder: Option<String>,
    #[serde(default)]
    pub proxy: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}
fn default_viewport_width() -> u32 {
    1280
}
fn default_viewport_height() -> u32 {
    800
}
impl Default for BrowserProfileSettings {
    fn default() -> Self {
        Self {
            viewport_width: default_viewport_width(),
            viewport_height: default_viewport_height(),
            download_folder: None,
            proxy: None,
            user_agent: None,
            permissions: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfile {
    pub id: String,
    pub name: String,
    pub persistent: bool,
    pub data_path: String,
    #[serde(default)]
    pub settings: BrowserProfileSettings,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSession {
    pub session_id: String,
    pub profile_id: String,
    pub context_id: String,
    pub page_id: String,
    pub current_url: String,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LocatorKind {
    Role,
    Label,
    Placeholder,
    TestId,
    Text,
    Attribute,
    Css,
    XPath,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocatorCandidate {
    pub kind: LocatorKind,
    pub value: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub exact: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StructuredLocator {
    pub primary: LocatorCandidate,
    #[serde(default)]
    pub alternatives: Vec<LocatorCandidate>,
    #[serde(default)]
    pub element_role: Option<String>,
    #[serde(default)]
    pub accessible_name: Option<String>,
    pub tag: String,
    #[serde(default)]
    pub stable_attributes: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub frame_path: Vec<String>,
    pub recording_url: String,
    #[serde(default)]
    pub nearby_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocatorAttempt {
    pub kind: String,
    pub value: String,
    pub match_count: usize,
    pub succeeded: bool,
    #[serde(default)]
    pub weak_fallback: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDiagnostics {
    #[serde(default)]
    pub current_url: String,
    #[serde(default)]
    pub page_title: String,
    #[serde(default)]
    pub locator_attempts: Vec<LocatorAttempt>,
    #[serde(default)]
    pub successful_locator: Option<LocatorCandidate>,
    #[serde(default)]
    pub match_count: usize,
    #[serde(default)]
    pub console_errors: Vec<String>,
    #[serde(default)]
    pub failed_network_requests: Vec<String>,
    #[serde(default)]
    pub screenshot_path: Option<String>,
    #[serde(default)]
    pub trace_path: Option<String>,
    #[serde(default)]
    pub playwright_error: Option<String>,
    #[serde(default)]
    pub unexpected_navigation: bool,
    #[serde(default)]
    pub rerecord_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Connected,
    Expired,
    Revoked,
    Error,
    SetupRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMetadata {
    pub id: String,
    pub provider: String,
    pub display_name: String,
    pub account_identifier: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub status: ConnectionStatus,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub id: String,
    pub execution_id: String,
    pub workflow_id: String,
    pub node_id: String,
    pub action: Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordedStep {
    pub id: String,
    pub action: String,
    pub name: String,
    pub configuration: Value,
    #[serde(default)]
    pub sensitive_input_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordedWorkflowDraft {
    pub id: String,
    pub workflow_id: Option<String>,
    pub profile_id: String,
    pub status: String,
    #[serde(default)]
    pub steps: Vec<RecordedStep>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
