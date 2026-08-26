import { randomUUID, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { candidateLocator, resolveLocator } from "./locator.js";
import { deduplicateRecorderEvents } from "./recorder.js";
import { PROTOCOL_VERSION, SIDECAR_VERSION, type SidecarRequest, type SidecarResponse, type StructuredLocator } from "./protocol.js";
import type { ManagedSession, RecordedStep } from "./types.js";

const expectedToken = process.env.SANDBOX_IPC_TOKEN ?? "";
const sessions = new Map<string, ManagedSession>();
const recordings = new Map<string, RecordedStep[]>();
const MAX_CONSOLE_ITEMS = 50;

function authenticated(token: string): boolean {
  if (!expectedToken || !token || expectedToken.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(expectedToken), Buffer.from(token));
}

function write(response: SidecarResponse) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function sessionOutput(session: ManagedSession) {
  return {
    browserSession: {
      sessionId: session.sessionId,
      profileId: session.profileId,
      contextId: session.contextId,
      pageId: session.pageId,
      currentUrl: session.page.url(),
      startedAt: session.startedAt,
    },
    page: { pageId: session.pageId },
    currentUrl: session.page.url(),
    closeAutomatically: session.closeAutomatically,
  };
}

async function openBrowser(payload: Record<string, unknown>) {
  const profileId = requiredString(payload.profileId, "Open Browser requires a browser profile.");
  const profilePath = requiredString(payload.profilePath, "The browser profile path is unavailable.");
  const persistent = payload.persistent !== false;
  const headed = payload.headed !== false;
  const viewport = object(payload.viewport);
  const options = {
    headless: !headed,
    viewport: { width: number(viewport.width, 1280), height: number(viewport.height, 800) },
    userAgent: optionalString(payload.userAgent),
    proxy: optionalString(payload.proxy) ? { server: String(payload.proxy) } : undefined,
    acceptDownloads: true,
  };
  let browser;
  let context;
  if (persistent) {
    await mkdir(profilePath, { recursive: true });
    context = await chromium.launchPersistentContext(profilePath, options);
  } else {
    browser = await chromium.launch({ headless: !headed, proxy: options.proxy });
    context = await browser.newContext(options);
  }
  const page = context.pages()[0] ?? await context.newPage();
  const session: ManagedSession = {
    sessionId: randomUUID(), profileId, contextId: randomUUID(), pageId: randomUUID(), context, browser, page,
    startedAt: new Date().toISOString(), closeAutomatically: payload.closeAutomatically !== false,
    consoleErrors: [], failedNetworkRequests: [], sensitiveLocators: [],
    tracePath: optionalString(payload.tracePath),
  };
  page.on("console", message => {
    if (message.type() === "error") boundedPush(session.consoleErrors, message.text());
  });
  page.on("requestfailed", request => boundedPush(session.failedNetworkRequests, `${request.method()} ${request.url()} · ${request.failure()?.errorText ?? "failed"}`));
  if (session.tracePath) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  sessions.set(session.sessionId, session);
  const maximumDurationMs = Math.min(number(payload.maximumDurationMs, 30 * 60_000), 4 * 60 * 60_000);
  setTimeout(() => closeSession(session.sessionId).catch(() => undefined), maximumDurationMs).unref();
  const initialUrl = optionalString(payload.initialUrl);
  if (initialUrl) await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: number(payload.defaultTimeoutMs, 30_000) });
  return sessionOutput(session);
}

async function dispatch(operation: string, payload: Record<string, unknown>): Promise<unknown> {
  if (operation === "hello") return {
    protocolVersion: PROTOCOL_VERSION,
    sidecarVersion: SIDECAR_VERSION,
    browserName: "chromium",
    browserVersion: await browserVersion(),
    executablePath: chromium.executablePath(),
  };
  if (operation === "open_browser") return openBrowser(payload);
  if (operation === "close_all") { await closeAll(); return { closed: true }; }
  const session = getSession(payload);
  const page = session.page;
  switch (operation) {
    case "navigate": {
      const started = performance.now();
      const waitUntil = waitState(String(payload.waitCondition ?? "dom_ready"));
      const response = await page.goto(requiredString(payload.url, "Navigate requires a URL."), { waitUntil, timeout: timeout(payload) });
      if (payload.waitCondition === "element_visible") await resolveAndWait(page, payload.locator, "visible", timeout(payload));
      return { ...sessionOutput(session), finalUrl: page.url(), pageTitle: await page.title(), httpStatus: response?.status(), loadDurationMs: Math.round(performance.now() - started) };
    }
    case "click_element": {
      const resolved = await resolveLocator(page, structured(payload.locator));
      const before = page.url();
      const clickType = String(payload.clickType ?? "normal");
      const options = { button: mouseButton(payload.mouseButton), modifiers: modifiers(payload.modifiers), timeout: timeout(payload) };
      if (clickType === "double") await resolved.locator.dblclick(options);
      else await resolved.locator.click({ ...options, clickCount: clickType === "right" ? 1 : undefined, button: clickType === "right" ? "right" : options.button });
      if (number(payload.waitAfterMs, 0) > 0) await page.waitForTimeout(number(payload.waitAfterMs, 0));
      return { ...sessionOutput(session), locatorAttempts: resolved.attempts, successfulLocator: resolved.candidate, matchCount: 1, navigated: before !== page.url() };
    }
    case "fill_field": {
      const locator = structured(payload.locator);
      const resolved = await resolveLocator(page, locator);
      const value = requiredString(payload.value, "Fill Field requires a value.");
      if (payload.sensitive === true) session.sensitiveLocators.push(locator);
      if (payload.clearExisting !== false) await resolved.locator.fill("");
      const delay = number(payload.inputDelayMs, 0);
      if (delay > 0) await resolved.locator.pressSequentially(value, { delay });
      else await resolved.locator.fill(value);
      return { ...sessionOutput(session), locatorAttempts: resolved.attempts, successfulLocator: resolved.candidate, matchCount: 1, sensitive: payload.sensitive === true, charactersEntered: value.length };
    }
    case "select_option": {
      const resolved = await resolveLocator(page, structured(payload.locator));
      const by = String(payload.selectBy ?? "value");
      const selected = await resolved.locator.selectOption(by === "label" ? { label: String(payload.option) } : by === "index" ? { index: number(payload.option, 0) } : { value: String(payload.option) });
      return { ...sessionOutput(session), selected, locatorAttempts: resolved.attempts, successfulLocator: resolved.candidate, matchCount: 1 };
    }
    case "press_key": {
      const key = validateKey(String(payload.key ?? ""));
      const target = payload.locator ? (await resolveLocator(page, structured(payload.locator))).locator : page.locator("body");
      await target.press(key, { timeout: timeout(payload) });
      return { ...sessionOutput(session), key };
    }
    case "wait_for": return waitFor(session, payload);
    case "extract_data": return extractData(session, payload);
    case "screenshot": return screenshot(session, payload);
    case "download_file": return downloadFile(session, payload);
    case "upload_file": {
      const resolved = await resolveLocator(page, structured(payload.locator));
      const files = Array.isArray(payload.files) ? payload.files.map(String) : [requiredString(payload.file, "Upload File requires an approved file.")];
      await resolved.locator.setInputFiles(files, { timeout: timeout(payload) });
      return { ...sessionOutput(session), uploadedFiles: files.map(file => path.basename(file)), locatorAttempts: resolved.attempts, successfulLocator: resolved.candidate, matchCount: 1 };
    }
    case "test_locator": {
      const resolved = await resolveLocator(page, structured(payload.locator));
      await resolved.locator.highlight();
      return { ...sessionOutput(session), locatorAttempts: resolved.attempts, successfulLocator: resolved.candidate, matchCount: 1 };
    }
    case "recorder_start": {
      const initialUrl = optionalString(payload.initialUrl);
      if (initialUrl) await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: timeout(payload) });
      await startRecording(session);
      return { ...sessionOutput(session), recording: true };
    }
    case "recorder_snapshot": return { ...sessionOutput(session), recording: true, steps: deduplicateRecorderEvents(recordings.get(session.sessionId) ?? []) };
    case "recorder_stop": {
      const steps = deduplicateRecorderEvents(recordings.get(session.sessionId) ?? []);
      recordings.delete(session.sessionId);
      return { ...sessionOutput(session), recording: false, steps };
    }
    case "close_browser": await closeSession(session.sessionId); return { closed: true, sessionId: session.sessionId };
    default: throw coded("unsupported_operation", `Browser sidecar operation '${operation}' is not supported.`);
  }
}

async function waitFor(session: ManagedSession, payload: Record<string, unknown>) {
  const page = session.page;
  const kind = String(payload.waitFor ?? "time");
  if (kind === "time") await page.waitForTimeout(Math.min(number(payload.delayMs, 1000), timeout(payload)));
  else if (kind === "element_visible" || kind === "element_hidden") await resolveAndWait(page, payload.locator, kind === "element_visible" ? "visible" : "hidden", timeout(payload));
  else if (kind === "text_present") await page.getByText(requiredString(payload.text, "Wait For text is required.")).waitFor({ state: "visible", timeout: timeout(payload) });
  else if (kind === "url_matches") await page.waitForURL(requiredString(payload.urlPattern, "Wait For URL pattern is required."), { timeout: timeout(payload) });
  else if (kind === "page_load_state") await page.waitForLoadState(waitState(String(payload.loadState ?? "dom_ready")), { timeout: timeout(payload) });
  else if (kind === "network_response") await page.waitForResponse(response => response.url().includes(String(payload.urlPattern ?? "")), { timeout: timeout(payload) });
  else if (kind === "download_begins") await page.waitForEvent("download", { timeout: timeout(payload) });
  else throw coded("invalid_wait", `Wait condition '${kind}' is not supported.`);
  return { ...sessionOutput(session), waitedFor: kind };
}

async function extractData(session: ManagedSession, payload: Record<string, unknown>) {
  const resolved = await resolveLocator(session.page, structured(payload.locator));
  const kind = String(payload.extract ?? "text");
  const repeated = payload.repeated === true || kind === "table";
  const fields = object(payload.fields);
  let value: unknown;
  if (kind === "table") {
    value = await resolved.locator.locator("tr").evaluateAll((rows, names) => rows.map(row => {
      const cells = Array.from(row.querySelectorAll("th,td")).map(cell => (cell.textContent ?? "").trim());
      return Object.fromEntries(cells.map((cell, index) => [names[index] ?? `column_${index + 1}`, cell]));
    }), Array.isArray(payload.columnNames) ? payload.columnNames : []);
  } else if (Object.keys(fields).length) {
    const elements = repeated ? resolved.locator : resolved.locator.first();
    value = await elements.evaluateAll((nodes, mapping) => nodes.map(node => Object.fromEntries(Object.entries(mapping).map(([name, spec]) => {
      const setting = spec as { type?: string; attribute?: string };
      const element = node as HTMLElement;
      const field = setting.type === "attribute" ? element.getAttribute(setting.attribute ?? "") : setting.type === "link" ? (element as HTMLAnchorElement).href : setting.type === "image" ? (element as HTMLImageElement).src : (element.textContent ?? "").trim();
      return [name, field];
    }))), fields);
    if (!repeated) value = (value as unknown[])[0] ?? null;
  } else {
    const values = kind === "attribute" ? await resolved.locator.evaluateAll((nodes, attribute) => nodes.map(node => node.getAttribute(attribute)), String(payload.attribute ?? "")) :
      kind === "link" ? await resolved.locator.evaluateAll(nodes => nodes.map(node => (node as HTMLAnchorElement).href)) :
      kind === "image_source" ? await resolved.locator.evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src)) : await resolved.locator.allTextContents();
    value = repeated ? values : values[0] ?? null;
  }
  const name = String(payload.fieldName ?? "value");
  return { ...sessionOutput(session), data: { [name]: value }, locatorAttempts: resolved.attempts, successfulLocator: resolved.candidate, matchCount: await resolved.locator.count() };
}

async function screenshot(session: ManagedSession, payload: Record<string, unknown>) {
  const outputPath = requiredString(payload.outputPath, "Screenshot requires an output path.");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const mode = String(payload.mode ?? "viewport");
  const options = { path: outputPath, type: "png" as const, timeout: timeout(payload), mask: await sensitiveMasks(session) };
  if (mode === "element") await (await resolveLocator(session.page, structured(payload.locator))).locator.screenshot(options);
  else await session.page.screenshot({ ...options, fullPage: mode === "full_page" });
  const details = await stat(outputPath);
  if (details.size > number(payload.maximumBytes, 10 * 1024 * 1024)) throw coded("screenshot_too_large", "Screenshot exceeded the configured size limit.");
  return { ...sessionOutput(session), path: outputPath, sizeBytes: details.size, includedInHistory: payload.includeInHistory !== false };
}

async function downloadFile(session: ManagedSession, payload: Record<string, unknown>) {
  const resolved = await resolveLocator(session.page, structured(payload.locator));
  const [download] = await Promise.all([session.page.waitForEvent("download", { timeout: timeout(payload) }), resolved.locator.click({ timeout: timeout(payload) })]);
  const folder = requiredString(payload.destinationFolder, "Download File requires an approved destination folder.");
  await mkdir(folder, { recursive: true });
  const suggested = optionalString(payload.filename) ?? download.suggestedFilename();
  let destination = path.join(folder, suggested);
  const collision = String(payload.collisionBehaviour ?? "rename");
  if (collision === "rename") destination = await availablePath(destination);
  else if (collision === "fail") { try { await stat(destination); throw coded("download_collision", `A file named '${path.basename(destination)}' already exists.`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  const temporary = await download.path();
  if (!temporary) throw coded("download_failed", "The browser did not provide a completed download file.");
  const details = await stat(temporary);
  if (details.size > number(payload.maximumBytes, 100 * 1024 * 1024)) throw coded("download_too_large", "Download exceeded the configured maximum file size.");
  await download.saveAs(destination);
  return { ...sessionOutput(session), path: destination, filename: path.basename(destination), sizeBytes: details.size, locatorAttempts: resolved.attempts, successfulLocator: resolved.candidate, matchCount: 1 };
}

async function captureDiagnostics(session: ManagedSession, error: unknown, payload: Record<string, unknown>) {
  let screenshotPath: string | undefined;
  const diagnosticDirectory = optionalString(payload.diagnosticDirectory);
  if (diagnosticDirectory) {
    await mkdir(diagnosticDirectory, { recursive: true });
    screenshotPath = path.join(diagnosticDirectory, `failure-${Date.now()}.png`);
    try { await session.page.screenshot({ path: screenshotPath, fullPage: false, mask: await sensitiveMasks(session) }); } catch { screenshotPath = undefined; }
  }
  return {
    currentUrl: session.page.url(), pageTitle: await session.page.title().catch(() => ""),
    locatorAttempts: (error as { locatorAttempts?: unknown }).locatorAttempts ?? [],
    matchCount: 0, consoleErrors: session.consoleErrors, failedNetworkRequests: session.failedNetworkRequests,
    screenshotPath, tracePath: session.tracePath, playwrightError: error instanceof Error ? error.message : String(error),
    unexpectedNavigation: false, rerecordAvailable: true,
  };
}

async function startRecording(session: ManagedSession) {
  recordings.set(session.sessionId, []);
  await session.context.exposeBinding("__sandboxCapture", (_source, event: RecordedStep) => {
    if (!recordings.has(session.sessionId)) return;
    recordings.get(session.sessionId)!.push(event);
  });
  await session.context.addInitScript({ content: RECORDER_SCRIPT });
  await session.page.evaluate(RECORDER_SCRIPT);
  session.page.on("framenavigated", frame => {
    if (frame === session.page.mainFrame() && safeRecordingUrl(frame.url())) recordings.get(session.sessionId)?.push({ id: randomUUID(), action: "navigate", name: `Open ${new URL(frame.url()).hostname || "page"}`, configuration: { url: frame.url(), waitCondition: "dom_ready" } });
  });
}

const RECORDER_SCRIPT = `(() => {
  if (window.__sandboxRecorderInstalled) return; window.__sandboxRecorderInstalled = true;
  const candidate = (el) => { const role=el.getAttribute('role'); const name=el.getAttribute('aria-label')||el.innerText?.trim().slice(0,80); const label=el.labels?.[0]?.innerText?.trim(); const placeholder=el.getAttribute('placeholder'); const testId=el.getAttribute('data-testid'); const alternatives=[]; if(label) alternatives.push({kind:'label',value:label,exact:true}); if(placeholder) alternatives.push({kind:'placeholder',value:placeholder,exact:true}); if(testId) alternatives.push({kind:'test_id',value:testId,exact:true}); if(name) alternatives.push({kind:'text',value:name,exact:true}); alternatives.push({kind:'css',value:el.id?'#'+CSS.escape(el.id):el.tagName.toLowerCase(),exact:true}); return {primary:role?{kind:'role',value:role,name,exact:true}:alternatives.shift(),alternatives,elementRole:role,accessibleName:name,tag:el.tagName.toLowerCase(),stableAttributes:{},framePath:[],recordingUrl:location.href,nearbyText:el.parentElement?.innerText?.trim().slice(0,120)}; };
  const sensitive=(el)=>el.type==='password'||/password|passcode|card.?number|cvv|cvc/i.test([el.name,el.autocomplete,el.labels?.[0]?.innerText].join(' '));
  const send=(action,el,extra={})=>window.__sandboxCapture({id:crypto.randomUUID(),action,name:action==='fill_field'?'Fill '+(el.labels?.[0]?.innerText||el.name||'field'):action==='click_element'?'Click '+(el.innerText?.trim().slice(0,50)||el.getAttribute('aria-label')||el.tagName.toLowerCase()):action,configuration:{locator:candidate(el),...extra},sensitiveInputRequired:sensitive(el)});
  document.addEventListener('click',e=>send('click_element',e.target,{clickType:'normal'}),true);
  document.addEventListener('dblclick',e=>send('click_element',e.target,{clickType:'double'}),true);
  document.addEventListener('input',e=>{const el=e.target;if(el.matches('input,textarea'))send('fill_field',el,{value:sensitive(el)?'':el.value,clearExisting:true,sensitive:sensitive(el)});},true);
  document.addEventListener('change',e=>{const el=e.target;if(el.matches('select'))send('select_option',el,{selectBy:'value',option:el.value});if(el.matches('input[type=file]'))send('upload_file',el,{fileRequirement:true});},true);
  document.addEventListener('keydown',e=>{if(['Enter','Escape','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))send('press_key',e.target,{key:e.key});},true);
})();`;

async function closeSession(id: string) {
  const session = sessions.get(id); if (!session) return;
  sessions.delete(id); recordings.delete(id);
  if (session.tracePath) { await mkdir(path.dirname(session.tracePath), { recursive: true }); await session.context.tracing.stop({ path: session.tracePath }).catch(() => undefined); }
  await session.context.close().catch(() => undefined); await session.browser?.close().catch(() => undefined);
}
async function closeAll() { await Promise.all([...sessions.keys()].map(closeSession)); }
async function browserVersion() { const browser = await chromium.launch({ headless: true }); try { return browser.version(); } finally { await browser.close(); } }
function getSession(payload: Record<string, unknown>) { const id=requiredString(payload.sessionId,"A browser session is required."); const session=sessions.get(id); if(!session) throw coded("session_not_found","The browser session is no longer available. Open Browser must run first."); return session; }
function structured(value: unknown) { if (!value || typeof value !== "object") throw coded("locator_required", "A structured element locator is required."); return value as StructuredLocator; }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function requiredString(value: unknown, message: string) { if(typeof value!=="string"||!value.trim()) throw coded("invalid_configuration",message); return value; }
function optionalString(value: unknown) { return typeof value==="string"&&value.trim()?value:undefined; }
function number(value: unknown, fallback: number) { return typeof value==="number"&&Number.isFinite(value)?value:fallback; }
function timeout(payload: Record<string, unknown>) { return Math.min(Math.max(number(payload.timeoutMs,30_000),100),120_000); }
function waitState(value:string):"load"|"domcontentloaded"|"networkidle" { return value==="page_loaded"||value==="load"?"load":value==="network_idle"||value==="networkidle"?"networkidle":"domcontentloaded"; }
function mouseButton(value: unknown):"left"|"middle"|"right" { return value==="middle"?"middle":value==="right"?"right":"left"; }
function modifiers(value:unknown):("Alt"|"Control"|"Meta"|"Shift")[]{return Array.isArray(value)?value.filter(item=>["Alt","Control","Meta","Shift"].includes(String(item))) as ("Alt"|"Control"|"Meta"|"Shift")[]:[]}
function validateKey(value:string){if(!/^(Enter|Escape|Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Backspace|Delete|Home|End|PageUp|PageDown|F([1-9]|1[0-2])|([A-Za-z0-9]|Alt|Control|Meta|Shift)(\+(Alt|Control|Meta|Shift|[A-Za-z0-9]))*)$/.test(value))throw coded("invalid_key",`Key combination '${value}' is invalid.`);return value}
function boundedPush(target:string[],value:string){target.push(value.slice(0,2000));if(target.length>MAX_CONSOLE_ITEMS)target.shift()}
function coded(code:string,message:string){return Object.assign(new Error(message),{code})}
function safeRecordingUrl(url:string){return /^https?:/i.test(url)}
async function resolveAndWait(page:Page,value:unknown,state:"visible"|"hidden",timeoutMs:number){const resolved=await resolveLocator(page,structured(value));await resolved.locator.waitFor({state,timeout:timeoutMs});return resolved}
async function sensitiveMasks(session:ManagedSession){const masks=[];for(const locator of session.sensitiveLocators){try{masks.push(candidateLocator(session.page,locator.primary))}catch{}}return masks}
async function availablePath(value:string){let index=1;let candidate=value;while(true){try{await stat(candidate);const parsed=path.parse(value);candidate=path.join(parsed.dir,`${parsed.name} (${index++})${parsed.ext}`)}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return candidate;throw error}}}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on("line", async line => {
  let request: SidecarRequest;
  try { request = JSON.parse(line); } catch { return write({id:"unknown",protocolVersion:PROTOCOL_VERSION,sidecarVersion:SIDECAR_VERSION,ok:false,error:{code:"invalid_json",message:"The sidecar request was not valid JSON."}}); }
  if (!authenticated(request.token)) return write({id:request.id,protocolVersion:PROTOCOL_VERSION,sidecarVersion:SIDECAR_VERSION,ok:false,error:{code:"unauthorized",message:"Browser sidecar IPC authentication failed."}});
  if (request.protocolVersion !== PROTOCOL_VERSION) return write({id:request.id,protocolVersion:PROTOCOL_VERSION,sidecarVersion:SIDECAR_VERSION,ok:false,error:{code:"protocol_mismatch",message:`Browser protocol ${request.protocolVersion} is incompatible with ${PROTOCOL_VERSION}.`}});
  try { write({id:request.id,protocolVersion:PROTOCOL_VERSION,sidecarVersion:SIDECAR_VERSION,ok:true,result:await dispatch(request.operation,request.payload??{})}); }
  catch(error){const sessionId=optionalString(request.payload?.sessionId);const session=sessionId?sessions.get(sessionId):undefined;const details=session?await captureDiagnostics(session,error,request.payload):undefined;write({id:request.id,protocolVersion:PROTOCOL_VERSION,sidecarVersion:SIDECAR_VERSION,ok:false,error:{code:(error as {code?:string}).code??"browser_operation_failed",message:error instanceof Error?error.message:String(error),details}})}
});
for (const signal of ["SIGTERM","SIGINT"] as const) process.on(signal,()=>closeAll().finally(()=>process.exit(0)));
