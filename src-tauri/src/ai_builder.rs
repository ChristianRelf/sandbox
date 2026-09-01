use crate::AppState;
use sandbox_engine::{
    validation::{validate, ValidationIssue},
    Position, Workflow, WorkflowEdge, WorkflowNode,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use tauri::State;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;

const SUPPORTED_NODES: &[&str] = &[
    "manual_trigger",
    "schedule_trigger",
    "file_watch_trigger",
    "condition",
    "set_data",
    "delay",
    "http_request",
    "desktop_notification",
    "move_file",
    "read_file",
    "write_file",
    "copy_path",
    "delete_path",
    "list_folder",
    "parse_csv",
    "parse_json",
    "parse_text",
    "get_workflow_state",
    "set_workflow_state",
    "compare_previous",
    "run_command",
    "open_browser",
    "navigate",
    "click_element",
    "fill_field",
    "select_option",
    "press_key",
    "wait_for",
    "extract_data",
    "screenshot",
    "download_file",
    "upload_file",
    "close_browser",
    "gmail_new_email_trigger",
    "gmail_get_email",
    "gmail_create_draft",
    "gmail_send_email",
    "gmail_add_label",
    "discord_webhook",
    "discord_embed",
    "slack_webhook",
    "approval",
];

const TRIGGER_NODES: &[&str] = &[
    "manual_trigger",
    "schedule_trigger",
    "file_watch_trigger",
    "gmail_new_email_trigger",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiGraph {
    #[serde(default)]
    reply: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    nodes: Vec<AiNode>,
    edges: Vec<AiEdge>,
}

#[derive(Debug, Deserialize)]
struct AiNode {
    key: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default = "empty_object")]
    configuration: Value,
    #[serde(default)]
    disabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiEdge {
    source: String,
    target: String,
    #[serde(default = "output_handle")]
    source_handle: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiWorkflowProposal {
    workflow: Workflow,
    message: String,
    added_node_count: usize,
    removed_node_count: usize,
    issues: Vec<ValidationIssue>,
}

fn empty_object() -> Value {
    json!({})
}

fn output_handle() -> String {
    "output".into()
}

#[tauri::command]
pub async fn build_workflow_with_ai(
    connection_id: String,
    message: String,
    workflow: Workflow,
    state: State<'_, AppState>,
) -> Result<AiWorkflowProposal> {
    let request = message.trim();
    if request.is_empty() {
        return Err("Tell the AI what you want to build or change.".into());
    }
    if request.chars().count() > 8_000 {
        return Err("AI workflow requests are limited to 8,000 characters.".into());
    }

    let connection = state
        .engine
        .database()
        .get_connection(&connection_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The selected AI connection no longer exists.".to_string())?;
    if !matches!(
        connection.provider.as_str(),
        "openai" | "anthropic" | "openai_compatible"
    ) {
        return Err("Choose an OpenAI, Anthropic, or OpenAI-compatible connection.".into());
    }
    let secret = state.credential_vault.get(&connection_id)?;
    let api_key = secret
        .get("apiKey")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "The AI API key is missing. Reconnect this provider.".to_string())?;
    let model = connection
        .metadata
        .get("model")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "The AI connection needs a model ID. Reconnect it with a model available to your account.".to_string())?;

    let system = system_prompt();
    let current = serde_json::to_string(&workflow)
        .map_err(|error| format!("The current workflow could not be prepared: {error}"))?;
    let user = format!(
        "USER REQUEST:\n{request}\n\nCURRENT WORKFLOW:\n{current}\n\nReturn the complete replacement graph as JSON."
    );
    let content = request_provider(
        &connection.provider,
        &connection.metadata,
        api_key,
        model,
        &system,
        &user,
    )
    .await?;
    let graph = parse_graph(&content)?;
    graph_to_proposal(graph, workflow)
}

async fn request_provider(
    provider: &str,
    metadata: &Value,
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
) -> Result<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("The AI client could not start: {error}"))?;

    let response = if provider == "anthropic" {
        client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({
                "model": model,
                "max_tokens": 6_000,
                "system": system,
                "messages": [{"role": "user", "content": user}]
            }))
            .send()
            .await
    } else if provider == "openai" {
        client
            .post("https://api.openai.com/v1/responses")
            .bearer_auth(api_key)
            .json(&json!({
                "model": model,
                "instructions": system,
                "input": user,
                "store": false,
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "sndbox_workflow_graph",
                        "strict": false,
                        "schema": workflow_schema()
                    }
                }
            }))
            .send()
            .await
    } else {
        let base = compatible_base_url(metadata)?;
        client
            .post(format!("{}/chat/completions", base.trim_end_matches('/')))
            .bearer_auth(api_key)
            .json(&json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user}
                ]
            }))
            .send()
            .await
    }
    .map_err(|error| format!("The AI provider could not be reached: {error}"))?;

    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("The AI provider returned an unreadable response: {error}"))?;
    if !status.is_success() {
        let detail = value
            .pointer("/error/message")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("The provider rejected the request.");
        return Err(format!(
            "AI provider HTTP {status}: {}",
            truncate(detail, 500)
        ));
    }

    if provider == "anthropic" {
        value
            .get("content")
            .and_then(Value::as_array)
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item.get("type").and_then(Value::as_str) == Some("text"))
            })
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "Anthropic returned no text response.".into())
    } else if provider == "openai" {
        value
            .get("output")
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find_map(|item| {
                    item.get("content")
                        .and_then(Value::as_array)
                        .and_then(|content| {
                            content.iter().find(|part| {
                                part.get("type").and_then(Value::as_str) == Some("output_text")
                            })
                        })
                })
            })
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "OpenAI returned no workflow output.".into())
    } else {
        value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "The OpenAI-compatible provider returned no text response.".into())
    }
}

fn compatible_base_url(metadata: &Value) -> Result<String> {
    let raw = metadata
        .get("baseUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "The OpenAI-compatible connection needs a base URL.".to_string())?;
    let url = reqwest::Url::parse(raw).map_err(|_| "The AI base URL is invalid.".to_string())?;
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("AI base URLs must use HTTPS; HTTP is allowed only for localhost.".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Put credentials in the API key field, not in the AI base URL.".into());
    }
    Ok(raw.trim_end_matches('/').to_string())
}

fn parse_graph(content: &str) -> Result<AiGraph> {
    let trimmed = content.trim();
    let json_text = if trimmed.starts_with("```") {
        let after_line = trimmed.find('\n').map(|index| index + 1).unwrap_or(3);
        let end = trimmed.rfind("```").unwrap_or(trimmed.len());
        &trimmed[after_line..end]
    } else {
        trimmed
    };
    serde_json::from_str(json_text.trim()).map_err(|error| {
        format!("The AI response was not a valid sndbox workflow proposal: {error}")
    })
}

fn graph_to_proposal(graph: AiGraph, current: Workflow) -> Result<AiWorkflowProposal> {
    if graph.nodes.is_empty() || graph.nodes.len() > 100 {
        return Err("AI proposals must contain between 1 and 100 nodes.".into());
    }
    if graph.edges.len() > 250 {
        return Err("The AI proposal contains too many connections.".into());
    }
    let allowed: HashSet<&str> = SUPPORTED_NODES.iter().copied().collect();
    let mut keys = HashSet::new();
    for node in &graph.nodes {
        if node.key.trim().is_empty() || !keys.insert(node.key.clone()) {
            return Err("Every AI-proposed node needs a unique, non-empty key.".into());
        }
        if !allowed.contains(node.node_type.as_str()) {
            return Err(format!(
                "The AI proposed an unsupported node type: {}.",
                node.node_type
            ));
        }
        if !node.configuration.is_object() {
            return Err(format!(
                "Configuration for {} must be a JSON object.",
                node.key
            ));
        }
    }
    let triggers: Vec<&AiNode> = graph
        .nodes
        .iter()
        .filter(|node| TRIGGER_NODES.contains(&node.node_type.as_str()))
        .collect();
    if triggers.len() != 1 {
        return Err("The AI proposal must contain exactly one trigger node.".into());
    }

    let ids: HashMap<String, String> = graph
        .nodes
        .iter()
        .map(|node| {
            (
                node.key.clone(),
                format!("{}_{}", node.node_type, &Uuid::new_v4().to_string()[..8]),
            )
        })
        .collect();
    let trigger_key = triggers[0].key.clone();
    let mut level = HashMap::<String, usize>::from([(trigger_key.clone(), 0)]);
    for _ in 0..graph.nodes.len() {
        for edge in &graph.edges {
            if let Some(source_level) = level.get(&edge.source).copied() {
                let next = source_level + 1;
                level
                    .entry(edge.target.clone())
                    .and_modify(|value| *value = (*value).max(next))
                    .or_insert(next);
            }
        }
    }
    let mut rows = HashMap::<usize, usize>::new();
    let nodes: Vec<WorkflowNode> = graph
        .nodes
        .into_iter()
        .map(|node| {
            let column = level.get(&node.key).copied().unwrap_or(0);
            let row = rows.entry(column).or_insert(0);
            let position = Position {
                x: 60.0 + column as f64 * 280.0,
                y: 140.0 + *row as f64 * 160.0,
            };
            *row += 1;
            WorkflowNode {
                id: ids[&node.key].clone(),
                node_type: node.node_type.clone(),
                version: 1,
                name: node
                    .name
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| title_case(&node.node_type)),
                position,
                configuration: node.configuration,
                disabled: node.disabled,
                input_bindings: BTreeMap::new(),
                plugin: None,
            }
        })
        .collect();
    let mut seen_edges = HashSet::new();
    let edges: Vec<WorkflowEdge> = graph
        .edges
        .into_iter()
        .map(|edge| {
            if !ids.contains_key(&edge.source)
                || !ids.contains_key(&edge.target)
                || edge.source == edge.target
            {
                return Err(
                    "The AI proposal contains a connection to a missing or identical node."
                        .to_string(),
                );
            }
            if !seen_edges.insert((
                edge.source.clone(),
                edge.target.clone(),
                edge.source_handle.clone(),
            )) {
                return Err("The AI proposal contains a duplicate connection.".to_string());
            }
            Ok(WorkflowEdge {
                id: format!("edge_{}", &Uuid::new_v4().to_string()[..8]),
                source_node_id: ids[&edge.source].clone(),
                source_handle: edge.source_handle,
                target_node_id: ids[&edge.target].clone(),
                target_handle: "input".into(),
                kind: "control".into(),
                source_port: None,
                target_port: None,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let added_node_count = nodes.len().saturating_sub(current.nodes.len());
    let removed_node_count = current.nodes.len().saturating_sub(nodes.len());
    let mut workflow = current;
    workflow.name = graph
        .name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(workflow.name);
    workflow.description = graph.description.unwrap_or(workflow.description);
    workflow.trigger_node_id = ids[&trigger_key].clone();
    workflow.nodes = nodes;
    workflow.edges = edges;
    workflow.enabled = false;
    let issues = validate(&workflow);
    Ok(AiWorkflowProposal {
        workflow,
        message: if graph.reply.trim().is_empty() {
            "I drafted a workflow for you to review.".into()
        } else {
            graph.reply
        },
        added_node_count,
        removed_node_count,
        issues,
    })
}

fn system_prompt() -> String {
    format!(
        "You are the workflow builder inside sndbox. Convert the user's request into a complete visual workflow graph. Return JSON only, with this exact shape: {{\"reply\":\"brief explanation\",\"name\":\"optional workflow name\",\"description\":\"optional description\",\"nodes\":[{{\"key\":\"stable_local_key\",\"type\":\"node_type\",\"name\":\"label\",\"configuration\":{{}},\"disabled\":false}}],\"edges\":[{{\"source\":\"key\",\"target\":\"key\",\"sourceHandle\":\"output\"}}]}}. Output the complete replacement graph, including unchanged nodes when editing. Use exactly one trigger. Condition branches use sourceHandle true or false. Never invent node types, credentials, API keys, file paths, selectors, addresses, or personal data; leave unknown configuration values empty so the user can review them. Keep side-effecting actions disabled when intent is ambiguous. Supported node types: {}.",
        SUPPORTED_NODES.join(", ")
    )
}

fn workflow_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["reply", "name", "description", "nodes", "edges"],
        "properties": {
            "reply": {"type": "string"},
            "name": {"type": ["string", "null"]},
            "description": {"type": ["string", "null"]},
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["key", "type", "name", "configuration", "disabled"],
                    "properties": {
                        "key": {"type": "string"},
                        "type": {"type": "string", "enum": SUPPORTED_NODES},
                        "name": {"type": ["string", "null"]},
                        "configuration": {"type": "object", "additionalProperties": true},
                        "disabled": {"type": "boolean"}
                    }
                }
            },
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["source", "target", "sourceHandle"],
                    "properties": {
                        "source": {"type": "string"},
                        "target": {"type": "string"},
                        "sourceHandle": {"type": "string", "enum": ["output", "true", "false"]}
                    }
                }
            }
        }
    })
}

fn title_case(value: &str) -> String {
    value
        .split('_')
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_local_http_compatible_provider() {
        assert_eq!(
            compatible_base_url(&json!({"baseUrl":"http://localhost:11434/v1"})).unwrap(),
            "http://localhost:11434/v1"
        );
    }

    #[test]
    fn rejects_insecure_remote_compatible_provider() {
        assert!(compatible_base_url(&json!({"baseUrl":"http://example.com/v1"})).is_err());
    }

    #[test]
    fn parses_fenced_json() {
        let value = parse_graph("```json\n{\"nodes\":[],\"edges\":[]}\n```").unwrap();
        assert!(value.nodes.is_empty());
    }

    #[test]
    fn turns_a_safe_graph_into_a_disabled_reviewable_workflow() {
        let current = crate::templates::blank(Some("Original".into()));
        let graph = AiGraph {
            reply: "Drafted it.".into(),
            name: Some("Daily check".into()),
            description: Some("Checks an endpoint.".into()),
            nodes: vec![
                AiNode {
                    key: "start".into(),
                    node_type: "manual_trigger".into(),
                    name: None,
                    configuration: json!({}),
                    disabled: false,
                },
                AiNode {
                    key: "request".into(),
                    node_type: "http_request".into(),
                    name: Some("Check endpoint".into()),
                    configuration: json!({"url":""}),
                    disabled: true,
                },
            ],
            edges: vec![AiEdge {
                source: "start".into(),
                target: "request".into(),
                source_handle: "output".into(),
            }],
        };
        let proposal = graph_to_proposal(graph, current).unwrap();
        assert_eq!(proposal.workflow.name, "Daily check");
        assert!(!proposal.workflow.enabled);
        assert_eq!(proposal.workflow.nodes.len(), 2);
        assert_eq!(proposal.workflow.edges.len(), 1);
        assert_eq!(
            proposal.workflow.trigger_node_id,
            proposal.workflow.nodes[0].id
        );
    }
}
