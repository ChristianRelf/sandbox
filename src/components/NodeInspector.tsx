import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, FolderOpen, LocateFixed, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { definitionFor } from "../catalogue";
import type { BrowserProfile, StructuredLocator, Workflow, WorkflowNode } from "../types";

const locatorKinds = ["role", "label", "placeholder", "test_id", "text", "attribute", "css", "xpath"] as const;

export function NodeInspector({ workflow, node, onChange, onDelete }: {
  workflow: Workflow;
  node: WorkflowNode;
  onChange: (node: WorkflowNode, workflowPatch?: Partial<Workflow>) => void;
  onDelete: () => void;
}) {
  const definition = definitionFor(node.type);
  const Icon = definition.icon;
  const config = node.configuration;
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const set = (key: string, value: unknown) => onChange({ ...node, configuration: { ...config, [key]: value } });
  useEffect(() => { if (definition.group === "Browser") void api.listBrowserProfiles().then(setProfiles); }, [definition.group]);

  const approvePath = (value: string) => {
    const folder = value.replace(/[\\/][^\\/]+$/, "");
    const approved = [...new Set([...workflow.settings.permissions.approvedFolders, folder || value])];
    return { settings: { ...workflow.settings, permissions: { ...workflow.settings.permissions, approvedFolders: approved } } };
  };
  const chooseFolder = async (key: string) => {
    if (!api.isDesktop) return;
    const selected = await open({ directory: true, multiple: false, title: "Approve a folder for this workflow" });
    if (typeof selected === "string") onChange({ ...node, configuration: { ...config, [key]: selected } }, approvePath(selected));
  };
  const chooseFile = async (key: string) => {
    if (!api.isDesktop) return;
    const selected = await open({ directory: false, multiple: false, title: "Choose and approve a file" });
    if (typeof selected === "string") onChange({ ...node, configuration: { ...config, [key]: selected } }, approvePath(selected));
  };
  const mapping = (key: string, label: string, options?: { multiline?: boolean; sensitive?: boolean }) => <MappedInput label={label} value={String(config[key] ?? "")} workflow={workflow} currentNodeId={node.id} multiline={options?.multiline} sensitive={options?.sensitive} onChange={value => set(key, value)} />;

  return <aside className="inspector">
    <div className="inspector-title"><span className="node-icon"><Icon size={15} /></span><div><b>{node.name}</b><small>{definition.group}</small></div></div>
    <div className="inspector-scroll">
      <Field label="Name"><input value={node.name} onChange={event => onChange({ ...node, name: event.target.value })} /></Field>

      {node.type === "schedule_trigger" && <>
        <Field label="Schedule"><select value={String(config.scheduleType ?? "minutes")} onChange={event => set("scheduleType", event.target.value)}><option value="minutes">Every X minutes</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="cron">Advanced cron</option></select></Field>
        {config.scheduleType === "minutes" && <Field label="Every"><div className="input-unit"><input type="number" min="1" value={Number(config.every ?? 15)} onChange={event => set("every", Number(event.target.value))} /><span>minutes</span></div></Field>}
        {config.scheduleType === "daily" && <Field label="Time"><input type="time" value={String(config.time ?? "09:00")} onChange={event => set("time", event.target.value)} /></Field>}
        {config.scheduleType === "cron" && <Field label="Cron expression" hint="Five or six fields"><input value={String(config.cron ?? "")} onChange={event => set("cron", event.target.value)} /></Field>}
        <Info>Next runs are calculated by the local runner. Quitting Sandbox stops schedules.</Info>
      </>}

      {node.type === "file_watch_trigger" && <>
        <Field label="Folder"><FolderInput value={String(config.folder ?? "")} onChoose={() => chooseFolder("folder")} /></Field>
        <Field label="Filename pattern" hint="Optional glob, e.g. *.pdf"><input value={String(config.pattern ?? "")} onChange={event => set("pattern", event.target.value)} /></Field>
        <Field label="Events"><div className="checks">{["created", "modified", "deleted"].map(kind => <label key={kind}><input type="checkbox" checked={((config.events as string[]) ?? []).includes(kind)} onChange={event => set("events", event.target.checked ? [...new Set([...((config.events as string[]) ?? []), kind])] : ((config.events as string[]) ?? []).filter(value => value !== kind))} />{kind}</label>)}</div></Field>
      </>}

      {node.type === "condition" && <>
        {mapping("left", "Value")}
        <Field label="Operator"><select value={String(config.operator ?? "equals")} onChange={event => set("operator", event.target.value)}>{["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "exists", "not_exists", "starts_with", "ends_with"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></Field>
        {!['exists', 'not_exists'].includes(String(config.operator)) && <Field label="Compare with"><input value={scalar(config.right)} onChange={event => set("right", parseScalar(event.target.value))} /></Field>}
      </>}
      {node.type === "set_data" && <JsonField label="Object" value={config.values ?? {}} onChange={value => set("values", value)} />}
      {node.type === "delay" && <><Field label="Duration"><input type="number" min="0" step="0.1" value={Number(config.amount ?? 1)} onChange={event => set("amount", Number(event.target.value))} /></Field><Field label="Unit"><select value={String(config.unit ?? "seconds")} onChange={event => set("unit", event.target.value)}><option value="seconds">Seconds</option><option value="minutes">Minutes</option></select></Field></>}

      {node.type === "http_request" && <>
        <Field label="Method"><select value={String(config.method ?? "GET")} onChange={event => set("method", event.target.value)}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map(value => <option key={value}>{value}</option>)}</select></Field>
        {mapping("url", "URL")}
        <JsonField label="Headers" value={config.headers ?? {}} onChange={value => set("headers", value)} />
        <JsonField label="Query parameters" value={config.query ?? {}} onChange={value => set("query", value)} />
        {!['GET', 'DELETE'].includes(String(config.method)) && <JsonField label="JSON body" value={config.body ?? {}} onChange={value => set("body", value)} />}
        <TimeoutAndRetry config={config} set={set} />
        <Info>Authorization and cookie values are redacted from execution data.</Info>
      </>}

      {node.type === "open_browser" && <>
        <Field label="Browser profile"><select value={String(config.profileId ?? "")} onChange={event => set("profileId", event.target.value)}><option value="">Select managed profile…</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field>
        {profiles.length === 0 && <Info>Create an isolated profile in Settings before running this node.</Info>}
        {mapping("initialUrl", "Initial URL")}
        <div className="field-grid"><Field label="Viewport width"><input type="number" min="320" max="3840" value={Number((config.viewport as { width?: number })?.width ?? 1280)} onChange={event => set("viewport", { ...(config.viewport as object), width: Number(event.target.value) })} /></Field><Field label="Viewport height"><input type="number" min="240" max="2160" value={Number((config.viewport as { height?: number })?.height ?? 800)} onChange={event => set("viewport", { ...(config.viewport as object), height: Number(event.target.value) })} /></Field></div>
        <Field label="Default timeout (ms)"><input type="number" min="100" max="120000" value={Number(config.defaultTimeoutMs ?? 30000)} onChange={event => set("defaultTimeoutMs", Number(event.target.value))} /></Field>
        <label className="toggle-row"><span><b>Headed during manual runs</b><small>Scheduled runs default to headless.</small></span><input type="checkbox" checked={config.headed !== false} onChange={event => set("headed", event.target.checked)} /></label>
        <label className="toggle-row"><span><b>Close automatically</b><small>Sessions are cleaned up after success or failure.</small></span><input type="checkbox" checked={config.closeAutomatically !== false} onChange={event => set("closeAutomatically", event.target.checked)} /></label>
      </>}

      {node.type === "navigate" && <>
        {mapping("url", "URL")}
        <Field label="Wait condition"><select value={String(config.waitCondition ?? "dom_ready")} onChange={event => set("waitCondition", event.target.value)}><option value="dom_ready">DOM ready</option><option value="page_loaded">Page loaded</option><option value="network_idle">Network idle</option><option value="element_visible">Specific element visible</option></select></Field>
        {config.waitCondition === "element_visible" && <LocatorEditor value={config.locator} onChange={value => set("locator", value)} />}
        <TimeoutField config={config} set={set} />
      </>}

      {node.type === "click_element" && <>
        <LocatorEditor value={config.locator} onChange={value => set("locator", value)} />
        <div className="field-grid"><Field label="Click type"><select value={String(config.clickType ?? "normal")} onChange={event => set("clickType", event.target.value)}><option value="normal">Normal</option><option value="double">Double</option><option value="right">Right</option></select></Field><Field label="Mouse button"><select value={String(config.mouseButton ?? "left")} onChange={event => set("mouseButton", event.target.value)}><option>left</option><option>middle</option><option>right</option></select></Field></div>
        <Field label="Wait after click (ms)"><input type="number" min="0" max="120000" value={Number(config.waitAfterMs ?? 0)} onChange={event => set("waitAfterMs", Number(event.target.value))} /></Field><TimeoutField config={config} set={set} />
      </>}

      {node.type === "fill_field" && <>
        <LocatorEditor value={config.locator} onChange={value => set("locator", value)} />
        {mapping("value", config.sensitive ? "Protected value reference" : "Value", { sensitive: Boolean(config.sensitive) })}
        <Field label="Input delay (ms)"><input type="number" min="0" max="2000" value={Number(config.inputDelayMs ?? 0)} onChange={event => set("inputDelayMs", Number(event.target.value))} /></Field>
        <label className="toggle-row"><span><b>Clear existing value</b></span><input type="checkbox" checked={config.clearExisting !== false} onChange={event => set("clearExisting", event.target.checked)} /></label>
        <label className="toggle-row"><span><b>Sensitive value</b><small>Redacts logs and masks failure screenshots.</small></span><input type="checkbox" checked={Boolean(config.sensitive)} onChange={event => set("sensitive", event.target.checked)} /></label><TimeoutField config={config} set={set} />
      </>}

      {node.type === "select_option" && <><LocatorEditor value={config.locator} onChange={value => set("locator", value)} /><Field label="Select by"><select value={String(config.selectBy ?? "value")} onChange={event => set("selectBy", event.target.value)}><option value="value">Value</option><option value="label">Visible label</option><option value="index">Index</option></select></Field>{mapping("option", "Option")}<TimeoutField config={config} set={set} /></>}
      {node.type === "press_key" && <><Field label="Key combination" hint="Examples: Enter, Control+K, Shift+Tab"><input value={String(config.key ?? "Enter")} onChange={event => set("key", event.target.value)} /></Field><TimeoutField config={config} set={set} /></>}

      {node.type === "wait_for" && <>
        <Field label="Wait for"><select value={String(config.waitFor ?? "element_visible")} onChange={event => set("waitFor", event.target.value)}><option value="time">Time delay</option><option value="element_visible">Element visible</option><option value="element_hidden">Element hidden</option><option value="text_present">Text present</option><option value="url_matches">URL matches</option><option value="download_begins">Download begins</option><option value="network_response">Network response</option><option value="page_load_state">Page load state</option></select></Field>
        {config.waitFor === "time" && <Field label="Delay (ms)"><input type="number" min="0" value={Number(config.delayMs ?? 1000)} onChange={event => set("delayMs", Number(event.target.value))} /></Field>}
        {["element_visible", "element_hidden"].includes(String(config.waitFor)) && <LocatorEditor value={config.locator} onChange={value => set("locator", value)} />}
        {config.waitFor === "text_present" && mapping("text", "Text")}
        {["url_matches", "network_response"].includes(String(config.waitFor)) && mapping("urlPattern", "URL pattern")}
        {config.waitFor === "page_load_state" && <Field label="Load state"><select value={String(config.loadState ?? "dom_ready")} onChange={event => set("loadState", event.target.value)}><option value="dom_ready">DOM ready</option><option value="page_loaded">Page loaded</option><option value="network_idle">Network idle</option></select></Field>}
        <TimeoutField config={config} set={set} />
      </>}

      {node.type === "extract_data" && <>
        <LocatorEditor value={config.locator} onChange={value => set("locator", value)} />
        <Field label="Extract"><select value={String(config.extract ?? "text")} onChange={event => set("extract", event.target.value)}><option value="text">Text</option><option value="attribute">Attribute</option><option value="link">Link</option><option value="image_source">Image source</option><option value="table">Table</option></select></Field>
        {config.extract === "attribute" && <Field label="Attribute name"><input value={String(config.attribute ?? "")} onChange={event => set("attribute", event.target.value)} /></Field>}
        <Field label="Output field name"><input value={String(config.fieldName ?? "value")} onChange={event => set("fieldName", event.target.value)} /></Field>
        <label className="toggle-row"><span><b>Extract repeated list</b><small>Returns all unique matches as structured JSON.</small></span><input type="checkbox" checked={Boolean(config.repeated)} onChange={event => set("repeated", event.target.checked)} /></label>
        {config.extract === "table" && <JsonField label="Column names" value={config.fields ?? {}} onChange={value => set("fields", value)} />}
        <TimeoutField config={config} set={set} />
      </>}

      {node.type === "screenshot" && <><Field label="Capture"><select value={String(config.mode ?? "viewport")} onChange={event => set("mode", event.target.value)}><option value="viewport">Current viewport</option><option value="full_page">Full page</option><option value="element">Selected element</option></select></Field>{config.mode === "element" && <LocatorEditor value={config.locator} onChange={value => set("locator", value)} />}<label className="toggle-row"><span><b>Include in execution history</b><small>Stored according to screenshot retention.</small></span><input type="checkbox" checked={config.includeInHistory !== false} onChange={event => set("includeInHistory", event.target.checked)} /></label><TimeoutField config={config} set={set} /></>}
      {node.type === "download_file" && <><LocatorEditor value={config.locator} onChange={value => set("locator", value)} /><Field label="Destination folder"><FolderInput value={String(config.destinationFolder ?? "")} onChoose={() => chooseFolder("destinationFolder")} /></Field>{mapping("filename", "Filename")}<Field label="Collision behaviour"><select value={String(config.collisionBehaviour ?? "rename")} onChange={event => set("collisionBehaviour", event.target.value)}><option value="rename">Create unique name</option><option value="overwrite">Overwrite</option><option value="fail">Fail</option></select></Field><Field label="Maximum size (MB)"><input type="number" min="1" max="2048" value={Math.round(Number(config.maximumBytes ?? 104857600) / 1048576)} onChange={event => set("maximumBytes", Number(event.target.value) * 1048576)} /></Field><TimeoutField config={config} set={set} /></>}
      {node.type === "upload_file" && <><LocatorEditor value={config.locator} onChange={value => set("locator", value)} /><Field label="Approved file"><div className="folder-input"><input value={String(config.file ?? "")} readOnly placeholder="Choose a local file" /><button type="button" onClick={() => chooseFile("file")} disabled={!api.isDesktop}><FolderOpen size={15} /></button></div></Field><Info>A file path from a previous trusted node may also be mapped here after the file is approved.</Info><TimeoutField config={config} set={set} /></>}
      {node.type === "close_browser" && <Info>Closes the inherited browser session deliberately. Remaining sessions are always cleaned up when the workflow ends.</Info>}

      {node.type === "desktop_notification" && <>{mapping("title", "Title")}{mapping("message", "Message", { multiline: true })}</>}
      {node.type === "move_file" && <>{mapping("source", "Source path")}<Field label="Destination folder"><FolderInput value={String(config.destinationFolder ?? "")} onChoose={() => chooseFolder("destinationFolder")} /></Field>{mapping("renameTo", "Rename to")}<label className="toggle-row"><span><b>Overwrite existing file</b></span><input type="checkbox" checked={Boolean(config.overwrite)} onChange={event => set("overwrite", event.target.checked)} /></label></>}
      {node.type === "run_command" && <><div className="risk-callout"><AlertTriangle size={16} /><div><b>High-risk capability</b><p>Automatic runs require explicit permission review. Executable and arguments are passed separately.</p></div></div><Field label="Executable"><input placeholder="C:\\Tools\\processor.exe" value={String(config.executable ?? "")} onChange={event => set("executable", event.target.value)} /></Field><Field label="Arguments" hint="One argument per line"><textarea rows={4} value={((config.arguments as string[]) ?? []).join("\n")} onChange={event => set("arguments", event.target.value.split("\n"))} /></Field><Field label="Working directory"><FolderInput value={String(config.workingDirectory ?? "")} onChoose={() => chooseFolder("workingDirectory")} /></Field></>}

      <label className="toggle-row"><span><b>Disable node</b><small>Keep it in the workflow without running it.</small></span><input type="checkbox" checked={node.disabled} onChange={event => onChange({ ...node, disabled: event.target.checked })} /></label>
    </div>
    <div className="inspector-footer"><button className="button danger-text" onClick={onDelete}><Trash2 size={14} />Delete node</button></div>
  </aside>;
}

function LocatorEditor({ value, onChange }: { value: unknown; onChange: (value: StructuredLocator) => void }) {
  const locator = normalizeLocator(value);
  const patchPrimary = (patch: Partial<StructuredLocator["primary"]>) => onChange({ ...locator, primary: { ...locator.primary, ...patch } });
  return <div className="locator-editor">
    <div className="locator-heading"><span><LocateFixed size={13} />Target element</span><em>Ranked locator</em></div>
    <div className="field-grid"><Field label="Strategy"><select value={locator.primary.kind} onChange={event => patchPrimary({ kind: event.target.value as StructuredLocator["primary"]["kind"] })}>{locatorKinds.map(kind => <option key={kind} value={kind}>{kind.replace("_", " ")}</option>)}</select></Field><Field label="Role / name"><input value={locator.primary.name ?? ""} onChange={event => patchPrimary({ name: event.target.value || undefined })} placeholder="Accessible name" /></Field></div>
    <Field label="Locator value"><input value={locator.primary.value} onChange={event => patchPrimary({ value: event.target.value })} placeholder="button, Email address, data-testid…" /></Field>
    <details><summary>Alternative locators ({locator.alternatives.length})</summary><JsonField label="Ranked alternatives" value={locator.alternatives} onChange={alternatives => onChange({ ...locator, alternatives: Array.isArray(alternatives) ? alternatives as StructuredLocator["alternatives"] : [] })} /></details>
    <small className="locator-note">Execution rejects ambiguous matches and records every attempted locator.</small>
  </div>;
}

function normalizeLocator(value: unknown): StructuredLocator {
  if (value && typeof value === "object" && "primary" in value) return value as StructuredLocator;
  return { primary: { kind: "role", value: "button", name: "" }, alternatives: [], tag: "*", stableAttributes: {}, framePath: [], recordingUrl: "" };
}

function MappedInput({ label, value, workflow, currentNodeId, multiline, sensitive, onChange }: { label: string; value: string; workflow: Workflow; currentNodeId: string; multiline?: boolean; sensitive?: boolean; onChange: (value: string) => void }) {
  const nodes = workflow.nodes.filter(node => node.id !== currentNodeId);
  const mapped = value.includes("{{") || value.startsWith("nodes.") || value.startsWith("trigger.");
  return <Field label={label} hint={mapped ? "Mapped safe reference" : "Static value or mapped output"}>
    <div className="mapped-field">{multiline ? <textarea rows={4} value={value} onChange={event => onChange(event.target.value)} /> : <input type={sensitive && !mapped ? "password" : "text"} value={value} onChange={event => onChange(event.target.value)} />}
      <select aria-label={`Insert mapping into ${label}`} value="" onChange={event => { if (event.target.value) onChange(value ? `${value} {{${event.target.value}}}` : `{{${event.target.value}}}`); }}><option value="">Insert value…</option><option value="trigger.path">Trigger · path</option>{nodes.map(node => <option key={node.id} value={`nodes.${node.id}.output`}>{node.name} · output</option>)}</select>
    </div>
  </Field>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>; }
function FolderInput({ value, onChoose }: { value: string; onChoose: () => void }) { return <div className="folder-input"><input value={value} readOnly placeholder="Choose an approved folder" /><button type="button" onClick={onChoose} disabled={!api.isDesktop}><FolderOpen size={15} /></button></div>; }
function Info({ children }: { children: React.ReactNode }) { return <div className="info-note">{children}</div>; }
function TimeoutField({ config, set }: { config: Record<string, unknown>; set: (key: string, value: unknown) => void }) { return <Field label="Timeout (ms)"><input type="number" min="100" max="120000" value={Number(config.timeoutMs ?? 30000)} onChange={event => set("timeoutMs", Number(event.target.value))} /></Field>; }
function TimeoutAndRetry({ config, set }: { config: Record<string, unknown>; set: (key: string, value: unknown) => void }) { return <div className="field-grid"><TimeoutField config={config} set={set} /><Field label="Retries"><input type="number" min="0" max="5" value={Number(config.retryCount ?? 0)} onChange={event => set("retryCount", Number(event.target.value))} /></Field></div>; }
function scalar(value: unknown) { return typeof value === "string" ? value : JSON.stringify(value ?? ""); }
function parseScalar(value: string) { if (value === "true") return true; if (value === "false") return false; if (value === "null") return null; if (value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value); return value; }
function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) { let text: string; try { text = JSON.stringify(value, null, 2); } catch { text = "{}"; } return <Field label={label} hint="JSON or safe {{reference}} values"><textarea className="code-input" rows={5} defaultValue={text} onBlur={event => { try { onChange(JSON.parse(event.target.value)); event.target.setCustomValidity(""); } catch { event.target.setCustomValidity("Enter valid JSON"); event.target.reportValidity(); } }} /></Field>; }
