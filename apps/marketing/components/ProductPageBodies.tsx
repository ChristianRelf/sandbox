import Link from "next/link";
import {
  Activity,
  AppWindow,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  Code2,
  FileCheck2,
  FolderLock,
  GitBranch,
  HardDrive,
  KeyRound,
  LockKeyhole,
  PackageCheck,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  SquareTerminal,
  UserCheck,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { productPages, type ProductPage } from "@sandbox/content";
import { ProductCapabilityExplorer } from "./ProductCapabilityExplorer";
import styles from "./ProductPageBodies.module.css";

type BodyProps = { page: ProductPage; index: number };

const exitCopy: Record<string, { overline: string; title: string }> = {
  "visual-workflow-builder": { overline: "CANVAS COMPILED", title: "Give the route somewhere real to run." },
  "local-automation": { overline: "BOUNDARY VERIFIED", title: "The next route can leave the desk—on your terms." },
  "browser-automation": { overline: "RECORDING SAVED", title: "Keep the routine moving after the tab closes." },
  "always-on-execution": { overline: "FLEET ONLINE", title: "Extend the system with reviewed capability." },
  "plugins-marketplace": { overline: "MANIFEST APPROVED", title: "Put extension decisions behind a team gate." },
  "teams-governance": { overline: "REVISION APPROVED", title: "Take the same operating model into code." },
  developers: { overline: "CONTRACT VALID", title: "Return to the canvas with the contract visible." },
};

function productHref(slug: string) {
  return slug === "developers" ? "/developers" : `/product/${slug}`;
}

function docLabel(path: string) {
  return path.split("/").at(-1)?.replaceAll("-", " ") ?? path;
}

function DiscoverTag({ step, label, tone = "light" }: { step: string; label: string; tone?: "light" | "dark" | "signal" }) {
  return <div className={styles.discoverTag} data-tone={tone}><span>DISCOVER</span><small>{step} / {label}</small></div>;
}

function ProductExit({ page, index, variant }: BodyProps & { variant: string }) {
  const next = productPages[(index + 1) % productPages.length];
  const copy = exitCopy[page.slug] ?? exitCopy["visual-workflow-builder"];

  return (
    <section className={styles.productExit} data-variant={variant} aria-labelledby={`${page.slug}-exit-title`}>
      <div><span>{copy.overline}</span><small>PRODUCT / 0{index + 1} → 0{((index + 1) % productPages.length) + 1}</small></div>
      <h2 id={`${page.slug}-exit-title`}>{copy.title}</h2>
      <Link href={productHref(next.slug)}><span>NEXT PRODUCT</span><strong>{next.eyebrow}</strong><ArrowRight aria-hidden="true" size={18} /></Link>
    </section>
  );
}

export function ProductPageBody(props: BodyProps) {
  switch (props.page.slug) {
    case "local-automation":
      return <LocalBody {...props} />;
    case "browser-automation":
      return <BrowserBody {...props} />;
    case "always-on-execution":
      return <AlwaysOnBody {...props} />;
    case "plugins-marketplace":
      return <PluginsBody {...props} />;
    case "teams-governance":
      return <TeamsBody {...props} />;
    case "developers":
      return <DevelopersBody {...props} />;
    default:
      return <BuilderBody {...props} />;
  }
}

function BuilderBody({ page, index }: BodyProps) {
  const validation = [
    ["CONNECTION", "Output<Table> → Input<Table>", "VALID"],
    ["PERMISSION", "filesystem.read / approved", "VALID"],
    ["CONTROL FLOW", "false branch / explained", "VALID"],
    ["REVISION", "draft_018 / unpublished", "SAFE"],
  ];

  return (
    <div className={styles.builderBody} data-body="builder-canvas">
      <ol className={styles.builderCompileRail} aria-label="Workflow compilation stages">
        {[
          ["TRIGGER", "INPUT KNOWN"], ["TYPED CANVAS", "SHAPE CHECKED"], ["VALIDATED ROUTE", "BOUNDARY CLEAR"], ["RUN EVIDENCE", "TRACE ATTACHED"],
        ].map(([title, state], stepIndex) => <li key={title}><span>0{stepIndex + 1}</span><strong>{title}</strong><small>{state}</small></li>)}
      </ol>

      <section id="product-proof" className={styles.builderExplorer} aria-labelledby="builder-explorer-title">
        <header>
          <DiscoverTag step="02" label="SELECT A CANVAS DECISION" />
          <h2 id="builder-explorer-title">Every connection<br />earns its place.</h2>
          <p>Move through the route to see how an editor decision becomes typed configuration and then run evidence.</p>
        </header>
        <ProductCapabilityExplorer product={page.slug} items={page.benefits} details={page.details} proof={page.proof} />
      </section>

      <section className={styles.builderValidation} aria-labelledby="builder-validation-title">
        <div className={styles.builderValidationCopy}>
          <DiscoverTag step="03" label="RUN THE PRE-FLIGHT" tone="dark" />
          <h2 id="builder-validation-title">The first failure should happen before execution.</h2>
          <p>Sandbox checks graph structure, required configuration and capability boundaries while the route is still cheap to change.</p>
          <Link href="/security">Review the validation boundary <ArrowRight aria-hidden="true" size={14} /></Link>
        </div>
        <div className={styles.builderCompiler} role="group" aria-label="Workflow pre-flight validation report">
          <header><span>COMPILE / DRAFT_018</span><strong><i /> 4 CHECKS PASSED</strong></header>
          <ol>{validation.map(([type, value, state], rowIndex) => <li key={type}><span>0{rowIndex + 1}</span><div><small>{type}</small><code>{value}</code></div><b><Check aria-hidden="true" size={12} />{state}</b></li>)}</ol>
          <footer><code>route.signature / 7c2a-018</code><span>READY TO TEST</span></footer>
        </div>
      </section>

      <section className={styles.builderRevisions} aria-labelledby="builder-revisions-title">
        <header><span>04 / REVISION PRACTICE</span><h2 id="builder-revisions-title">Draft. Test. Compare. Publish.</h2></header>
        <div className={styles.builderRevisionTrack}>
          {page.benefits.map((benefit, benefitIndex) => <article key={benefit.title}><span>R{16 + benefitIndex}</span><small>{benefitIndex === 2 ? "PUBLISH CANDIDATE" : "SAVED REVISION"}</small><h3>{benefit.title}</h3><p>{benefit.body}</p><i /></article>)}
        </div>
        <nav aria-label="Workflow builder documentation">{page.related.map((path, docIndex) => <a key={path} href={`https://docs.sndbox.app/${path}`}><span>0{docIndex + 1}</span><strong>{docLabel(path)}</strong><code>/{path}</code><ArrowUpRight aria-hidden="true" size={14} /></a>)}</nav>
      </section>

      <ProductExit page={page} index={index} variant="builder" />
    </div>
  );
}

function LocalBody({ page, index }: BodyProps) {
  const permissionCopy = [
    "One root is exposed to this workflow; neighbouring folders remain unreachable.",
    "The executable and arguments are approved independently—there is no ambient shell.",
    "Private targets are constrained to named domains or addresses inside the network.",
    "Schedules live with the local runner and survive an editor restart.",
  ];

  return (
    <div className={styles.localBody} data-body="local-boundary">
      <section id="product-proof" className={styles.localGates} aria-labelledby="local-gates-title">
        <header><DiscoverTag step="02" label="OPEN EACH LOCAL GATE" /><h2 id="local-gates-title">One machine.<br />Four explicit gates.</h2><p>Each local capability is narrow by default. Expand a gate to inspect exactly what the runner receives.</p></header>
        <div className={styles.localGateMap}>
          <aside><HardDrive aria-hidden="true" size={22} /><span>THIS MACHINE</span><strong>LOCAL RUNNER / ONLINE</strong><small>Workflow data remains inside this boundary.</small></aside>
          <div>
            {page.details.map((detail, detailIndex) => (
              <details key={detail.label} open={detailIndex === 0}>
                <summary><span>0{detailIndex + 1}</span>{detailIndex === 0 ? <FolderLock aria-hidden="true" size={16} /> : detailIndex === 1 ? <SquareTerminal aria-hidden="true" size={16} /> : detailIndex === 2 ? <Wifi aria-hidden="true" size={16} /> : <Activity aria-hidden="true" size={16} />}<strong>{detail.label}</strong><code>{detail.value}</code><ChevronRight aria-hidden="true" size={14} /></summary>
                <p>{permissionCopy[detailIndex]}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.localResidency} aria-labelledby="local-residency-title">
        <div><DiscoverTag step="03" label="TRACE DATA RESIDENCY" tone="dark" /><h2 id="local-residency-title">What happens here,<br />stays inspectable here.</h2><blockquote>{page.proof}</blockquote></div>
        <div className={styles.localResidencyMap} role="group" aria-label="Local and external data residency comparison">
          <article><header><Check aria-hidden="true" size={14} /><span>STAYS ON THE MACHINE</span></header><ul><li>Workflow definition</li><li>Filesystem contents</li><li>Credential values</li><li>Local run history</li></ul></article>
          <i aria-hidden="true" />
          <article><header><X aria-hidden="true" size={14} /><span>NOT SENT TO A TASK SERVICE</span></header><ul><li>File payloads</li><li>Command output</li><li>Private API responses</li><li>Vault secrets</li></ul></article>
        </div>
      </section>

      <section className={styles.localRoutine} aria-labelledby="local-routine-title">
        <header><span>04 / A LOCAL MORNING</span><h2 id="local-routine-title">A routine that never needs to leave the room.</h2></header>
        <ol>{["Watch an approved folder", "Validate a new invoice", "Call the private ledger", "Write local evidence"].map((step, stepIndex) => <li key={step}><span>08:0{stepIndex}</span><i /><strong>{step}</strong><small>{stepIndex === 3 ? "COMPLETE" : "LOCAL"}</small></li>)}</ol>
        <aside><p>{page.benefits[0].body}</p><nav aria-label="Local automation documentation">{page.related.map((path) => <a href={`https://docs.sndbox.app/${path}`} key={path}>{docLabel(path)}<ArrowUpRight aria-hidden="true" size={13} /></a>)}</nav></aside>
      </section>

      <ProductExit page={page} index={index} variant="local" />
    </div>
  );
}

function BrowserBody({ page, index }: BodyProps) {
  const recordedSteps = [
    { action: "Navigate", target: "/reports/monthly", note: "URL constrained" },
    { action: "Click", target: "button ‘Current month’", note: "Role + name" },
    { action: "Download", target: "report.csv", note: "Folder approved" },
    { action: "Extract", target: "table / 24 rows", note: "Structured output" },
  ];

  return (
    <div className={styles.browserBody} data-body="browser-recorder">
      <section id="product-proof" className={styles.browserPlayback} aria-labelledby="browser-playback-title">
        <header><DiscoverTag step="02" label="SCRUB THE RECORDING" tone="dark" /><h2 id="browser-playback-title">A real routine becomes an editable sequence.</h2><p>Recording gives the route a faithful first draft. Every captured action is still an ordinary node with ordinary configuration.</p></header>
        <div className={styles.playbackStrip} role="group" aria-label="Recorded browser workflow steps">
          <div className={styles.playbackTime}><span>REC / 00:18</span><strong><Play aria-hidden="true" size={14} fill="currentColor" /> PLAYBACK</strong></div>
          <ol>{recordedSteps.map((step, stepIndex) => <li key={step.action} data-selected={stepIndex === 1 ? "true" : undefined}><span>0{stepIndex + 1}</span><AppWindow aria-hidden="true" size={15} /><div><small>{step.action}</small><strong>{step.target}</strong></div><code>{step.note}</code></li>)}</ol>
          <div className={styles.playbackTimeline}><i /><i /><i /><i /><span>00:00</span><small>00:18</small></div>
        </div>
      </section>

      <section className={styles.browserForensics} aria-labelledby="browser-forensics-title">
        <div className={styles.failedViewport} role="img" aria-label="Browser failure screenshot with a highlighted missing export button">
          <header><span>reports.internal / monthly</span><small>CAPTURED AT FAILURE</small></header>
          <aside><b>ACME</b><span>Overview</span><strong>Reports</strong><span>Exports</span></aside>
          <div><span>MONTHLY ACTIVITY</span><h3>Export ready</h3><i /><i /><i /><i /><b>EXPECTED TARGET</b></div>
        </div>
        <div className={styles.forensicsCopy}>
          <DiscoverTag step="03" label="OPEN FAILURE EVIDENCE" tone="dark" />
          <h2 id="browser-forensics-title">When a page changes, the failure points somewhere useful.</h2>
          <p>{page.proof}</p>
          <dl><div><dt>FAILED STEP</dt><dd>03 / Click Export CSV</dd></div><div><dt>PRIMARY LOCATOR</dt><dd><code>role=button name=Export CSV</code></dd></div><div><dt>FALLBACK</dt><dd><code>text=Export / exact</code></dd></div><div><dt>PROTECTED VALUES</dt><dd>Redacted from capture</dd></div></dl>
        </div>
      </section>

      <section className={styles.browserFieldNotes} aria-labelledby="browser-notes-title">
        <header><span>04 / FIELD NOTES</span><h2 id="browser-notes-title">Record the behaviour. Keep the decisions.</h2></header>
        <div>{page.benefits.map((benefit, benefitIndex) => <article key={benefit.title}><span>0{benefitIndex + 1}</span><h3>{benefit.title}</h3><p>{benefit.body}</p></article>)}</div>
        <nav aria-label="Browser automation documentation">{page.related.map((path, docIndex) => <a href={`https://docs.sndbox.app/${path}`} key={path}><small>GUIDE / 0{docIndex + 1}</small><strong>{docLabel(path)}</strong><code>/{path}</code><ArrowUpRight aria-hidden="true" size={14} /></a>)}</nav>
      </section>

      <ProductExit page={page} index={index} variant="browser" />
    </div>
  );
}

function AlwaysOnBody({ page, index }: BodyProps) {
  const events = [
    ["00:00.000", "LEASE", "runner_linux_02 accepted run_018"],
    ["00:06.481", "CHECKPOINT", "browser session persisted"],
    ["00:06.923", "HEARTBEAT", "runner_linux_02 missed"],
    ["00:07.104", "RECOVER", "runner_hosted_01 resumed checkpoint"],
  ];

  return (
    <div className={styles.alwaysBody} data-body="runner-fleet">
      <section id="product-proof" className={styles.telemetry} aria-labelledby="telemetry-title">
        <header><DiscoverTag step="02" label="READ THE LIVE ROUTE" tone="signal" /><h2 id="telemetry-title">Infrastructure becomes part of the workflow.</h2><p>Placement, leases, heartbeats and recovery are visible route decisions—not an invisible service tier.</p></header>
        <div className={styles.telemetryBoard}>
          <div className={styles.telemetryPulse}><span>RUN / 018</span><svg viewBox="0 0 800 120" role="img" aria-label="Stable runner heartbeat"><path d="M0 67 H180 L205 67 L220 18 L245 104 L266 54 L285 67 H505 L530 67 L544 30 L562 89 L581 67 H800" /></svg><strong><i /> HEALTHY</strong></div>
          <dl>{page.details.map((detail, detailIndex) => <div key={detail.label}><dt>0{detailIndex + 1} / {detail.label}</dt><dd>{detail.value}</dd><small>{detailIndex === 0 ? "04 READY" : detailIndex === 1 ? "03 ONLINE" : detailIndex === 2 ? "ROUTED" : "DURABLE"}</small></div>)}</dl>
        </div>
      </section>

      <section className={styles.recoveryStory} aria-labelledby="recovery-title">
        <div><DiscoverTag step="03" label="FOLLOW THE RECOVERY" tone="dark" /><h2 id="recovery-title">A missed heartbeat does not erase the route.</h2><p>{page.proof}</p></div>
        <ol>{events.map(([time, type, message], eventIndex) => <li key={type}><time>{time}</time><span>0{eventIndex + 1}</span><i /><div><small>{type}</small><strong>{message}</strong></div>{eventIndex === 3 && <Check aria-hidden="true" size={15} />}</li>)}</ol>
      </section>

      <section className={styles.placementGuide} aria-labelledby="placement-title">
        <header><span>04 / PLACE THE WORK</span><h2 id="placement-title">One workflow. A deliberate place for every environment.</h2></header>
        <div>{page.benefits.map((benefit, benefitIndex) => <article key={benefit.title}><header><span>0{benefitIndex + 1}</span>{benefitIndex === 0 ? <Server aria-hidden="true" size={18} /> : benefitIndex === 1 ? <RefreshCw aria-hidden="true" size={18} /> : <Activity aria-hidden="true" size={18} />}</header><h3>{benefit.title}</h3><p>{benefit.body}</p><small>{benefitIndex === 0 ? "ENVIRONMENT" : benefitIndex === 1 ? "RECOVERY" : "OPERATIONS"}</small></article>)}</div>
        <nav aria-label="Always-on execution documentation">{page.related.map((path) => <a href={`https://docs.sndbox.app/${path}`} key={path}><code>/{path}</code><strong>{docLabel(path)}</strong><ArrowUpRight aria-hidden="true" size={14} /></a>)}</nav>
      </section>

      <ProductExit page={page} index={index} variant="always" />
    </div>
  );
}

function PluginsBody({ page, index }: BodyProps) {
  return (
    <div className={styles.pluginsBody} data-body="plugin-manifest">
      <section id="product-proof" className={styles.manifestReview} aria-labelledby="manifest-review-title">
        <header><DiscoverTag step="02" label="REVIEW THE REQUEST" /><h2 id="manifest-review-title">The manifest asks.<br />The host decides.</h2><p>Package capability is readable before installation and enforced again when the node runs.</p></header>
        <div className={styles.manifestDocument}>
          <header><span>sandbox.plugin.json</span><strong><PackageCheck aria-hidden="true" size={14} /> SIGNED / VALID</strong></header>
          <div className={styles.manifestMeta}><span>PACKAGE</span><b>csv-toolkit</b><span>VERSION</span><b>2.4.1 / exact</b><span>PUBLISHER</span><b>Northstar Labs</b></div>
          {page.benefits.map((benefit, benefitIndex) => <details key={benefit.title} open={benefitIndex === 0}><summary><span>0{benefitIndex + 1}</span><strong>{benefit.title}</strong><code>{benefitIndex === 0 ? "manifest.review" : benefitIndex === 1 ? "version.pin" : "visibility.scope"}</code><ChevronRight aria-hidden="true" size={14} /></summary><p>{benefit.body}</p></details>)}
          <footer><code>sha256 / 7c9a...42ef</code><span>CAPABILITIES BROKERED</span></footer>
        </div>
      </section>

      <section className={styles.pluginTrust} aria-labelledby="plugin-trust-title">
        <div><DiscoverTag step="03" label="CHECK THE TRUST CHAIN" tone="dark" /><h2 id="plugin-trust-title">Trust is assembled from verifiable parts.</h2><blockquote>{page.proof}</blockquote></div>
        <ol aria-label="Plugin trust chain"><li><span>01</span><PackageCheck aria-hidden="true" size={18} /><strong>Publisher</strong><small>Identity verified</small></li><li><span>02</span><FileCheck2 aria-hidden="true" size={18} /><strong>Package</strong><small>Signature valid</small></li><li><span>03</span><LockKeyhole aria-hidden="true" size={18} /><strong>Capabilities</strong><small>Explicitly brokered</small></li><li><span>04</span><GitBranch aria-hidden="true" size={18} /><strong>Workflow</strong><small>Exact version pinned</small></li></ol>
      </section>

      <section className={styles.pluginRegistry} aria-labelledby="plugin-registry-title">
        <header><span>04 / REGISTRY PRACTICE</span><h2 id="plugin-registry-title">Extension without ambient trust.</h2></header>
        <div className={styles.registryShelf}><article><small>FIRST-PARTY</small><strong>Maintained with Sandbox</strong><span>VERIFIED</span></article><article><small>VERIFIED</small><strong>Publisher identity reviewed</strong><span>REVIEWED</span></article><article><small>COMMUNITY</small><strong>Manifest remains explicit</strong><span>DECLARED</span></article></div>
        <nav aria-label="Plugin documentation">{page.related.map((path, docIndex) => <a href={`https://docs.sndbox.app/${path}`} key={path}><span>0{docIndex + 1}</span><div><small>PLUGIN GUIDE</small><strong>{docLabel(path)}</strong></div><ArrowUpRight aria-hidden="true" size={14} /></a>)}</nav>
      </section>

      <ProductExit page={page} index={index} variant="plugins" />
    </div>
  );
}

function TeamsBody({ page, index }: BodyProps) {
  const permissions = [
    ["Builder", true, false, false, false],
    ["Reviewer", true, false, false, true],
    ["Operator", true, true, true, true],
    ["Admin", true, true, true, true],
  ] as const;

  return (
    <div className={styles.teamsBody} data-body="governance-ledger">
      <section id="product-proof" className={styles.permissionMatrix} aria-labelledby="permission-title">
        <header><DiscoverTag step="02" label="READ ACROSS A ROLE" tone="signal" /><h2 id="permission-title">Collaboration does not require universal control.</h2><p>Permission sets make authority legible before anyone publishes, opens a credential or changes a runner.</p></header>
        <div className={styles.tableWrap}><table><caption>Workspace role capability matrix</caption><thead><tr><th scope="col">ROLE</th><th scope="col">EDIT</th><th scope="col">PUBLISH</th><th scope="col">SECRETS</th><th scope="col">AUDIT</th></tr></thead><tbody>{permissions.map(([role, ...values]) => <tr key={role}><th scope="row"><Users aria-hidden="true" size={15} />{role}</th>{values.map((allowed, cellIndex) => <td key={cellIndex} data-allowed={allowed ? "true" : "false"}><span className={styles.srOnly}>{allowed ? "Allowed" : "Not allowed"}</span>{allowed ? <Check aria-hidden="true" size={14} /> : <X aria-hidden="true" size={13} />}</td>)}</tr>)}</tbody></table></div>
      </section>

      <section className={styles.approvalStory} aria-labelledby="approval-title">
        <div className={styles.approvalCopy}><DiscoverTag step="03" label="FOLLOW REVISION 18" tone="dark" /><h2 id="approval-title">A publication is a chain of named decisions.</h2><p>{page.proof}</p></div>
        <div className={styles.approvalLedger} role="group" aria-label="Revision 18 approval history"><header><span>REVISION / 18</span><strong>PRODUCTION REQUEST</strong><small>3 EVENTS</small></header><ol><li><time>09:12</time><UserCheck aria-hidden="true" size={15} /><div><small>MAYA / BUILDER</small><strong>Submitted revision</strong></div><span>RECORDED</span></li><li><time>09:31</time><FileCheck2 aria-hidden="true" size={15} /><div><small>NOAH / REVIEWER</small><strong>Approved change set</strong></div><span>APPROVED</span></li><li><time>09:34</time><ShieldCheck aria-hidden="true" size={15} /><div><small>POLICY ENGINE</small><strong>Production gate satisfied</strong></div><span>PUBLISHABLE</span></li></ol><footer><KeyRound aria-hidden="true" size={13} /> Credential access unchanged by publication.</footer></div>
      </section>

      <section className={styles.environmentScope} aria-labelledby="environment-title">
        <header><span>04 / CONNECTION SCOPE</span><h2 id="environment-title">Share the route. Separate the environments.</h2></header>
        <div>{["DEVELOPMENT", "STAGING", "PRODUCTION"].map((environment, environmentIndex) => <article key={environment} data-environment={environment.toLowerCase()}><header><span>0{environmentIndex + 1}</span><strong>{environment}</strong><small>{environmentIndex === 2 ? "2 APPROVERS" : "ROLE SCOPED"}</small></header><p>{environmentIndex === 0 ? "Builders can test with development-only connections." : environmentIndex === 1 ? "Reviewers validate the published candidate." : "Operators deploy without revealing credential values."}</p><footer><LockKeyhole aria-hidden="true" size={13} /> {environmentIndex + 2} scoped connections</footer></article>)}</div>
        <nav aria-label="Teams documentation">{page.related.map((path) => <a href={`https://docs.sndbox.app/${path}`} key={path}>{docLabel(path)}<ArrowUpRight aria-hidden="true" size={13} /></a>)}</nav>
      </section>

      <ProductExit page={page} index={index} variant="teams" />
    </div>
  );
}

function DevelopersBody({ page, index }: BodyProps) {
  const surfaces = [
    { method: "POST", path: "/v1/workflows/{id}/runs", label: "Start a versioned run", status: "202" },
    { method: "GET", path: "/v1/runs/{run_id}", label: "Read status and evidence", status: "200" },
    { method: "POST", path: "/v1/runners/pairing/challenges", label: "Begin signed runner pairing", status: "200" },
  ];

  return (
    <div className={styles.developersBody} data-body="developer-console">
      <section id="product-proof" className={styles.contractIndex} aria-labelledby="contract-title">
        <header><DiscoverTag step="02" label="OPEN A VERSIONED SURFACE" /><h2 id="contract-title">The public contract is part of the product.</h2><p>Clients, schemas, plugins and runners meet through explicit versioned surfaces that can be generated, validated and traced.</p></header>
        <div className={styles.endpointIndex}>
          <header><span>OPENAPI / V1</span><strong><Check aria-hidden="true" size={13} /> SPEC VALID</strong></header>
          {surfaces.map((surface, surfaceIndex) => <details key={surface.path} open={surfaceIndex === 0}><summary><span>{surface.method}</span><code>{surface.path}</code><strong>{surface.status}</strong><ChevronRight aria-hidden="true" size={14} /></summary><div><p>{surface.label}</p><code>{surfaceIndex === 0 ? '{ "workspaceId": "...", "deploymentId": "...", "encryptedPayloadReference": "object://..." }' : surfaceIndex === 1 ? '{ "status": "succeeded", "evidence": [...] }' : '{ "devicePublicKeyDerBase64": "...", "capabilities": {} }'}</code></div></details>)}
        </div>
      </section>

      <section className={styles.sdkWorkbench} aria-labelledby="sdk-title">
        <div className={styles.sdkCopy}><DiscoverTag step="03" label="TRACE TYPE TO RESPONSE" tone="dark" /><h2 id="sdk-title">Types carry intent from editor to runner.</h2><p>{page.proof}</p><Link href="/security">Read the protocol security model <ArrowRight aria-hidden="true" size={14} /></Link></div>
        <div className={styles.schemaCode} role="group" aria-label="Versioned workflow run schema"><header><span>workflow-run.schema.ts</span><small>contracts / v1</small></header><pre><code><span>export interface</span> WorkflowRun {'{'}
  id: <b>RunId</b>;
  revision: <strong>number</strong>;
  runnerPool: <strong>string</strong>;
  status: <b>RunStatus</b>;
  evidence: <b>EvidenceRef[]</b>;
{'}'}</code></pre><footer><Check aria-hidden="true" size={13} /> schema/v1 compatible</footer></div>
      </section>

      <section className={styles.developerSurfaces} aria-labelledby="surfaces-title">
        <header><span>04 / BUILDING SURFACES</span><h2 id="surfaces-title">Use code where code is the clearest interface.</h2></header>
        <div>{page.benefits.map((benefit, benefitIndex) => <article key={benefit.title}><span>0{benefitIndex + 1}</span>{benefitIndex === 0 ? <Braces aria-hidden="true" size={20} /> : benefitIndex === 1 ? <Code2 aria-hidden="true" size={20} /> : <Server aria-hidden="true" size={20} />}<h3>{benefit.title}</h3><p>{benefit.body}</p><code>{benefitIndex === 0 ? "@sandbox/plugin-sdk" : benefitIndex === 1 ? "openapi / v1" : "runner-protocol / v1"}</code></article>)}</div>
        <nav aria-label="Developer documentation">{page.related.map((path, docIndex) => <a href={`https://docs.sndbox.app/${path}`} key={path}><span>DOC / 0{docIndex + 1}</span><strong>{docLabel(path)}</strong><code>/{path}</code><ArrowUpRight aria-hidden="true" size={14} /></a>)}</nav>
      </section>

      <ProductExit page={page} index={index} variant="developers" />
    </div>
  );
}
