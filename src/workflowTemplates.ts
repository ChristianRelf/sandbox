import type {
  InputBinding,
  PermissionSummary,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
} from "./types";

export type WorkflowTemplateCategory =
  | "AI"
  | "Monitoring"
  | "Browser"
  | "Communication"
  | "Files"
  | "Developer";

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  flow: string;
  requirements: string;
  category: WorkflowTemplateCategory;
  featured?: boolean;
}

export const BLANK_WORKFLOW_TEMPLATE = {
  key: "blank",
  name: "Blank workflow",
  description: "Start with a manual trigger and build from scratch.",
  flow: "Manual trigger",
  requirements: "No integrations required",
  category: "Developer" as const,
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "localhost-status-site",
    name: "Localhost Status Site",
    description:
      "Launch a small local uptime dashboard from editable HTML, JavaScript, and CSS blocks.",
    flow: "Manual → HTML + JS + CSS → Web Builder",
    requirements: "No integrations required",
    category: "Developer",
    featured: true,
  },
  {
    key: "ai-email-triage",
    name: "AI Email Triage",
    description:
      "Classify a new email, draft a useful reply, and leave the result ready for review.",
    flow: "New email → AI → Gmail draft → Notify",
    requirements: "AI and Gmail connections",
    category: "AI",
    featured: true,
  },
  {
    key: "website-change-monitor",
    name: "Website Change Monitor",
    description:
      "Watch a page heading and notify only when its normalized value changes.",
    flow: "Schedule → Browser → Extract → Compare → Notify",
    requirements: "Managed browser profile",
    category: "Monitoring",
    featured: true,
  },
  {
    key: "api-change-alert",
    name: "API Change Alert",
    description:
      "Poll a JSON endpoint, remember the previous response, and alert on meaningful changes.",
    flow: "Schedule → HTTP → Compare → Condition → Notify",
    requirements: "Network access",
    category: "Monitoring",
  },
  {
    key: "website-health",
    name: "Website Health Monitor",
    description:
      "Check an endpoint on demand and branch into healthy or needs-attention notifications.",
    flow: "Manual → HTTP → Condition → Notify",
    requirements: "Network access",
    category: "Monitoring",
  },
  {
    key: "website-status-discord",
    name: "Website Status to Discord",
    description:
      "Run a scheduled website check and post failures to a Discord channel.",
    flow: "Schedule → HTTP → Condition → Discord",
    requirements: "Discord webhook connection",
    category: "Communication",
  },
  {
    key: "slack-incident-alert",
    name: "Slack Incident Alert",
    description:
      "Check a service on a schedule and send a concise Slack incident message when it fails.",
    flow: "Schedule → HTTP → Condition → Slack",
    requirements: "Slack webhook connection",
    category: "Communication",
  },
  {
    key: "email-enquiry-draft",
    name: "Email Enquiry Draft",
    description:
      "Turn matching customer enquiries into acknowledgement drafts without sending automatically.",
    flow: "New email → Condition → Gmail draft → Notify",
    requirements: "Gmail connection",
    category: "Communication",
  },
  {
    key: "approval-email",
    name: "Approval-Gated Email",
    description:
      "Prepare a message, pause for local approval, then send it through Gmail.",
    flow: "Manual → Set data → Approval → Send email",
    requirements: "Gmail connection and approval",
    category: "Communication",
  },
  {
    key: "ai-daily-brief",
    name: "AI Daily Brief",
    description:
      "Ask your selected model for a focused daily plan and surface it as a desktop notification.",
    flow: "Schedule → AI → Notify",
    requirements: "AI connection",
    category: "AI",
  },
  {
    key: "ai-command-assistant",
    name: "AI Command Assistant",
    description:
      "Run an approved command mid-workflow, wait for it, then ask AI to explain the output.",
    flow: "Manual → Command → AI → Notify",
    requirements: "AI connection and command approval",
    category: "AI",
  },
  {
    key: "scheduled-screenshot",
    name: "Scheduled Website Screenshot",
    description:
      "Open a managed browser each morning and capture a full-page screenshot for run history.",
    flow: "Schedule → Browser → Navigate → Screenshot → Close",
    requirements: "Managed browser profile",
    category: "Browser",
  },
  {
    key: "download-daily-report",
    name: "Download Daily Report",
    description:
      "Navigate a reporting portal, download its CSV, verify rows, and notify when ready.",
    flow: "Schedule → Browser → Download → Parse → Notify",
    requirements: "Managed browser profile and folder access",
    category: "Browser",
  },
  {
    key: "downloads-organiser",
    name: "Downloads Folder Organiser",
    description:
      "Watch for new PDFs and move matching files into a destination folder.",
    flow: "File watch → Condition → Move file",
    requirements: "Folder access",
    category: "Files",
  },
  {
    key: "json-file-summary",
    name: "AI JSON File Summary",
    description:
      "Read and parse a JSON file, then have AI summarize its important fields and anomalies.",
    flow: "Manual → Read file → Parse JSON → AI → Notify",
    requirements: "AI connection and file access",
    category: "Files",
  },
];

export const ALL_WORKFLOW_STARTERS = [
  BLANK_WORKFLOW_TEMPLATE,
  ...WORKFLOW_TEMPLATES,
];

type WorkflowShell = Omit<
  Workflow,
  "name" | "triggerNodeId" | "nodes" | "edges"
>;

const node = (
  id: string,
  type: WorkflowNode["type"],
  name: string,
  x: number,
  y: number,
  configuration: Record<string, unknown>,
  inputBindings?: Record<string, InputBinding>,
): WorkflowNode => ({
  id,
  type,
  version: 1,
  name,
  position: { x, y },
  configuration,
  disabled: false,
  ...(inputBindings ? { inputBindings } : {}),
});

const edge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandle = "output",
  targetHandle = "input",
  sourcePort?: string,
): WorkflowEdge => ({
  id,
  sourceNodeId,
  sourceHandle,
  targetNodeId,
  targetHandle,
  kind: "control",
  sourcePort: sourcePort ?? sourceHandle,
  targetPort: targetHandle,
});

const withPermissions = (
  shell: WorkflowShell,
  patch: Partial<PermissionSummary>,
): WorkflowShell => ({
  ...shell,
  settings: {
    ...shell.settings,
    permissions: { ...shell.settings.permissions, ...patch },
  },
});

const workflow = (
  shell: WorkflowShell,
  name: string,
  triggerNodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): Workflow => ({ ...shell, name, triggerNodeId, nodes, edges });

/**
 * Additional templates used by the browser preview. The original starter
 * definitions remain in previewApi so existing saved demos retain their exact
 * node configuration.
 */
export function createAdditionalTemplateWorkflow(
  key: string,
  shell: WorkflowShell,
): Workflow | undefined {
  if (key === "api-change-alert") {
    const secured = withPermissions(shell, {
      approvedNetworkDomains: ["api.github.com"],
      backgroundExecutionPermitted: true,
    });
    return workflow(
      secured,
      "API Change Alert",
      "schedule",
      [
        node("schedule", "schedule_trigger", "Every 30 minutes", 60, 220, {
          scheduleType: "minutes",
          every: 30,
          time: "09:00",
          cron: "*/30 * * * *",
        }),
        node("request", "http_request", "Fetch API response", 340, 220, {
          method: "GET",
          url: "https://api.github.com/zen",
          query: {},
          headers: { Accept: "application/json" },
          body: null,
          timeoutMs: 30000,
          retryCount: 1,
        }),
        node("compare", "compare_previous", "Compare response", 620, 220, {
          key: "api-response",
          value: "{{nodes.request.output.body}}",
          normalization: "collapse_whitespace",
        }),
        node("condition", "condition", "Response changed", 900, 220, {
          left: "{{nodes.compare.output.changed}}",
          operator: "equals",
          right: true,
        }),
        node("notification", "desktop_notification", "Notify change", 1180, 150, {
          title: "API response changed",
          message: "The monitored API returned a different response.",
        }),
      ],
      [
        edge("e1", "schedule", "request"),
        edge("e2", "request", "compare"),
        edge("e3", "compare", "condition"),
        edge("e4", "condition", "notification", "true"),
      ],
    );
  }

  if (key === "slack-incident-alert") {
    const secured = withPermissions(shell, {
      approvedNetworkDomains: ["example.com"],
      backgroundExecutionPermitted: true,
      externalCommunicationPermitted: true,
    });
    return workflow(
      secured,
      "Slack Incident Alert",
      "schedule",
      [
        node("schedule", "schedule_trigger", "Every 5 minutes", 60, 220, {
          scheduleType: "minutes",
          every: 5,
          time: "09:00",
          cron: "*/5 * * * *",
        }),
        node("request", "http_request", "Check service", 340, 220, {
          method: "GET",
          url: "https://example.com",
          query: {},
          headers: {},
          body: null,
          timeoutMs: 15000,
          retryCount: 2,
        }),
        node("condition", "condition", "Service is healthy", 620, 220, {
          left: "{{nodes.request.output.status}}",
          operator: "equals",
          right: 200,
        }),
        node("slack", "slack_webhook", "Post incident", 900, 330, {
          credentialId: "",
          content:
            "Service check failed with HTTP {{nodes.request.output.status}}.",
        }),
      ],
      [
        edge("e1", "schedule", "request"),
        edge("e2", "request", "condition"),
        edge("e3", "condition", "slack", "false"),
      ],
    );
  }

  if (key === "ai-email-triage") {
    const secured = withPermissions(shell, {
      backgroundExecutionPermitted: true,
      externalCommunicationPermitted: true,
    });
    return workflow(
      secured,
      "AI Email Triage",
      "new_email",
      [
        node("new_email", "gmail_new_email_trigger", "New inbox email", 60, 220, {
          credentialId: "",
          pollIntervalMinutes: 5,
          sender: "",
          recipient: "",
          subjectContains: "",
          hasAttachment: false,
          label: "",
          includeHtmlBody: false,
          markAsProcessed: "deduplicate",
        }),
        node("ai", "ai_prompt", "Classify and draft reply", 340, 220, {
          connectionId: "",
          systemPrompt:
            "You triage incoming email. Return a concise, courteous draft reply only.",
          prompt:
            "Draft a reply to this email from {{trigger.email.sender}}. Subject: {{trigger.email.subject}}\n\n{{trigger.email.body}}",
          temperature: 0.2,
          maxTokens: 900,
          timeoutMs: 90000,
        }),
        node("draft", "gmail_create_draft", "Create reviewed draft", 620, 220, {
          credentialId: "",
          to: "{{trigger.email.sender}}",
          cc: "",
          bcc: "",
          subject: "Re: {{trigger.email.subject}}",
          body: "{{nodes.ai.output.response}}",
          htmlBody: "",
          replyToMessage: "{{trigger.email.messageId}}",
        }),
        node("notification", "desktop_notification", "Draft ready", 900, 220, {
          title: "AI email draft ready",
          message: "Review the draft reply to {{trigger.email.sender}} in Gmail.",
        }),
      ],
      [
        edge("e1", "new_email", "ai"),
        edge("e2", "ai", "draft"),
        edge("e3", "draft", "notification"),
      ],
    );
  }

  if (key === "ai-daily-brief") {
    const secured = withPermissions(shell, {
      backgroundExecutionPermitted: true,
    });
    return workflow(
      secured,
      "AI Daily Brief",
      "schedule",
      [
        node("schedule", "schedule_trigger", "Weekdays at 08:30", 60, 220, {
          scheduleType: "cron",
          every: 1,
          time: "08:30",
          cron: "30 8 * * 1-5",
        }),
        node("ai", "ai_prompt", "Write daily brief", 340, 220, {
          connectionId: "",
          systemPrompt:
            "You are a focused planning assistant. Be concise and action oriented.",
          prompt:
            "Create a short daily brief with three priorities, one risk to watch, and a first action.",
          temperature: 0.4,
          maxTokens: 700,
          timeoutMs: 90000,
        }),
        node("notification", "desktop_notification", "Show daily brief", 620, 220, {
          title: "Your AI daily brief",
          message: "{{nodes.ai.output.response}}",
        }),
      ],
      [edge("e1", "schedule", "ai"), edge("e2", "ai", "notification")],
    );
  }

  if (key === "ai-command-assistant") {
    const secured = withPermissions(shell, {
      commandExecutionPermitted: true,
    });
    return workflow(
      secured,
      "AI Command Assistant",
      "manual_trigger",
      [
        node("manual_trigger", "manual_trigger", "Manual Trigger", 60, 220, {}),
        node("command", "run_command", "Inspect repository status", 340, 220, {
          executable: "git",
          arguments: ["status", "--short"],
          workingDirectory: "",
          timeoutMs: 30000,
        }),
        node("ai", "ai_prompt", "Explain command output", 620, 220, {
          connectionId: "",
          systemPrompt:
            "You explain command output accurately and suggest safe next steps.",
          prompt:
            "Explain this command result and list any action needed. Exit code: {{nodes.command.output.exitCode}}\n\n{{nodes.command.output.stdout}}\n{{nodes.command.output.stderr}}",
          temperature: 0.2,
          maxTokens: 900,
          timeoutMs: 90000,
        }),
        node("notification", "desktop_notification", "Show explanation", 900, 220, {
          title: "Command analysis complete",
          message: "{{nodes.ai.output.response}}",
        }),
      ],
      [
        edge("e1", "manual_trigger", "command"),
        edge("e2", "command", "ai"),
        edge("e3", "ai", "notification"),
      ],
    );
  }

  if (key === "localhost-status-site") {
    const codeBinding = (nodeId: string): InputBinding => ({
      kind: "node_output",
      nodeId,
      path: ["code"],
    });
    return workflow(
      shell,
      "Localhost Status Site",
      "manual_trigger",
      [
        node("manual_trigger", "manual_trigger", "Manual Trigger", 40, 250, {}),
        node("html", "code", "Status page HTML", 320, 80, {
          language: "html",
          executionMode: "source",
          timeoutMs: 30000,
          sourceCode:
            '<main class="shell"><header><span class="pulse"></span><div><p>LOCAL MONITOR</p><h1>Systems operational</h1></div></header><section id="services"></section><footer>Updated <time id="updated">now</time></footer></main>',
        }),
        node("javascript", "code", "Status page JavaScript", 320, 250, {
          language: "javascript",
          executionMode: "source",
          timeoutMs: 30000,
          sourceCode:
            "const services = ['API', 'Website', 'Database'];\nconst root = document.querySelector('#services');\nroot.innerHTML = services.map(name => `<article><span>${name}</span><b>Operational</b></article>`).join('');\ndocument.querySelector('#updated').textContent = new Date().toLocaleTimeString();",
        }),
        node("css", "code", "Status page CSS", 320, 420, {
          language: "css",
          executionMode: "source",
          timeoutMs: 30000,
          sourceCode:
            ":root{font-family:Inter,system-ui;color:#eef1f5;background:#090b10}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#172033,#090b10 55%)}.shell{width:min(680px,calc(100% - 40px))}header{display:flex;align-items:center;gap:16px;margin-bottom:28px}.pulse{width:14px;height:14px;border-radius:50%;background:#62d994;box-shadow:0 0 0 8px #62d99418}p,footer{color:#7e899b;font-size:12px;letter-spacing:.14em}h1{margin:4px 0 0;font-size:34px}section{display:grid;gap:10px}article{display:flex;justify-content:space-between;padding:18px 20px;border:1px solid #273145;border-radius:12px;background:#111722cc}article b{color:#62d994;font-size:13px}footer{margin-top:18px;text-align:right}",
        }),
        node(
          "site",
          "web_builder",
          "Serve localhost site",
          650,
          250,
          { html: "", javascript: "", css: "", port: 0, openBrowser: true },
          {
            html: codeBinding("html"),
            javascript: codeBinding("javascript"),
            css: codeBinding("css"),
          },
        ),
      ],
      [
        edge("e1", "manual_trigger", "html"),
        edge("e2", "manual_trigger", "javascript"),
        edge("e3", "manual_trigger", "css"),
        edge("e4", "html", "site", "output", "html", "code"),
        edge("e5", "javascript", "site", "output", "javascript", "code"),
        edge("e6", "css", "site", "output", "css", "code"),
      ],
    );
  }

  if (key === "scheduled-screenshot") {
    const secured = withPermissions(shell, {
      approvedNetworkDomains: ["example.com"],
      browserAutomationPermitted: true,
      backgroundExecutionPermitted: true,
    });
    return workflow(
      secured,
      "Scheduled Website Screenshot",
      "schedule",
      [
        node("schedule", "schedule_trigger", "Daily at 09:00", 60, 220, {
          scheduleType: "daily",
          every: 1,
          time: "09:00",
          cron: "0 9 * * *",
        }),
        node("browser", "open_browser", "Open browser", 340, 220, {
          profileId: "",
          headed: false,
          initialUrl: "",
          viewport: { width: 1440, height: 900 },
          defaultTimeoutMs: 30000,
          closeAutomatically: true,
          keepOpenAfterManualTest: false,
          maximumDurationMs: 600000,
        }),
        node("navigate", "navigate", "Open website", 620, 220, {
          url: "https://example.com",
          waitCondition: "network_idle",
          timeoutMs: 30000,
        }),
        node("screenshot", "screenshot", "Capture full page", 900, 220, {
          mode: "full_page",
          includeInHistory: true,
          maximumBytes: 10485760,
          timeoutMs: 30000,
        }),
        node("close", "close_browser", "Close browser", 1180, 220, {}),
      ],
      [
        edge("e1", "schedule", "browser"),
        edge("e2", "browser", "navigate"),
        edge("e3", "navigate", "screenshot"),
        edge("e4", "screenshot", "close"),
      ],
    );
  }

  if (key === "json-file-summary") {
    const secured = withPermissions(shell, { approvedFolders: [] });
    return workflow(
      secured,
      "AI JSON File Summary",
      "manual_trigger",
      [
        node("manual_trigger", "manual_trigger", "Manual Trigger", 60, 220, {}),
        node("read", "read_file", "Read JSON file", 340, 220, {
          path: "",
          encoding: "utf8",
          maximumBytes: 10485760,
        }),
        node("parse", "parse_json", "Parse JSON", 620, 220, {
          path: "",
          content: "{{nodes.read.output.content}}",
        }),
        node("ai", "ai_prompt", "Summarize JSON", 900, 220, {
          connectionId: "",
          systemPrompt:
            "You summarize structured data accurately and call out missing or unusual values.",
          prompt:
            "Summarize the important fields and anomalies in this JSON:\n{{nodes.parse.output.value}}",
          temperature: 0.2,
          maxTokens: 1000,
          timeoutMs: 90000,
        }),
        node("notification", "desktop_notification", "Show summary", 1180, 220, {
          title: "JSON summary ready",
          message: "{{nodes.ai.output.response}}",
        }),
      ],
      [
        edge("e1", "manual_trigger", "read"),
        edge("e2", "read", "parse"),
        edge("e3", "parse", "ai"),
        edge("e4", "ai", "notification"),
      ],
    );
  }

  if (key === "approval-email") {
    const secured = withPermissions(shell, {
      externalCommunicationPermitted: true,
    });
    return workflow(
      secured,
      "Approval-Gated Email",
      "manual_trigger",
      [
        node("manual_trigger", "manual_trigger", "Manual Trigger", 60, 220, {}),
        node("compose", "set_data", "Compose message", 340, 220, {
          values: {
            recipient: "person@example.com",
            subject: "Status update",
            body: "Write your reviewed message here.",
          },
        }),
        node("approval", "approval", "Approve send", 620, 220, {
          proposedAction: "Send a Gmail message",
          recipient: "{{nodes.compose.output.recipient}}",
          subject: "{{nodes.compose.output.subject}}",
          messagePreview: "{{nodes.compose.output.body}}",
          attachments: [],
          expiresInMinutes: 60,
        }),
        node("send", "gmail_send_email", "Send approved email", 900, 220, {
          credentialId: "",
          to: "{{nodes.compose.output.recipient}}",
          cc: "",
          bcc: "",
          subject: "{{nodes.compose.output.subject}}",
          body: "{{nodes.compose.output.body}}",
          htmlBody: "",
          replyToMessage: "",
          attachments: [],
        }),
      ],
      [
        edge("e1", "manual_trigger", "compose"),
        edge("e2", "compose", "approval"),
        edge("e3", "approval", "send"),
      ],
    );
  }

  return undefined;
}
