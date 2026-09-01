import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signDirectory } from "../packages/plugin-sdk/dist/package.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateKey = process.argv[2];
const publicKey = process.argv[3];
if (!privateKey || !publicKey) throw new Error("Usage: node scripts/generate-first-party-plugins.mjs <private-key.pem> <public-key.pem>");
const signingKeyId = "first-party-2026-0.7.3-beta.1";

const guest = path.join(repository, "plugins/first-party/guest/target/wasm32-unknown-unknown/release/sndbox_first_party_integration_guest.wasm");
const outputRoot = path.join(repository, "plugins/first-party");
const dist = path.join(outputRoot, "dist");
await mkdir(dist, { recursive: true });

const text = (title, options = {}) => ({ type: "string", title, ...options });
const integer = (title, options = {}) => ({ type: "integer", title, ...options });
const bool = (title, value = false) => ({ type: "boolean", title, default: value });
const strings = (title) => ({ type: "array", title, items: { type: "string" }, default: [] });
const object = (title, value = {}) => ({ type: "object", title, default: value, additionalProperties: true });

function definition(provider, spec) {
  const properties = { connectionId: text("Connection", { format: "connection", "x-sndbox-provider": provider }), ...spec.properties };
  const required = ["connectionId", ...(spec.required ?? [])];
  return {
    nodeType: spec.type,
    nodeVersion: 1,
    displayName: spec.name,
    description: spec.description,
    category: spec.kind === "polling_trigger" ? "Triggers" : spec.category,
    riskLevel: spec.effect === "destructive_or_high_impact" ? "critical" : spec.effect === "external_write" ? "medium" : "low",
    inputSchema: { type: "object", additionalProperties: true },
    outputSchema: { type: "object", additionalProperties: true },
    configurationSchema: { type: "object", properties, required, additionalProperties: false },
    credentialRequirements: [provider],
    capabilities: [`credential_operations:${provider}`, "structured_logging", ...(spec.effect !== "read" ? ["external_communication"] : []), ...(spec.file ? ["file_picker_read"] : [])],
    timeoutMs: spec.file ? 120000 : 30000,
    retryBehavior: spec.effect === "read" ? "safe" : "idempotency_required",
    idempotencySupport: spec.effect === "read" ? "read_only" : "keyed",
    documentation: `docs/${spec.type}.md`,
    migrationHandlers: [],
    executionEntrypoint: "main",
    kind: spec.kind ?? "action",
    inputPorts: spec.inputPorts ?? [{ key: "input", label: "Input", type: "object" }],
    outputPorts: spec.outputPorts ?? [{ key: "result", label: "Result", type: "object" }],
    connectionRequirements: [{ reference: "connection", provider, permissions: spec.permissions, required: true }],
    fileInputs: spec.file ? [{ key: spec.file, required: true, maximumBytes: 1024 * 1024 * 1024, acceptedMimeTypes: ["*/*"] }] : [],
    placements: ["desktop", "self_hosted"],
    externalEffect: spec.effect
  };
}

const polling = { pollIntervalSeconds: integer("Poll interval (seconds)", { minimum: 60, maximum: 300, default: 120 }) };
const repo = { repository: text("Repository", { description: "owner/repository" }) };

const plugins = [
  {
    slug: "google-workspace", id: "com.sndbox.google-workspace", name: "Google Workspace", provider: "google_workspace",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"],
    nodes: [
      { type: "google.calendar.event_changed", name: "Calendar Event Changed", description: "Starts when a calendar event is created or updated.", kind: "polling_trigger", effect: "read", permissions: ["calendar.read"], properties: { calendarId: text("Calendar", { default: "primary" }), ...polling }, outputPorts: [{ key: "event", label: "Event", type: "object" }] },
      { type: "google.drive.file_changed", name: "Drive File Changed", description: "Starts when a Drive file changes.", kind: "polling_trigger", effect: "read", permissions: ["drive.read"], properties: { driveId: text("Shared drive ID"), query: text("Filter query"), ...polling }, outputPorts: [{ key: "file", label: "File", type: "object" }] },
      { type: "google.sheets.row_added", name: "Sheets Row Added", description: "Starts when rows are appended to a sheet.", kind: "polling_trigger", effect: "read", permissions: ["sheets.read"], properties: { spreadsheetId: text("Spreadsheet ID"), range: text("Range", { default: "Sheet1!A:Z" }), headerRow: integer("Header row", { minimum: 1, default: 1 }), ...polling }, required: ["spreadsheetId", "range"], outputPorts: [{ key: "row", label: "Row", type: "object" }] },
      { type: "google.calendar.list_events", name: "List Calendar Events", description: "Lists events in a time window.", effect: "read", category: "Productivity", permissions: ["calendar.read"], properties: { calendarId: text("Calendar", { default: "primary" }), timeMin: text("Starts after", { format: "date-time" }), timeMax: text("Ends before", { format: "date-time" }), query: text("Search") } },
      { type: "google.calendar.create_event", name: "Create Calendar Event", description: "Creates a calendar event.", effect: "external_write", category: "Productivity", permissions: ["calendar.write"], properties: { calendarId: text("Calendar", { default: "primary" }), summary: text("Title"), description: text("Description"), start: text("Start", { format: "date-time" }), end: text("End", { format: "date-time" }), timeZone: text("Time zone"), attendees: strings("Attendees") }, required: ["summary", "start", "end"] },
      { type: "google.calendar.update_event", name: "Update Calendar Event", description: "Updates selected event fields.", effect: "external_write", category: "Productivity", permissions: ["calendar.write"], properties: { calendarId: text("Calendar", { default: "primary" }), eventId: text("Event ID"), summary: text("Title"), description: text("Description"), start: text("Start", { format: "date-time" }), end: text("End", { format: "date-time" }), timeZone: text("Time zone"), attendees: strings("Attendees") }, required: ["eventId"] },
      { type: "google.drive.search_files", name: "Search Drive Files", description: "Searches files visible to the connection.", effect: "read", category: "Data", permissions: ["drive.read"], properties: { query: text("Drive query"), driveId: text("Shared drive ID"), pageSize: integer("Maximum results", { minimum: 1, maximum: 1000, default: 100 }) }, required: ["query"] },
      { type: "google.drive.upload_file", name: "Upload Drive File", description: "Streams a granted local file to Drive.", effect: "external_write", category: "Data", permissions: ["drive.write"], properties: { fileGrant: text("File", { format: "file-grant" }), name: text("Drive filename"), parentFolderId: text("Parent folder ID"), mimeType: text("MIME type") }, required: ["fileGrant"], file: "fileGrant" },
      { type: "google.sheets.read_range", name: "Read Sheet Range", description: "Reads values from a spreadsheet range.", effect: "read", category: "Data", permissions: ["sheets.read"], properties: { spreadsheetId: text("Spreadsheet ID"), range: text("Range"), majorDimension: text("Major dimension", { enum: ["ROWS", "COLUMNS"], default: "ROWS" }) }, required: ["spreadsheetId", "range"] },
      { type: "google.sheets.append_rows", name: "Append Sheet Rows", description: "Appends rows to a spreadsheet.", effect: "external_write", category: "Data", permissions: ["sheets.write"], properties: { spreadsheetId: text("Spreadsheet ID"), range: text("Range"), rows: { type: "array", title: "Rows", items: { type: "array", items: {} }, default: [] }, valueInputOption: text("Value input", { enum: ["RAW", "USER_ENTERED"], default: "USER_ENTERED" }) }, required: ["spreadsheetId", "range", "rows"] },
      { type: "google.sheets.update_range", name: "Update Sheet Range", description: "Replaces values in a spreadsheet range.", effect: "external_write", category: "Data", permissions: ["sheets.write"], properties: { spreadsheetId: text("Spreadsheet ID"), range: text("Range"), values: { type: "array", title: "Values", items: { type: "array", items: {} }, default: [] }, valueInputOption: text("Value input", { enum: ["RAW", "USER_ENTERED"], default: "USER_ENTERED" }) }, required: ["spreadsheetId", "range", "values"] }
    ]
  },
  {
    slug: "slack", id: "com.sndbox.slack", name: "Slack", provider: "slack_oauth",
    scopes: ["channels:history", "channels:read", "chat:write", "reactions:write", "files:write", "users:read"],
    nodes: [
      { type: "slack.channel_message_posted", name: "Slack Message Posted", description: "Starts when a channel receives a new message.", kind: "polling_trigger", effect: "read", permissions: ["messages.read"], properties: { channelId: text("Channel"), includeBotMessages: bool("Include bot messages"), includeThreadReplies: bool("Include thread replies"), ...polling }, required: ["channelId"], outputPorts: [{ key: "message", label: "Message", type: "object" }] },
      { type: "slack.list_channel_messages", name: "List Slack Messages", description: "Lists recent messages in a channel.", effect: "read", category: "Communication", permissions: ["messages.read"], properties: { channelId: text("Channel"), oldest: text("Oldest timestamp"), latest: text("Latest timestamp"), limit: integer("Maximum results", { minimum: 1, maximum: 100, default: 15 }) }, required: ["channelId"] },
      { type: "slack.send_message", name: "Send Slack Message", description: "Posts a message to a channel.", effect: "external_write", category: "Communication", permissions: ["messages.write"], properties: { channelId: text("Channel"), text: text("Message"), blocks: object("Blocks") }, required: ["channelId", "text"] },
      { type: "slack.reply_to_thread", name: "Reply to Slack Thread", description: "Replies inside an existing message thread.", effect: "external_write", category: "Communication", permissions: ["messages.write"], properties: { channelId: text("Channel"), threadTs: text("Thread timestamp"), text: text("Message"), blocks: object("Blocks") }, required: ["channelId", "threadTs", "text"] },
      { type: "slack.add_reaction", name: "Add Slack Reaction", description: "Adds an emoji reaction to a message.", effect: "external_write", category: "Communication", permissions: ["reactions.write"], properties: { channelId: text("Channel"), timestamp: text("Message timestamp"), emoji: text("Emoji name") }, required: ["channelId", "timestamp", "emoji"] },
      { type: "slack.upload_file", name: "Upload Slack File", description: "Streams a granted local file using Slack external upload.", effect: "external_write", category: "Communication", permissions: ["files.write"], properties: { channelId: text("Channel"), fileGrant: text("File", { format: "file-grant" }), filename: text("Filename"), title: text("Title"), initialComment: text("Initial comment"), threadTs: text("Thread timestamp") }, required: ["channelId", "fileGrant"], file: "fileGrant" }
    ]
  },
  {
    slug: "notion", id: "com.sndbox.notion", name: "Notion", provider: "notion", scopes: ["read_content", "update_content", "insert_content"],
    nodes: [
      { type: "notion.data_source_page_changed", name: "Notion Page Changed", description: "Starts when a page in a data source changes.", kind: "polling_trigger", effect: "read", permissions: ["content.read"], properties: { dataSourceId: text("Data source ID"), filter: object("Filter"), ...polling }, required: ["dataSourceId"], outputPorts: [{ key: "page", label: "Page", type: "object" }] },
      { type: "notion.query_data_source", name: "Query Notion Data Source", description: "Queries pages in a Notion data source.", effect: "read", category: "Data", permissions: ["content.read"], properties: { dataSourceId: text("Data source ID"), filter: object("Filter"), sorts: { type: "array", title: "Sorts", items: { type: "object" }, default: [] }, pageSize: integer("Maximum results", { minimum: 1, maximum: 100, default: 100 }) }, required: ["dataSourceId"] },
      { type: "notion.get_page", name: "Get Notion Page", description: "Gets a page and its properties.", effect: "read", category: "Data", permissions: ["content.read"], properties: { pageId: text("Page ID") }, required: ["pageId"] },
      { type: "notion.create_page", name: "Create Notion Page", description: "Creates a page in a data source or under a page.", effect: "external_write", category: "Data", permissions: ["content.insert"], properties: { parentId: text("Parent page or data source ID"), parentType: text("Parent type", { enum: ["page_id", "data_source_id"], default: "data_source_id" }), properties: object("Properties"), children: { type: "array", title: "Content blocks", items: { type: "object" }, default: [] } }, required: ["parentId", "properties"] },
      { type: "notion.update_page", name: "Update Notion Page", description: "Updates page properties or archive state.", effect: "external_write", category: "Data", permissions: ["content.update"], properties: { pageId: text("Page ID"), properties: object("Properties"), archived: bool("Archived") }, required: ["pageId"] }
    ]
  },
  {
    slug: "github", id: "com.sndbox.github", name: "GitHub", provider: "github_app",
    scopes: ["metadata:read", "issues:write", "pull_requests:write", "actions:write", "contents:write"],
    nodes: [
      { type: "github.issue_or_pull_request_changed", name: "Issue or Pull Request Changed", description: "Starts when an issue or pull request snapshot changes.", kind: "polling_trigger", effect: "read", permissions: ["issues.read", "pull_requests.read"], properties: { ...repo, recordType: text("Record type", { enum: ["issue", "pull_request", "both"], default: "both" }), state: text("State", { enum: ["open", "closed", "all"], default: "all" }), labels: strings("Labels"), actors: strings("Actors"), ...polling }, required: ["repository"], outputPorts: [{ key: "record", label: "Issue or pull request", type: "object" }] },
      { type: "github.workflow_run_completed", name: "Workflow Run Completed", description: "Starts when a GitHub Actions run completes.", kind: "polling_trigger", effect: "read", permissions: ["actions.read"], properties: { ...repo, workflow: text("Workflow ID or filename"), branch: text("Branch"), event: text("Event"), conclusions: strings("Conclusions"), pollIntervalSeconds: integer("Poll interval (seconds)", { minimum: 60, maximum: 300, default: 90 }) }, required: ["repository"], outputPorts: [{ key: "run", label: "Workflow run", type: "object" }] },
      { type: "github.get_issue_or_pull_request", name: "Get Issue or Pull Request", description: "Gets a normalized issue or pull request.", effect: "read", category: "Developer Tools", permissions: ["issues.read", "pull_requests.read"], properties: { ...repo, number: integer("Number", { minimum: 1 }) }, required: ["repository", "number"] },
      { type: "github.create_issue", name: "Create GitHub Issue", description: "Creates an issue.", effect: "external_write", category: "Developer Tools", permissions: ["issues.write"], properties: { ...repo, title: text("Title"), body: text("Body"), assignees: strings("Assignees"), labels: strings("Labels"), milestone: integer("Milestone number", { minimum: 1 }) }, required: ["repository", "title"] },
      { type: "github.update_issue", name: "Update GitHub Issue", description: "Updates selected issue fields.", effect: "external_write", category: "Developer Tools", permissions: ["issues.write"], properties: { ...repo, number: integer("Issue number", { minimum: 1 }), title: text("Title"), body: text("Body"), state: text("State", { enum: ["open", "closed"] }), stateReason: text("State reason", { enum: ["completed", "not_planned", "reopened"] }), assignees: strings("Assignees"), labels: strings("Labels"), milestone: integer("Milestone number", { minimum: 1 }) }, required: ["repository", "number"] },
      { type: "github.add_comment", name: "Add GitHub Comment", description: "Adds a Markdown comment to an issue or pull request.", effect: "external_write", category: "Developer Tools", permissions: ["issues.write"], properties: { ...repo, number: integer("Issue or PR number", { minimum: 1 }), body: text("Comment") }, required: ["repository", "number", "body"] },
      { type: "github.create_pull_request", name: "Create Pull Request", description: "Creates a pull request.", effect: "external_write", category: "Developer Tools", permissions: ["pull_requests.write"], properties: { ...repo, head: text("Head branch"), base: text("Base branch"), title: text("Title"), body: text("Body"), draft: bool("Draft"), maintainerCanModify: bool("Maintainers can modify", true) }, required: ["repository", "head", "base", "title"] },
      { type: "github.update_pull_request", name: "Update Pull Request", description: "Updates selected pull-request fields.", effect: "external_write", category: "Developer Tools", permissions: ["pull_requests.write"], properties: { ...repo, number: integer("Pull request number", { minimum: 1 }), title: text("Title"), body: text("Body"), state: text("State", { enum: ["open", "closed"] }), base: text("Base branch"), maintainerCanModify: bool("Maintainers can modify", true) }, required: ["repository", "number"] },
      { type: "github.request_reviewers", name: "Request Pull Request Reviewers", description: "Requests reviews from users or teams and sends GitHub notifications.", effect: "external_write", category: "Developer Tools", permissions: ["pull_requests.write"], properties: { ...repo, number: integer("Pull request number", { minimum: 1 }), reviewers: strings("User reviewers"), teamReviewers: strings("Team reviewers") }, required: ["repository", "number"] },
      { type: "github.merge_pull_request", name: "Merge Pull Request", description: "Merges a pull request only when its expected head SHA still matches.", effect: "destructive_or_high_impact", category: "Developer Tools", permissions: ["contents.write", "pull_requests.write"], properties: { ...repo, number: integer("Pull request number", { minimum: 1 }), expectedHeadSha: text("Expected head SHA", { minLength: 7 }), mergeMethod: text("Merge method", { enum: ["merge", "squash", "rebase"], default: "squash" }), commitTitle: text("Commit title"), commitMessage: text("Commit message") }, required: ["repository", "number", "expectedHeadSha"] },
      { type: "github.get_workflow_run", name: "Get Workflow Run", description: "Gets a GitHub Actions workflow run.", effect: "read", category: "Developer Tools", permissions: ["actions.read"], properties: { ...repo, runId: integer("Run ID", { minimum: 1 }) }, required: ["repository", "runId"] },
      { type: "github.dispatch_workflow", name: "Dispatch GitHub Workflow", description: "Dispatches a workflow and reports acceptance without inventing a run ID.", effect: "external_write", category: "Developer Tools", permissions: ["actions.write"], properties: { ...repo, workflow: text("Workflow ID or filename"), ref: text("Git ref"), inputs: object("Workflow inputs") }, required: ["repository", "workflow", "ref"] },
      { type: "github.cancel_workflow_run", name: "Cancel Workflow Run", description: "Cancels a queued or in-progress GitHub Actions run.", effect: "external_write", category: "Developer Tools", permissions: ["actions.write"], properties: { ...repo, runId: integer("Run ID", { minimum: 1 }) }, required: ["repository", "runId"] }
    ]
  }
];

const registry = [];
for (const plugin of plugins) {
  const root = path.join(outputRoot, plugin.slug);
  await mkdir(path.join(root, "components"), { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await copyFile(guest, path.join(root, "components/main.wasm"));
  await writeFile(path.join(root, "assets/icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#18181b"/><path d="M16 32h32M32 16v32" stroke="#fafafa" stroke-width="5" stroke-linecap="round"/></svg>\n`);
  const nodes = plugin.nodes.map(spec => definition(plugin.provider, spec));
  for (const node of nodes) await writeFile(path.join(root, node.documentation), `# ${node.displayName}\n\n${node.description}\n`);
  const operations = nodes.map(node => node.nodeType);
  const capabilities = [
    { type: "structured_logging" },
    { type: "credential_operations", credentialType: plugin.provider, operations },
    ...(nodes.some(node => node.externalEffect !== "read") ? [{ type: "external_communication" }] : []),
    ...(nodes.some(node => node.fileInputs.length) ? [{ type: "file_picker_read", maxBytes: 1024 * 1024 * 1024 }] : [])
  ];
  const manifest = {
    manifestVersion: 2,
    pluginId: plugin.id,
    name: plugin.name,
    description: `First-party ${plugin.name} workflow integration.`,
    version: "1.0.0",
    publisherId: "com.sndbox",
    minimumHostVersion: ">=0.7.3-beta.1",
    homepage: "https://sndbox.dev/integrations",
    documentation: "https://docs.sndbox.dev/integrations",
    supportUrl: "https://sndbox.dev/support",
    licence: "Proprietary",
    categories: ["productivity", "first-party"],
    keywords: [plugin.slug, "automation"],
    icon: "assets/icon.svg",
    nodes,
    credentials: [{ credentialType: plugin.provider, displayName: `${plugin.name} connection`, operations, scopes: plugin.scopes, configurationSchema: { type: "object", additionalProperties: false } }],
    capabilities,
    networkDomains: [],
    storageRequirements: { temporaryBytes: 0, persistentBytes: 0, isolateByMajorVersion: false },
    migrations: [],
    entrypoints: [{ id: "main", path: "components/main.wasm", export: "execute" }],
    packageIntegrity: "",
    signature: { algorithm: "ed25519", keyId: signingKeyId, value: "" },
    pricing: { model: "free" },
    privacyPolicy: "https://sndbox.dev/privacy"
  };
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const output = path.join(dist, `${plugin.id}-1.0.0.sandbox-plugin`);
  const signed = await signDirectory(root, privateKey, signingKeyId, output);
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify(signed.manifest, null, 2)}\n`);
  registry.push({ manifest: signed.manifest, packageFile: path.relative(repository, output).split(path.sep).join("/") });
}
await writeFile(path.join(outputRoot, "registry.json"), `${JSON.stringify({ publisherId: "com.sndbox", keyId: signingKeyId, publicKeyPem: await readFile(publicKey, "utf8"), plugins: registry }, null, 2)}\n`);
console.log(`Generated and signed ${registry.length} first-party packages with ${registry.reduce((sum, item) => sum + item.manifest.nodes.length, 0)} nodes.`);
