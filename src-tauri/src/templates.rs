use chrono::Utc;
use sandbox_engine::{
    PermissionSummary, Position, Workflow, WorkflowEdge, WorkflowNode, WorkflowSettings,
    CURRENT_SCHEMA_VERSION,
};
use serde_json::json;
use uuid::Uuid;

fn node(
    id: &str,
    node_type: &str,
    name: &str,
    x: f64,
    y: f64,
    configuration: serde_json::Value,
) -> WorkflowNode {
    WorkflowNode {
        id: id.into(),
        node_type: node_type.into(),
        version: 1,
        name: name.into(),
        position: Position { x, y },
        configuration,
        disabled: false,
        input_bindings: Default::default(),
        plugin: None,
    }
}
fn edge(id: &str, source: &str, handle: &str, target: &str) -> WorkflowEdge {
    WorkflowEdge {
        id: id.into(),
        source_node_id: source.into(),
        source_handle: handle.into(),
        target_node_id: target.into(),
        target_handle: "input".into(),
        kind: "control".into(),
        source_port: Some(handle.into()),
        target_port: Some("input".into()),
    }
}
fn base(
    name: &str,
    nodes: Vec<WorkflowNode>,
    edges: Vec<WorkflowEdge>,
    trigger: &str,
    permissions: PermissionSummary,
) -> Workflow {
    let now = Utc::now();
    Workflow {
        id: Uuid::new_v4().to_string(),
        schema_version: CURRENT_SCHEMA_VERSION,
        owner: Default::default(),
        name: name.into(),
        description: "".into(),
        enabled: false,
        trigger_node_id: trigger.into(),
        nodes,
        edges,
        settings: WorkflowSettings {
            permissions,
            ..Default::default()
        },
        created_at: now,
        updated_at: now,
    }
}

pub fn blank(name: Option<String>) -> Workflow {
    base(
        name.as_deref().unwrap_or("Untitled workflow"),
        vec![node(
            "manual_trigger",
            "manual_trigger",
            "Manual Trigger",
            80.,
            220.,
            json!({}),
        )],
        vec![],
        "manual_trigger",
        PermissionSummary::default(),
    )
}

pub fn website_health() -> Workflow {
    base(
        "Website Health Monitor",
        vec![
            node(
                "manual_trigger",
                "manual_trigger",
                "Manual Trigger",
                60.,
                220.,
                json!({}),
            ),
            node(
                "http_request",
                "http_request",
                "HTTP Request",
                340.,
                220.,
                json!({"method":"GET","url":"https://example.com","query":{},"headers":{},"body":null,"timeoutMs":30000,"retryCount":1}),
            ),
            node(
                "condition",
                "condition",
                "Condition",
                620.,
                220.,
                json!({"left":"{{nodes.http_request.output.status}}","operator":"equals","right":200}),
            ),
            node(
                "notification_success",
                "desktop_notification",
                "Desktop Notification",
                920.,
                150.,
                json!({"title":"Website is healthy","message":"example.com returned status {{nodes.http_request.output.status}}"}),
            ),
            node(
                "notification_failed",
                "desktop_notification",
                "Desktop Notification",
                920.,
                330.,
                json!({"title":"Website needs attention","message":"example.com returned status {{nodes.http_request.output.status}}"}),
            ),
        ],
        vec![
            edge("e1", "manual_trigger", "output", "http_request"),
            edge("e2", "http_request", "output", "condition"),
            edge("e3", "condition", "true", "notification_success"),
            edge("e4", "condition", "false", "notification_failed"),
        ],
        "manual_trigger",
        PermissionSummary {
            approved_network_domains: vec!["example.com".into()],
            ..Default::default()
        },
    )
}

pub fn downloads_organiser() -> Workflow {
    base(
        "Downloads Folder Organiser",
        vec![
            node(
                "file_watch",
                "file_watch_trigger",
                "File Watch Trigger",
                60.,
                220.,
                json!({"folder":"","events":["created"],"pattern":"*.pdf"}),
            ),
            node(
                "condition",
                "condition",
                "Condition",
                340.,
                220.,
                json!({"left":"{{trigger.extension}}","operator":"equals","right":"pdf"}),
            ),
            node(
                "move_file",
                "move_file",
                "Move File",
                650.,
                150.,
                json!({"source":"{{trigger.path}}","destinationFolder":"","renameTo":"","overwrite":false}),
            ),
        ],
        vec![
            edge("e1", "file_watch", "output", "condition"),
            edge("e2", "condition", "true", "move_file"),
        ],
        "file_watch",
        PermissionSummary::default(),
    )
}

fn accessible_locator(kind: &str, value: &str, name: Option<&str>) -> serde_json::Value {
    json!({
        "primary": { "kind": kind, "value": value, "name": name },
        "alternatives": [],
        "elementRole": if kind == "role" { Some(value) } else { None::<&str> },
        "accessibleName": name,
        "tag": null,
        "stableAttributes": {},
        "frame": null,
        "recordingUrl": null,
        "nearbyText": null
    })
}

pub fn website_change_monitor() -> Workflow {
    base(
        "Website Change Monitor",
        vec![
            node(
                "schedule",
                "schedule_trigger",
                "Every 30 minutes",
                60.,
                220.,
                json!({"scheduleType":"minutes","every":30,"time":"09:00","cron":"*/30 * * * *"}),
            ),
            node(
                "browser",
                "open_browser",
                "Open monitored browser",
                340.,
                220.,
                json!({"profileId":"","headed":false,"initialUrl":"","viewport":{"width":1280,"height":800},"defaultTimeoutMs":30000,"closeAutomatically":true,"maximumDurationMs":600000}),
            ),
            node(
                "navigate",
                "navigate",
                "Open monitored page",
                620.,
                220.,
                json!({"url":"https://example.com","waitCondition":"dom_ready","timeoutMs":30000}),
            ),
            node(
                "extract",
                "extract_data",
                "Extract page heading",
                900.,
                220.,
                json!({"locator":accessible_locator("role", "heading", Some("Example Domain")),"extract":"text","fieldName":"heading","repeated":false,"timeoutMs":30000}),
            ),
            node(
                "compare",
                "compare_previous",
                "Compare with previous heading",
                1180.,
                220.,
                json!({"key":"website-heading","value":"{{nodes.extract.output.data.heading}}","normalization":"collapse_whitespace"}),
            ),
            node(
                "condition",
                "condition",
                "Heading changed",
                1460.,
                220.,
                json!({"left":"{{nodes.compare.output.changed}}","operator":"equals","right":true}),
            ),
            node(
                "changed",
                "desktop_notification",
                "Notify when changed",
                1740.,
                330.,
                json!({"title":"Website content changed","message":"The monitored heading is now: {{nodes.extract.output.data.heading}}"}),
            ),
        ],
        vec![
            edge("e1", "schedule", "output", "browser"),
            edge("e2", "browser", "output", "navigate"),
            edge("e3", "navigate", "output", "extract"),
            edge("e4", "extract", "output", "compare"),
            edge("e5", "compare", "output", "condition"),
            edge("e6", "condition", "true", "changed"),
        ],
        "schedule",
        PermissionSummary {
            approved_network_domains: vec!["example.com".into()],
            ..Default::default()
        },
    )
}

pub fn download_daily_report() -> Workflow {
    base(
        "Download Daily Report",
        vec![
            node(
                "schedule",
                "schedule_trigger",
                "Daily at 09:00",
                60.,
                220.,
                json!({"scheduleType":"daily","every":1,"time":"09:00","cron":"0 9 * * *"}),
            ),
            node(
                "browser",
                "open_browser",
                "Open reporting profile",
                340.,
                220.,
                json!({"profileId":"","headed":false,"initialUrl":"","viewport":{"width":1280,"height":800},"defaultTimeoutMs":30000,"closeAutomatically":true,"maximumDurationMs":900000}),
            ),
            node(
                "navigate",
                "navigate",
                "Open report portal",
                620.,
                220.,
                json!({"url":"https://example.com","waitCondition":"dom_ready","timeoutMs":30000}),
            ),
            node(
                "fill",
                "fill_field",
                "Fill account email",
                900.,
                220.,
                json!({"locator":accessible_locator("label", "Email address", Some("Email address")),"value":"","clearExisting":true,"inputDelayMs":0,"sensitive":false,"timeoutMs":30000}),
            ),
            node(
                "click",
                "click_element",
                "Open reports",
                1180.,
                220.,
                json!({"locator":accessible_locator("role", "button", Some("Open reports")),"clickType":"normal","mouseButton":"left","modifiers":[],"waitAfterMs":500,"timeoutMs":30000}),
            ),
            node(
                "download",
                "download_file",
                "Download report",
                1460.,
                220.,
                json!({"locator":accessible_locator("role", "button", Some("Download report")),"destinationFolder":"","filename":"daily-report.csv","collisionBehaviour":"rename","maximumBytes":104857600,"timeoutMs":60000}),
            ),
            node(
                "parse",
                "parse_csv",
                "Parse downloaded report",
                1740.,
                220.,
                json!({"path":"{{nodes.download.output.path}}","content":"","delimiter":",","hasHeaders":true,"trim":true}),
            ),
            node(
                "condition",
                "condition",
                "Report contains rows",
                2020.,
                220.,
                json!({"left":"{{nodes.parse.output.rowCount}}","operator":"greater_than","right":0}),
            ),
            node(
                "notification",
                "desktop_notification",
                "Report ready",
                2300.,
                220.,
                json!({"title":"Daily report ready","message":"Verified {{nodes.parse.output.rowCount}} rows in {{nodes.download.output.filename}}"}),
            ),
        ],
        vec![
            edge("e1", "schedule", "output", "browser"),
            edge("e2", "browser", "output", "navigate"),
            edge("e3", "navigate", "output", "fill"),
            edge("e4", "fill", "output", "click"),
            edge("e5", "click", "output", "download"),
            edge("e6", "download", "output", "parse"),
            edge("e7", "parse", "output", "condition"),
            edge("e8", "condition", "true", "notification"),
        ],
        "schedule",
        PermissionSummary {
            approved_network_domains: vec!["example.com".into()],
            ..Default::default()
        },
    )
}

pub fn email_enquiry_draft() -> Workflow {
    base(
        "Email Enquiry Draft",
        vec![
            node(
                "new_email",
                "gmail_new_email_trigger",
                "New enquiry email",
                60.,
                220.,
                json!({"credentialId":"","pollIntervalMinutes":5,"sender":"","recipient":"","subjectContains":"enquiry","hasAttachment":false,"label":"","includeHtmlBody":false,"markAsProcessed":"deduplicate"}),
            ),
            node(
                "condition",
                "condition",
                "Has a sender",
                340.,
                220.,
                json!({"left":"{{trigger.email.sender}}","operator":"exists","right":null}),
            ),
            node(
                "compose",
                "set_data",
                "Prepare acknowledgement",
                620.,
                150.,
                json!({"values":{"recipient":"{{trigger.email.sender}}","subject":"Re: {{trigger.email.subject}}","body":"Thanks for your enquiry. We have received your message and will respond shortly."}}),
            ),
            node(
                "draft",
                "gmail_create_draft",
                "Create Gmail draft",
                900.,
                150.,
                json!({"credentialId":"","to":"{{nodes.compose.output.recipient}}","cc":"","bcc":"","subject":"{{nodes.compose.output.subject}}","body":"{{nodes.compose.output.body}}","htmlBody":"","replyToMessage":"{{trigger.email.messageId}}"}),
            ),
            node(
                "notification",
                "desktop_notification",
                "Draft ready",
                1180.,
                150.,
                json!({"title":"Email draft ready","message":"A draft reply to {{trigger.email.sender}} is ready in Gmail."}),
            ),
        ],
        vec![
            edge("e1", "new_email", "output", "condition"),
            edge("e2", "condition", "true", "compose"),
            edge("e3", "compose", "output", "draft"),
            edge("e4", "draft", "output", "notification"),
        ],
        "new_email",
        PermissionSummary::default(),
    )
}

pub fn website_status_discord() -> Workflow {
    base(
        "Website Status to Discord",
        vec![
            node(
                "schedule",
                "schedule_trigger",
                "Every 15 minutes",
                60.,
                220.,
                json!({"scheduleType":"minutes","every":15,"time":"09:00","cron":"*/15 * * * *"}),
            ),
            node(
                "request",
                "http_request",
                "Check website",
                340.,
                220.,
                json!({"method":"GET","url":"https://example.com","query":{},"headers":{},"body":null,"timeoutMs":30000,"retryCount":1}),
            ),
            node(
                "condition",
                "condition",
                "Status is healthy",
                620.,
                220.,
                json!({"left":"{{nodes.request.output.status}}","operator":"equals","right":200}),
            ),
            node(
                "discord",
                "discord_webhook",
                "Alert Discord",
                900.,
                330.,
                json!({"credentialId":"","content":"Website check failed with HTTP {{nodes.request.output.status}}.","username":"sndbox monitor","avatarUrl":""}),
            ),
        ],
        vec![
            edge("e1", "schedule", "output", "request"),
            edge("e2", "request", "output", "condition"),
            edge("e3", "condition", "false", "discord"),
        ],
        "schedule",
        PermissionSummary {
            approved_network_domains: vec!["example.com".into()],
            ..Default::default()
        },
    )
}

pub fn by_key(key: &str, name: Option<String>) -> Workflow {
    match key {
        "website-health" => website_health(),
        "website-change-monitor" => website_change_monitor(),
        "download-daily-report" => download_daily_report(),
        "email-enquiry-draft" => email_enquiry_draft(),
        "website-status-discord" => website_status_discord(),
        "downloads-organiser" => downloads_organiser(),
        "browser-automation" | "report-collection" => download_daily_report(),
        "file-folder-automation" => downloads_organiser(),
        "website-monitoring" => website_change_monitor(),
        "developer-workflows" => website_health(),
        "homelab-automation" => website_status_discord(),
        _ => blank(name),
    }
}
