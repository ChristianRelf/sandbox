import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NODE_DEFINITIONS, type NodeDefinition } from "../src/catalogue";

type FieldOverride = {
  name: string;
  type?: string;
  description?: string;
  options?: string[];
  shownWhen?: string;
};

const repositoryRoot = resolve(import.meta.dirname, "..");
const docsRoot = resolve(repositoryRoot, "apps/docs");
const nodesRoot = resolve(docsRoot, "nodes");
const apiRoot = resolve(docsRoot, "api-reference");

const categoryOrder = ["Triggers", "Logic", "Data", "Network", "Browser", "Communication", "System"];
const categoryIcons: Record<string, string> = {
  Triggers: "zap",
  Logic: "git-branch",
  Data: "braces",
  Network: "globe",
  Browser: "mouse-pointer-click",
  Communication: "send",
  System: "terminal",
};

const fieldDescriptions: Record<string, string> = {
  scheduleType: "Schedule mode used by the local runner.",
  every: "Interval in minutes when the schedule mode is `minutes`.",
  time: "Local time in `HH:mm` format for a daily schedule.",
  cron: "Five- or six-field cron expression for an advanced schedule.",
  folder: "Folder selected through the operating-system picker and added to the workflow permission boundary.",
  pattern: "Optional glob used to filter names inside the approved folder.",
  events: "File-system event types that can start the workflow.",
  credentialId: "Reference to a connection stored in the operating-system credential vault.",
  pollIntervalMinutes: "How often sndbox checks Gmail for matching messages.",
  sender: "Optional sender filter.",
  recipient: "Optional recipient filter.",
  subjectContains: "Optional text that must occur in the message subject.",
  hasAttachment: "Require at least one attachment.",
  label: "Optional Gmail label filter.",
  includeHtmlBody: "Include HTML in addition to the plain-text body.",
  markAsProcessed: "Persist message IDs per workflow so a message cannot trigger repeatedly.",
  left: "Value or mapped output on the left side of the comparison.",
  operator: "Comparison operation.",
  right: "Comparison value; hidden for `exists` and `not_exists`.",
  values: "Structured JSON object produced by the node.",
  amount: "Length of the non-blocking delay.",
  unit: "Unit applied to the delay amount.",
  method: "HTTP request method.",
  url: "Literal URL or mapped URL value.",
  query: "JSON object converted to query parameters.",
  headers: "JSON object of request headers. Authorization and cookie values are redacted from execution data.",
  body: "JSON request body for POST, PUT, and PATCH requests.",
  timeoutMs: "Maximum time for this operation in milliseconds.",
  retryCount: "Number of bounded retries after a retryable failure.",
  title: "Notification, message, or embed title.",
  message: "Notification text; accepts mapped data.",
  source: "Source file or folder inside an approved boundary.",
  destinationFolder: "Approved folder that receives the output.",
  destination: "Destination file or folder path.",
  renameTo: "Optional replacement filename.",
  overwrite: "Allow replacement when the destination already exists.",
  path: "Approved local file or folder path.",
  encoding: "Text encoding used to read the file.",
  maximumBytes: "Maximum accepted file, response, screenshot, or download size in bytes.",
  content: "Literal or mapped content. For parser nodes, mapped content takes precedence over the optional file.",
  createParents: "Create missing parent folders before writing.",
  recursive: "Include nested folders, or permit recursive deletion for Delete File or Folder.",
  delimiter: "Single character separating CSV fields.",
  hasHeaders: "Treat the first CSV row as field names.",
  trim: "Remove leading and trailing whitespace.",
  removeEmptyLines: "Exclude empty lines from parsed text output.",
  key: "Workflow-scoped state key.",
  defaultValue: "Value returned when the state key has not been stored.",
  value: "Literal value, protected reference, or mapped output.",
  normalization: "Text normalization applied before change comparison.",
  executable: "Explicit executable path. It is passed separately from arguments.",
  arguments: "Argument list. Each item is passed as one argument, without shell concatenation.",
  workingDirectory: "Approved working directory for the process.",
  profileId: "Managed browser profile selected in Settings.",
  headed: "Show the managed browser during a manual run. Scheduled runs default to headless.",
  initialUrl: "Optional first URL opened with the session.",
  viewport: "Browser viewport width and height. The editor accepts 320–3840 by 240–2160 pixels.",
  defaultTimeoutMs: "Default browser operation timeout, from 100 to 120000 milliseconds.",
  closeAutomatically: "Clean up the session when the workflow succeeds or fails.",
  keepOpenAfterManualTest: "Keep a manually tested session open for inspection.",
  maximumDurationMs: "Maximum managed browser session duration.",
  waitCondition: "Page condition Navigate waits for before succeeding.",
  locator: "Recorded locator bundle. sndbox prefers accessible role/name data and retains fallbacks.",
  clickType: "Normal, double, or right click.",
  mouseButton: "Mouse button sent to the page.",
  modifiers: "Keyboard modifiers held during the click.",
  waitAfterMs: "Optional delay after the click.",
  clearExisting: "Clear the field before entering the value.",
  inputDelayMs: "Delay between entered characters, from 0 to 2000 milliseconds.",
  sensitive: "Treat the mapped value as protected and redact it from execution data.",
  selectBy: "Match an option by value, visible label, or zero-based index.",
  option: "Option value, label, or index, depending on `selectBy`.",
  waitFor: "Browser event or state that must occur.",
  delayMs: "Time delay in milliseconds.",
  text: "Text that must be present on the page.",
  urlPattern: "URL pattern matched against navigation or network activity.",
  loadState: "DOM ready, page loaded, or network idle.",
  extract: "Kind of value read from the selected page element.",
  attribute: "HTML attribute name when extracting an attribute.",
  fieldName: "Name used for the extracted output value.",
  repeated: "Return all unique matches as a list instead of one value.",
  fields: "Column mapping used for table extraction, or Discord embed field objects.",
  mode: "Screenshot capture area.",
  includeInHistory: "Attach the screenshot artifact to execution history.",
  filename: "Optional destination filename.",
  collisionBehaviour: "Create a unique name, overwrite, or fail when the filename exists.",
  file: "Local file selected through the picker or mapped from a trusted path output.",
  messageId: "Gmail message or thread ID, usually mapped from a trigger or earlier Gmail node.",
  to: "Comma-separated or mapped recipient value.",
  cc: "Optional CC recipients.",
  bcc: "Optional BCC recipients.",
  subject: "Email subject or approval subject.",
  htmlBody: "Optional HTML email body.",
  replyToMessage: "Optional Gmail message ID to reply to.",
  attachments: "Approved attachment paths.",
  addLabelIds: "Gmail label IDs to add, one per line in the editor.",
  removeLabelIds: "Gmail label IDs to remove, one per line in the editor.",
  username: "Optional Discord webhook username override.",
  avatarUrl: "Optional Discord webhook avatar URL.",
  description: "Discord embed description.",
  color: "Discord embed color as a decimal integer.",
  link: "Optional link for the Discord embed.",
  image: "Optional image URL for the Discord embed.",
  proposedAction: "Plain-language action shown to the reviewer.",
  messagePreview: "Content preview shown before approval.",
  expiresInMinutes: "Time before the local approval expires, from 1 to 10080 minutes.",
};

const extras: Record<string, FieldOverride[]> = {
  navigate: [{ name: "locator", shownWhen: "`waitCondition` is `element_visible`" }],
  wait_for: [
    { name: "text", shownWhen: "`waitFor` is `text_present`" },
    { name: "urlPattern", shownWhen: "`waitFor` is `url_matches` or `network_response`" },
    { name: "loadState", options: ["dom_ready", "page_loaded", "network_idle"], shownWhen: "`waitFor` is `page_load_state`" },
  ],
  extract_data: [{ name: "attribute", shownWhen: "`extract` is `attribute`" }],
  screenshot: [{ name: "locator", shownWhen: "`mode` is `element`" }, { name: "timeoutMs" }],
  gmail_create_draft: [],
  gmail_send_email: [],
};

const options: Record<string, string[]> = {
  "schedule_trigger.scheduleType": ["minutes", "hourly", "daily", "cron"],
  "file_watch_trigger.events": ["created", "modified", "deleted"],
  "gmail_new_email_trigger.markAsProcessed": ["deduplicate"],
  "condition.operator": ["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "exists", "not_exists", "starts_with", "ends_with"],
  "delay.unit": ["seconds", "minutes"],
  "http_request.method": ["GET", "POST", "PUT", "PATCH", "DELETE"],
  "compare_previous.normalization": ["trim", "lowercase", "collapse_whitespace", "none"],
  "navigate.waitCondition": ["dom_ready", "page_loaded", "network_idle", "element_visible"],
  "click_element.clickType": ["normal", "double", "right"],
  "click_element.mouseButton": ["left", "middle", "right"],
  "select_option.selectBy": ["value", "label", "index"],
  "wait_for.waitFor": ["time", "element_visible", "element_hidden", "text_present", "url_matches", "download_begins", "network_response", "page_load_state"],
  "extract_data.extract": ["text", "attribute", "link", "image_source", "table"],
  "screenshot.mode": ["viewport", "full_page", "element"],
  "download_file.collisionBehaviour": ["rename", "overwrite", "fail"],
};

const nodeNotes: Record<string, string[]> = {
  schedule_trigger: ["Schedules are calculated by the local runner. Quitting the desktop app stops local schedules."],
  gmail_new_email_trigger: ["Message IDs are persisted per workflow to prevent the same email from starting repeated runs."],
  http_request: ["Authorization and cookie values are redacted from execution data."],
  open_browser: ["Create an isolated browser profile in Settings before running this node.", "Sessions are cleaned up after success or failure when `closeAutomatically` is enabled."],
  fill_field: ["Enable `sensitive` for protected mappings so entered values are redacted from logs and execution data."],
  screenshot: ["History artifacts follow the configured screenshot retention policy."],
  upload_file: ["A trusted path output from an earlier node may be mapped after the file has been approved."],
  close_browser: ["Any remaining managed sessions are cleaned up when the workflow ends."],
  gmail_create_draft: ["Drafts are the safer default because nothing is sent until a person reviews the message in Gmail."],
  gmail_send_email: ["Automatic sending requires approval for the selected connection and recipient logic. A material change revokes that approval."],
  discord_webhook: ["The webhook URL is resolved inside the Rust host and never enters workflow data or logs."],
  discord_embed: ["The webhook URL is resolved inside the Rust host and never enters workflow data or logs."],
  slack_webhook: ["The webhook URL is resolved inside the Rust host and never enters workflow data or logs."],
  approval: ["The execution pauses locally and appears in Pending approvals and the system tray until it is approved, rejected, or expires."],
  delete_path: ["The selected path must be inside an approved folder. Test runs require an additional destructive-action confirmation."],
  run_command: ["Automatic runs require explicit permission review. The executable and arguments are passed separately."],
  get_workflow_state: ["State writes are committed only after the complete workflow succeeds. Node tests only preview state changes."],
  set_workflow_state: ["State writes are committed only after the complete workflow succeeds. Node tests only preview state changes."],
  compare_previous: ["The new comparison value is committed only after the complete workflow succeeds."],
};

function slug(type: string): string {
  return type.replaceAll("_", "-").replaceAll(".", "-");
}

function titleCase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, character => character.toUpperCase());
}

function typeOf(value: unknown, name: string): string {
  if (name === "locator") return "locator";
  if (["path", "folder", "source", "destination", "destinationFolder", "workingDirectory", "file"].includes(name)) return "path";
  if (value === null || value === undefined) return "any";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function fieldRows(node: NodeDefinition): string {
  const byName = new Map<string, FieldOverride>();
  for (const name of Object.keys(node.defaults)) byName.set(name, { name });
  for (const extra of extras[node.type] ?? []) byName.set(extra.name, { ...byName.get(extra.name), ...extra });
  if (node.type === "navigate" && !byName.has("timeoutMs")) byName.set("timeoutMs", { name: "timeoutMs" });
  const rows = [...byName.values()].map(field => {
    const value = node.defaults[field.name];
    const defaultValue = Object.prototype.hasOwnProperty.call(node.defaults, field.name) ? `\`${compact(value)}\`` : "—";
    const values = field.options ?? options[`${node.type}.${field.name}`];
    const details = [field.description ?? fieldDescriptions[field.name] ?? `Configuration value for ${titleCase(field.name)}.`, values ? `Values: ${values.map(item => `\`${item}\``).join(", ")}.` : "", field.shownWhen ? `Shown when ${field.shownWhen}.` : ""].filter(Boolean).join(" ");
    return `| \`${field.name}\` | ${field.type ?? typeOf(value, field.name)} | ${defaultValue} | ${details} |`;
  });
  return ["| Field | Type | Default | What it controls |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

function compact(value: unknown): string {
  if (typeof value === "string") return value === "" ? '""' : JSON.stringify(value);
  return JSON.stringify(value);
}

function portRows(ports: NodeDefinition["inputs"] | NodeDefinition["outputs"]): string {
  if (ports.length === 0) return "This node has no typed ports in this direction.";
  return [
    "| Port | Type | Required | Description |",
    "| --- | --- | --- | --- |",
    ...ports.map(port => `| \`${port.key}\` | \`${port.type}\` | ${port.required ? "Yes" : "No"} | ${port.label} |`),
  ].join("\n");
}

function exampleNode(node: NodeDefinition): string {
  return JSON.stringify({ type: node.type, version: 1, configuration: node.defaults }, null, 2);
}

function renderNode(node: NodeDefinition): string {
  const notes = nodeNotes[node.type] ?? [];
  const placementNames: Record<string, string> = { local: "Desktop local runner", paired_runner: "Paired self-hosted runner", hosted_runner: "Hosted runner", managed_browser: "Managed browser worker" };
  return `---
title: "${node.name}"
description: "${node.description}. Exact configuration, ports, placement, and execution behavior."
icon: "${categoryIcons[node.group] ?? "blocks"}"
---

**Node type:** \`${node.type}\` · **Version:** \`1\` · **Category:** ${node.group}

${node.description}. ${node.sideEffect ? "This node can change external state or produce an external side effect." : "This node does not declare an external side effect."}

## Configuration

${fieldRows(node)}

${notes.map(note => `<Note>${note}</Note>`).join("\n\n")}

## Workflow JSON

The editor stores this node with the following implemented default configuration:

\`\`\`json title="Default node configuration"
${exampleNode(node)}
\`\`\`

Values may be entered literally or mapped from an earlier compatible output when the inspector exposes a mapping control. See [Variables and data mapping](/workflows/variables-and-data).

## Inputs

${portRows(node.inputs)}

## Outputs

${portRows(node.outputs)}

## Where it can run

${node.placements.map(placement => `- ${placementNames[placement] ?? placement}`).join("\n")}

## Test and inspect

Use **Test node** in the editor to preview this step with the current configuration. A full run records resolved inputs, outputs, logs, duration, and any artifacts in the execution inspector. Side-effecting or destructive nodes can require an additional confirmation or approved workflow permission.
`;
}

function renderIndex(): string {
  const groups = categoryOrder.map(category => {
    const nodes = NODE_DEFINITIONS.filter(node => node.group === category);
    return `## ${category}\n\n${nodes.map(node => `<Card title="${node.name}" icon="${categoryIcons[category]}" href="/nodes/${slug(node.type)}">\n  ${node.description}.\n</Card>`).join("\n")}`;
  });
  return `---
title: "Built-in nodes"
description: "Every node currently implemented in sndbox, generated from the product catalogue."
icon: "blocks"
---

sndbox currently implements **${NODE_DEFINITIONS.length} built-in nodes** across triggers, logic, data, network, browser, communication, and system automation. These pages are generated from \`src/catalogue.ts\`; names, type IDs, defaults, typed ports, side-effect flags, and supported placements are not hand-copied.

<Tip>
  Start with a trigger, connect compatible ports, and map outputs into later node fields. The node inspector only shows settings implemented by that node.
</Tip>

${groups.join("\n\n")}
`;
}

rmSync(nodesRoot, { recursive: true, force: true });
mkdirSync(nodesRoot, { recursive: true });
mkdirSync(apiRoot, { recursive: true });
writeFileSync(resolve(nodesRoot, "index.mdx"), renderIndex());
for (const node of NODE_DEFINITIONS) writeFileSync(resolve(nodesRoot, `${slug(node.type)}.mdx`), renderNode(node));
copyFileSync(resolve(repositoryRoot, "docs/api/openapi-v1.json"), resolve(apiRoot, "openapi.json"));
console.log(`Generated ${NODE_DEFINITIONS.length} Mintlify node pages and copied the OpenAPI document.`);
