use crate::{EngineError, InputBinding, Workflow};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

const TRIGGERS: &[&str] = &[
    "manual_trigger",
    "schedule_trigger",
    "file_watch_trigger",
    "gmail_new_email_trigger",
    "google.calendar.event_changed",
    "google.drive.file_changed",
    "google.sheets.row_added",
    "slack.channel_message_posted",
    "notion.data_source_page_changed",
    "github.issue_or_pull_request_changed",
    "github.workflow_run_completed",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub code: String,
    pub message: String,
    pub severity: ValidationSeverity,
    pub node_id: Option<String>,
    pub edge_id: Option<String>,
    pub field_path: Option<String>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ValidationSeverity {
    Error,
    Warning,
}

pub fn validate(workflow: &Workflow) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    if workflow.schema_version != crate::model::CURRENT_SCHEMA_VERSION {
        issues.push(issue(
            "unsupported_schema",
            format!(
                "Workflow schema {} is not supported.",
                workflow.schema_version
            ),
            None,
            None,
        ));
    }
    let ids: HashSet<_> = workflow.nodes.iter().map(|n| n.id.as_str()).collect();
    if ids.len() != workflow.nodes.len() {
        issues.push(issue(
            "duplicate_node",
            "Node identifiers must be unique.",
            None,
            None,
        ));
    }
    let triggers: Vec<_> = workflow
        .nodes
        .iter()
        .filter(|n| TRIGGERS.contains(&n.node_type.as_str()))
        .collect();
    if triggers.len() != 1 {
        issues.push(issue(
            "trigger_count",
            format!(
                "Workflow requires exactly one trigger; found {}.",
                triggers.len()
            ),
            None,
            None,
        ));
    } else if workflow.trigger_node_id != triggers[0].id {
        issues.push(issue(
            "trigger_mismatch",
            "The workflow trigger does not match its triggerNodeId.",
            Some(triggers[0].id.clone()),
            None,
        ));
    }
    let mut edge_ids = HashSet::new();
    for edge in &workflow.edges {
        if !edge_ids.insert(&edge.id) {
            issues.push(issue(
                "duplicate_edge",
                "Edge identifiers must be unique.",
                None,
                Some(edge.id.clone()),
            ));
        }
        if !ids.contains(edge.source_node_id.as_str())
            || !ids.contains(edge.target_node_id.as_str())
        {
            issues.push(issue(
                "missing_endpoint",
                "Connection references a node that no longer exists.",
                None,
                Some(edge.id.clone()),
            ));
        }
        if edge.source_node_id == edge.target_node_id {
            issues.push(issue(
                "self_connection",
                "A node cannot connect to itself.",
                Some(edge.source_node_id.clone()),
                Some(edge.id.clone()),
            ));
        }
        if let Some(source) = workflow.nodes.iter().find(|n| n.id == edge.source_node_id) {
            if source.node_type == "condition"
                && !matches!(edge.source_handle.as_str(), "true" | "false")
            {
                issues.push(issue(
                    "condition_handle",
                    "Condition connections must use the true or false output.",
                    Some(source.id.clone()),
                    Some(edge.id.clone()),
                ));
            }
        }
        if let Some(target) = workflow.nodes.iter().find(|n| n.id == edge.target_node_id) {
            if TRIGGERS.contains(&target.node_type.as_str()) {
                issues.push(issue(
                    "trigger_input",
                    "Trigger nodes cannot have incoming connections.",
                    Some(target.id.clone()),
                    Some(edge.id.clone()),
                ));
            }
        }
    }
    if topological_order(workflow).is_err() {
        issues.push(issue(
            "cycle",
            "Workflow contains a circular connection. Loops are not supported.",
            None,
            None,
        ));
    }
    if triggers.len() == 1 {
        let mut reachable = HashSet::from([triggers[0].id.as_str()]);
        let mut changed = true;
        while changed {
            changed = false;
            for edge in &workflow.edges {
                if reachable.contains(edge.source_node_id.as_str())
                    && reachable.insert(edge.target_node_id.as_str())
                {
                    changed = true;
                }
            }
        }
        for node in workflow
            .nodes
            .iter()
            .filter(|n| !n.disabled && !reachable.contains(n.id.as_str()))
        {
            let mut disconnected = issue(
                "disconnected_node",
                format!("{} is not connected to the trigger.", node.name),
                Some(node.id.clone()),
                None,
            );
            disconnected.severity = ValidationSeverity::Warning;
            disconnected.suggestion =
                Some("Connect this node or disable it if it is not currently needed.".into());
            issues.push(disconnected);
        }
    }
    for node in &workflow.nodes {
        for (field, binding) in &node.input_bindings {
            if field.trim().is_empty() {
                let mut binding_issue = issue(
                    "binding_field_missing",
                    "A data binding has no target field.",
                    Some(node.id.clone()),
                    None,
                );
                binding_issue.field_path = Some("inputBindings".into());
                issues.push(binding_issue);
            }
            if let InputBinding::NodeOutput { node_id, .. } = binding {
                if node_id == &node.id {
                    let mut binding_issue = issue(
                        "binding_self_reference",
                        "A node cannot map its own output as input.",
                        Some(node.id.clone()),
                        None,
                    );
                    binding_issue.field_path = Some(format!("inputBindings.{field}"));
                    issues.push(binding_issue);
                } else if !ids.contains(node_id.as_str()) {
                    let mut binding_issue = issue(
                        "binding_source_missing",
                        format!("Input '{field}' references a node that no longer exists."),
                        Some(node.id.clone()),
                        None,
                    );
                    binding_issue.field_path = Some(format!("inputBindings.{field}"));
                    issues.push(binding_issue);
                }
            }
        }
        let missing = match node.node_type.as_str() {
            "http_request" => node
                .configuration
                .get("url")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
                .then_some("HTTP Request requires a URL."),
            "condition" => (!node.configuration.get("operator").is_some()
                || !node.configuration.get("left").is_some())
            .then_some("Condition requires a value and operator."),
            "schedule_trigger" => node
                .configuration
                .get("scheduleType")
                .is_none()
                .then_some("Schedule Trigger requires a schedule."),
            "file_watch_trigger" => node
                .configuration
                .get("folder")
                .and_then(|v| v.as_str())
                .map(str::is_empty)
                .unwrap_or(true)
                .then_some("File Watch Trigger requires an approved folder."),
            "desktop_notification" => node
                .configuration
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::is_empty)
                .unwrap_or(true)
                .then_some("Desktop Notification requires a title."),
            "move_file" => (node.configuration.get("source").is_none()
                || node.configuration.get("destinationFolder").is_none())
            .then_some("Move File requires source and destination paths."),
            "read_file" => missing_string_or_binding(node, "path")
                .then_some("Read File requires an approved file path."),
            "write_file" => (missing_string_or_binding(node, "path")
                || missing_value_or_binding(node, "content"))
            .then_some("Write File requires a path and content."),
            "copy_path" => (missing_string_or_binding(node, "source")
                || missing_string_or_binding(node, "destination"))
            .then_some("Copy File or Folder requires source and destination paths."),
            "delete_path" => missing_string_or_binding(node, "path")
                .then_some("Delete File or Folder requires an approved path."),
            "list_folder" => missing_string_or_binding(node, "folder")
                .then_some("List Folder requires an approved folder."),
            "parse_csv" | "parse_json" | "parse_text" => (missing_string_or_binding(node, "path")
                && missing_string_or_binding(node, "content"))
            .then_some("Map content from another node or choose an approved file."),
            "get_workflow_state" | "set_workflow_state" | "compare_previous" => {
                missing_string_or_binding(node, "key")
                    .then_some("Workflow state nodes require a state key.")
            }
            "run_command" => node
                .configuration
                .get("executable")
                .and_then(|v| v.as_str())
                .map(str::is_empty)
                .unwrap_or(true)
                .then_some("Run Command requires an executable."),
            "ai_prompt" => {
                if missing_string_or_binding(node, "connectionId") {
                    Some("AI requires a connected model.")
                } else if missing_string_or_binding(node, "prompt") {
                    Some("AI requires an instruction.")
                } else {
                    None
                }
            }
            "code" => missing_string_or_binding(node, "sourceCode")
                .then_some("Code requires source before it can run."),
            "web_builder" => (missing_string_or_binding(node, "html")
                || missing_string_or_binding(node, "javascript")
                || missing_string_or_binding(node, "css"))
            .then_some("Web Builder requires mapped HTML, JavaScript, and CSS inputs."),
            "open_browser" => empty_string(&node.configuration, "profileId")
                .then_some("Open Browser requires a managed browser profile."),
            "navigate" => {
                empty_string(&node.configuration, "url").then_some("Navigate requires a URL.")
            }
            "click_element" | "select_option" | "extract_data" => {
                (!has_locator(&node.configuration))
                    .then_some("This browser action requires a structured target locator.")
            }
            "fill_field" => {
                if !has_locator(&node.configuration) {
                    Some("Fill Field requires a structured target locator.")
                } else if empty_string(&node.configuration, "value") {
                    Some(
                        if node
                            .configuration
                            .get("sensitive")
                            .and_then(|v| v.as_bool())
                            == Some(true)
                        {
                            "Fill Field has a protected value that must be mapped to a credential or protected workflow input."
                        } else {
                            "Fill Field requires a value."
                        },
                    )
                } else {
                    None
                }
            }
            "download_file" => {
                if !has_locator(&node.configuration) {
                    Some("Download File requires a structured target locator.")
                } else if empty_string(&node.configuration, "destinationFolder") {
                    Some("Download File requires an approved destination folder.")
                } else {
                    None
                }
            }
            "upload_file" => {
                if !has_locator(&node.configuration) {
                    Some("Upload File requires a structured target locator.")
                } else if empty_string(&node.configuration, "file") {
                    Some("Upload File requires an approved local file or trusted file mapping.")
                } else {
                    None
                }
            }
            "gmail_new_email_trigger" => empty_string(&node.configuration, "credentialId")
                .then_some("New Email Trigger requires a Gmail connection."),
            "gmail_get_email" => {
                if empty_string(&node.configuration, "credentialId") {
                    Some("Get Email requires a Gmail connection.")
                } else if empty_string(&node.configuration, "messageId") {
                    Some("Get Email requires a message or thread ID.")
                } else {
                    None
                }
            }
            "gmail_create_draft" | "gmail_send_email" => {
                if empty_string(&node.configuration, "credentialId") {
                    Some("Gmail action requires a connection.")
                } else if empty_string(&node.configuration, "to") {
                    Some("Email action requires at least one recipient.")
                } else {
                    None
                }
            }
            "gmail_add_label" => {
                if empty_string(&node.configuration, "credentialId") {
                    Some("Add Label requires a Gmail connection.")
                } else if empty_string(&node.configuration, "messageId") {
                    Some("Add Label requires a message ID.")
                } else {
                    None
                }
            }
            "discord_webhook" | "discord_embed" | "slack_webhook" => {
                if empty_string(&node.configuration, "credentialId") {
                    Some("Webhook action requires a secure connection.")
                } else if empty_string(
                    &node.configuration,
                    if node.node_type == "discord_embed" {
                        "description"
                    } else {
                        "content"
                    },
                ) {
                    Some("Webhook action requires message content.")
                } else {
                    None
                }
            }
            "approval" => empty_string(&node.configuration, "proposedAction")
                .then_some("Manual Approval requires a proposed action description."),
            _ => None,
        };
        if let Some(message) = missing {
            let mut incomplete = issue("incomplete_node", message, Some(node.id.clone()), None);
            if let Some(field) = incomplete_field(node) {
                incomplete.field_path = Some(format!("configuration.{field}"));
                incomplete.suggestion =
                    Some("Complete this field before running the workflow.".into());
            }
            issues.push(incomplete);
        }
        if is_browser_action(&node.node_type)
            && !has_upstream_browser_session(workflow, &node.id, &mut HashSet::new())
        {
            issues.push(issue(
                "browser_session_missing",
                format!("{} has no upstream Open Browser session.", node.name),
                Some(node.id.clone()),
                None,
            ));
        }
    }
    issues
}

fn missing_string_or_binding(node: &crate::WorkflowNode, field: &str) -> bool {
    !node.input_bindings.contains_key(field)
        && node
            .configuration
            .get(field)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
}

fn missing_value_or_binding(node: &crate::WorkflowNode, field: &str) -> bool {
    !node.input_bindings.contains_key(field)
        && node
            .configuration
            .get(field)
            .is_none_or(|value| value.is_null())
}

fn incomplete_field(node: &crate::WorkflowNode) -> Option<&'static str> {
    let config = &node.configuration;
    match node.node_type.as_str() {
        "http_request" | "navigate" => Some("url"),
        "condition" => Some(if config.get("left").is_none() {
            "left"
        } else {
            "operator"
        }),
        "schedule_trigger" => Some("scheduleType"),
        "file_watch_trigger" => Some("folder"),
        "desktop_notification" => Some("title"),
        "move_file" => Some(if config.get("source").is_none() {
            "source"
        } else {
            "destinationFolder"
        }),
        "run_command" => Some("executable"),
        "ai_prompt" => Some(if empty_string(config, "connectionId") {
            "connectionId"
        } else {
            "prompt"
        }),
        "code" => Some("sourceCode"),
        "web_builder" => Some(if missing_string_or_binding(node, "html") {
            "html"
        } else if missing_string_or_binding(node, "javascript") {
            "javascript"
        } else {
            "css"
        }),
        "open_browser" => Some("profileId"),
        "click_element" | "select_option" | "extract_data" => Some("locator"),
        "fill_field" => Some(if !has_locator(config) {
            "locator"
        } else {
            "value"
        }),
        "download_file" => Some(if !has_locator(config) {
            "locator"
        } else {
            "destinationFolder"
        }),
        "upload_file" => Some(if !has_locator(config) {
            "locator"
        } else {
            "file"
        }),
        "gmail_new_email_trigger" => Some("credentialId"),
        "gmail_get_email" => Some(if empty_string(config, "credentialId") {
            "credentialId"
        } else {
            "messageId"
        }),
        "gmail_create_draft" | "gmail_send_email" => {
            Some(if empty_string(config, "credentialId") {
                "credentialId"
            } else {
                "to"
            })
        }
        "gmail_add_label" => Some(if empty_string(config, "credentialId") {
            "credentialId"
        } else {
            "messageId"
        }),
        "discord_webhook" | "discord_embed" | "slack_webhook" => {
            Some(if empty_string(config, "credentialId") {
                "credentialId"
            } else if node.node_type == "discord_embed" {
                "description"
            } else {
                "content"
            })
        }
        "approval" => Some("proposedAction"),
        _ => None,
    }
}

fn empty_string(configuration: &serde_json::Value, key: &str) -> bool {
    configuration
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
}

fn has_locator(configuration: &serde_json::Value) -> bool {
    configuration
        .get("locator")
        .and_then(|value| value.get("primary"))
        .and_then(|value| value.get("value"))
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn is_browser_action(node_type: &str) -> bool {
    matches!(
        node_type,
        "navigate"
            | "click_element"
            | "fill_field"
            | "select_option"
            | "press_key"
            | "wait_for"
            | "extract_data"
            | "screenshot"
            | "download_file"
            | "upload_file"
            | "close_browser"
    )
}

fn has_upstream_browser_session(
    workflow: &Workflow,
    node_id: &str,
    visited: &mut HashSet<String>,
) -> bool {
    if !visited.insert(node_id.to_string()) {
        return false;
    }
    workflow
        .edges
        .iter()
        .filter(|edge| edge.target_node_id == node_id)
        .any(|edge| {
            workflow
                .nodes
                .iter()
                .find(|node| node.id == edge.source_node_id)
                .map(|node| {
                    node.node_type == "open_browser"
                        || (is_browser_action(&node.node_type)
                            && has_upstream_browser_session(workflow, &node.id, visited))
                })
                .unwrap_or(false)
        })
}

fn issue(
    code: &str,
    message: impl Into<String>,
    node_id: Option<String>,
    edge_id: Option<String>,
) -> ValidationIssue {
    ValidationIssue {
        code: code.into(),
        message: message.into(),
        severity: ValidationSeverity::Error,
        node_id,
        edge_id,
        field_path: None,
        suggestion: None,
    }
}

pub fn topological_order(workflow: &Workflow) -> Result<Vec<String>, EngineError> {
    let mut indegree: HashMap<&str, usize> =
        workflow.nodes.iter().map(|n| (n.id.as_str(), 0)).collect();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in &workflow.edges {
        if let Some(value) = indegree.get_mut(edge.target_node_id.as_str()) {
            *value += 1;
        }
        outgoing
            .entry(edge.source_node_id.as_str())
            .or_default()
            .push(edge.target_node_id.as_str());
    }
    let mut queue: VecDeque<&str> = workflow
        .nodes
        .iter()
        .filter(|n| indegree.get(n.id.as_str()) == Some(&0))
        .map(|n| n.id.as_str())
        .collect();
    let mut result = Vec::new();
    while let Some(id) = queue.pop_front() {
        result.push(id.to_string());
        for target in outgoing.get(id).into_iter().flatten() {
            if let Some(value) = indegree.get_mut(target) {
                *value -= 1;
                if *value == 0 {
                    queue.push_back(target);
                }
            }
        }
    }
    if result.len() != workflow.nodes.len() {
        return Err(EngineError::Validation("Workflow contains a cycle.".into()));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    use chrono::Utc;
    use serde_json::json;
    fn workflow(edges: Vec<(&str, &str)>) -> Workflow {
        let nodes = ["a", "b", "c"]
            .iter()
            .map(|id| WorkflowNode {
                id: id.to_string(),
                node_type: if *id == "a" {
                    "manual_trigger"
                } else {
                    "set_data"
                }
                .into(),
                version: 1,
                name: id.to_string(),
                position: Position { x: 0., y: 0. },
                configuration: json!({}),
                disabled: false,
                input_bindings: Default::default(),
                plugin: None,
            })
            .collect();
        Workflow {
            id: "w".into(),
            schema_version: crate::model::CURRENT_SCHEMA_VERSION,
            owner: Default::default(),
            name: "test".into(),
            description: "".into(),
            enabled: true,
            trigger_node_id: "a".into(),
            nodes,
            edges: edges
                .into_iter()
                .enumerate()
                .map(|(i, (s, t))| WorkflowEdge {
                    id: i.to_string(),
                    source_node_id: s.into(),
                    source_handle: "output".into(),
                    target_node_id: t.into(),
                    target_handle: "input".into(),
                    kind: "control".into(),
                    source_port: Some("output".into()),
                    target_port: Some("input".into()),
                })
                .collect(),
            settings: Default::default(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
    #[test]
    fn orders_dependencies() {
        assert_eq!(
            topological_order(&workflow(vec![("a", "b"), ("b", "c")])).unwrap(),
            vec!["a", "b", "c"]
        );
    }
    #[test]
    fn detects_cycles() {
        assert!(topological_order(&workflow(vec![("a", "b"), ("b", "c"), ("c", "a")])).is_err());
    }
    #[test]
    fn reports_disconnected_node() {
        assert!(validate(&workflow(vec![("a", "b")]))
            .iter()
            .any(|i| i.code == "disconnected_node"));
    }
}
