import Link from "next/link";
import {
  Activity,
  AppWindow,
  ArrowDown,
  ArrowRight,
  Box,
  Braces,
  Check,
  CircleDot,
  Code2,
  Cpu,
  Download,
  FileCheck2,
  FolderLock,
  GitBranch,
  HardDrive,
  KeyRound,
  MousePointer2,
  PackageCheck,
  Play,
  RefreshCcw,
  ScanLine,
  Server,
  ShieldCheck,
  SquareTerminal,
  UserCheck,
  Users,
  WifiOff,
} from "lucide-react";
import type { ProductPage } from "@sandbox/content";
import styles from "./ProductHeroes.module.css";

type ProductHeroProps = { page: ProductPage; index: number; chapter: string };

export function ProductHero(props: ProductHeroProps) {
  switch (props.page.slug) {
    case "local-automation":
      return <LocalProductHero {...props} />;
    case "browser-automation":
      return <BrowserProductHero {...props} />;
    case "always-on-execution":
      return <AlwaysOnProductHero {...props} />;
    case "plugins-marketplace":
      return <PluginsProductHero {...props} />;
    case "teams-governance":
      return <TeamsProductHero {...props} />;
    case "developers":
      return <DevelopersProductHero {...props} />;
    default:
      return <BuilderProductHero {...props} />;
  }
}

export function BuilderProductHero({ page, index, chapter }: ProductHeroProps) {
  return (
    <section className={styles.builderHero} data-hero="builder-canvas" aria-labelledby="product-title">
      <div className={styles.builderRail}>
        <span>PRODUCT / 0{index + 1}</span>
        <span>VISUAL WORKFLOW BUILDER</span>
        <small>CANVAS / DRAFT 018</small>
      </div>

      <div className={styles.builderHeading}>
        <div>
          <p><span />{page.eyebrow}</p>
          <h1 id="product-title"><span>Build the logic.</span><strong>See the consequences.</strong></h1>
        </div>
        <aside>
          <p>{page.summary}</p>
          <div>
            <Link href="/downloads">Download for free <ArrowRight aria-hidden="true" size={15} /></Link>
            <a href="#product-proof">Inspect the canvas <ArrowDown aria-hidden="true" size={13} /></a>
          </div>
          <small><ShieldCheck aria-hidden="true" size={12} /> {chapter}</small>
        </aside>
      </div>

      <div className={styles.builderWorkspace} role="group" aria-label="Visual workflow builder canvas">
        <header>
          <div><i /><span>MORNING REPORT / DRAFT</span></div>
          <div className={styles.builderViewTabs} aria-hidden="true"><span>BUILD</span><small>TEST</small><small>VERSIONS</small></div>
          <strong><Play aria-hidden="true" size={11} fill="currentColor" /> TEST ROUTE</strong>
        </header>

        <aside className={styles.nodeLibrary}>
          <h2>NODE LIBRARY</h2>
          <p><MousePointer2 aria-hidden="true" size={13} /><span><small>TRIGGER</small>Manual input</span></p>
          <p><GitBranch aria-hidden="true" size={13} /><span><small>LOGIC</small>Condition</span></p>
          <p><ScanLine aria-hidden="true" size={13} /><span><small>OUTPUT</small>Evidence</span></p>
          <footer>42 typed nodes</footer>
        </aside>

        <div className={styles.builderCanvas}>
          <span className={styles.canvasGrid} aria-hidden="true" />
          <div className={styles.builderNode} data-kind="trigger">
            <header><span>01</span><CircleDot aria-hidden="true" size={13} /></header>
            <small>TRIGGER</small><strong>Weekday / 08:00</strong><code>schedule_01</code>
          </div>
          <i className={styles.builderWire} aria-hidden="true" />
          <div className={styles.builderNode} data-kind="logic">
            <header><span>02</span><GitBranch aria-hidden="true" size={13} /></header>
            <small>CONDITION</small><strong>Rows &gt; 0</strong><code>boolean</code>
          </div>
          <i className={styles.builderWire} aria-hidden="true" />
          <div className={styles.builderNode} data-kind="result">
            <header><span>03</span><Check aria-hidden="true" size={13} /></header>
            <small>RESULT</small><strong>Attach evidence</strong><code>report.csv</code>
          </div>
          <div className={styles.canvasStatus}><i /> CONNECTION TYPES VALID</div>
        </div>

        <aside className={styles.builderInspector}>
          <header><span>INSPECTOR</span><small>NODE / 02</small></header>
          <h2>Condition</h2>
          <dl>
            {page.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
          </dl>
        </aside>

        <a className={styles.builderDiscover} href="#product-proof">
          <span>DISCOVER</span><small>Trace the typed route</small><ArrowDown aria-hidden="true" size={13} />
        </a>
      </div>
    </section>
  );
}

function LocalProductHero({ page, index, chapter }: ProductHeroProps) {
  return (
    <section className={styles.localHero} data-hero="local-boundary" aria-labelledby="product-title">
      <div className={styles.localCopy}>
        <div className={styles.localRail}>
          <span>PRODUCT / 0{index + 1}</span>
          <small>OFF-CLOUD OPERATING ZONE</small>
        </div>
        <p className={styles.localEyebrow}><HardDrive aria-hidden="true" size={13} /> {page.eyebrow}</p>
        <h1 id="product-title"><span>The cloud</span><i>ends here.</i><strong>The workflow doesn&apos;t.</strong></h1>
        <p className={styles.localSummary}>{page.summary}</p>
        <div className={styles.localActions}>
          <Link href="/downloads">Run on this machine <ArrowRight aria-hidden="true" size={15} /></Link>
          <a href="#product-proof">Inspect the boundary <ArrowDown aria-hidden="true" size={13} /></a>
        </div>
        <small className={styles.localAssurance}><ShieldCheck aria-hidden="true" size={12} /> {chapter}</small>
      </div>

      <div className={styles.localMap} role="group" aria-label="Local machine access boundary">
        <div className={styles.localMapHead}>
          <span>THIS MACHINE / TRUST BOUNDARY</span>
          <small><i /> LOCAL RUNNER ONLINE</small>
        </div>
        <div className={styles.localDevice}>
          <header>
            <span><Cpu aria-hidden="true" size={15} /> WORKSTATION / CHRIS-01</span>
            <small>NO TASK RELAY</small>
          </header>
          <div className={styles.localAccessList}>
            <div><span><FolderLock aria-hidden="true" size={16} /> APPROVED ROOT</span><code>C:\Approved\Invoices</code><Check aria-hidden="true" size={13} /></div>
            <div><span><SquareTerminal aria-hidden="true" size={16} /> EXECUTABLE</span><code>powershell.exe</code><Check aria-hidden="true" size={13} /></div>
            <div><span><WifiOff aria-hidden="true" size={16} /> PRIVATE API</span><code>10.0.0.18 / reports</code><Check aria-hidden="true" size={13} /></div>
          </div>
          <footer>
            <span><KeyRound aria-hidden="true" size={13} /> OS VAULT</span>
            <span><HardDrive aria-hidden="true" size={13} /> LOCAL HISTORY</span>
          </footer>
        </div>
        <div className={styles.localOutside} aria-hidden="true">
          <span>PUBLIC CLOUD</span><i /><small>WORKFLOW DATA DOES NOT CROSS</small>
        </div>
        <a className={styles.localDiscover} href="#product-proof">
          <span>DISCOVER</span><small>Follow an approved action</small><ArrowDown aria-hidden="true" size={13} />
        </a>
      </div>
    </section>
  );
}

function BrowserProductHero({ page, index, chapter }: ProductHeroProps) {
  const steps = ["Navigate /reports", "Select current month", "Download CSV", "Attach evidence"];

  return (
    <section className={styles.browserHero} data-hero="browser-recorder" aria-labelledby="product-title">
      <header className={styles.browserIntro}>
        <div className={styles.browserChapter}>
          <span>0{index + 1}</span><small>PRODUCT<br />BROWSER / RECORDER</small>
        </div>
        <div className={styles.browserTitle}>
          <p><AppWindow aria-hidden="true" size={13} /> {page.eyebrow}</p>
          <h1 id="product-title"><span>Record what you do.</span><strong>Edit what runs.</strong></h1>
        </div>
        <div className={styles.browserCopy}>
          <p>{page.summary}</p>
          <div>
            <Link href="/downloads">Start recording <ArrowRight aria-hidden="true" size={15} /></Link>
            <a href="#product-proof">See editable steps <ArrowDown aria-hidden="true" size={13} /></a>
          </div>
          <small><ShieldCheck aria-hidden="true" size={12} /> {chapter}</small>
        </div>
      </header>

      <div className={styles.browserStage} role="group" aria-label="Browser recorder turning a routine into editable steps">
        <div className={styles.browserWindow}>
          <header>
            <div><i /><i /><i /></div>
            <span><ShieldCheck aria-hidden="true" size={11} /> reports.internal / monthly</span>
            <small>MANAGED PROFILE / FINANCE</small>
          </header>
          <div className={styles.browserViewport}>
            <aside><b>ACME</b><span>Overview</span><span className={styles.browserActive}>Reports</span><span>Exports</span><span>Settings</span></aside>
            <div className={styles.browserDocument}>
              <header><div><small>REPORTING</small><strong>Monthly activity</strong></div><span className={styles.browserExport}>Export CSV</span></header>
              <div className={styles.browserChart} aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
              <div className={styles.browserRows}><span /><span /><span /></div>
              <MousePointer2 className={styles.browserCursor} aria-hidden="true" size={23} />
              <span className={styles.browserTarget} aria-hidden="true">REC 03</span>
            </div>
          </div>
        </div>

        <div className={styles.recorderDock}>
          <header><span><i /> RECORDING</span><strong>00:18</strong><small>4 EDITABLE NODES</small></header>
          <ol>
            {steps.map((step, stepIndex) => (
              <li key={step} data-active={stepIndex === 2 ? "true" : undefined}>
                <span>0{stepIndex + 1}</span>
                {stepIndex === 2 ? <Download aria-hidden="true" size={14} /> : <CircleDot aria-hidden="true" size={12} />}
                <strong>{step}</strong>
                <small>{stepIndex <= 2 ? "CAPTURED" : "NEXT"}</small>
              </li>
            ))}
          </ol>
        </div>

        <a className={styles.browserDiscover} href="#product-proof">
          <span>DISCOVER</span><small>Open the recorded route</small><ArrowDown aria-hidden="true" size={13} />
        </a>
      </div>
    </section>
  );
}

function AlwaysOnProductHero({ page, index, chapter }: ProductHeroProps) {
  const runners = [
    { name: "HOSTED / 01", type: "ISOLATED", load: "38%", state: "ACTIVE" },
    { name: "LINUX / X64", type: "SELF-HOSTED", load: "62%", state: "ACTIVE" },
    { name: "NAS / HOME", type: "PRIVATE POOL", load: "12%", state: "READY" },
    { name: "ARM64 / EDGE", type: "REMOTE", load: "24%", state: "READY" },
  ];

  return (
    <section className={styles.alwaysHero} data-hero="runner-fleet" aria-labelledby="product-title">
      <div className={styles.alwaysSignal}>
        <span>PRODUCT / 0{index + 1}</span><strong><Activity aria-hidden="true" size={13} /> FLEET HEARTBEAT / LIVE</strong><small>CONTROL PLANE / UTC</small>
      </div>
      <div className={styles.alwaysLead}>
        <div>
          <p>{page.eyebrow}</p>
          <h1 id="product-title"><span>Ship the route.</span><strong>Keep the pulse.</strong></h1>
        </div>
        <aside>
          <p>{page.summary}</p>
          <div><Link href="/downloads">Deploy a runner <ArrowRight aria-hidden="true" size={15} /></Link><a href="#product-proof">Inspect the fleet <ArrowDown aria-hidden="true" size={13} /></a></div>
          <small><RefreshCcw aria-hidden="true" size={12} /> {chapter}</small>
        </aside>
      </div>

      <div className={styles.fleetBoard} role="group" aria-label="Durable workflow runner fleet">
        <header>
          <div><span>PUBLISHED ROUTE / REPORT_018</span><small>POOL: PRODUCTION</small></div>
          <strong><i /> LEASED TO RUNNER_02</strong>
        </header>
        <ol>
          {runners.map((runner, runnerIndex) => (
            <li key={runner.name} data-current={runnerIndex === 1 ? "true" : undefined}>
              <header><span>0{runnerIndex + 1}</span><Server aria-hidden="true" size={15} /><small>{runner.state}</small></header>
              <strong>{runner.name}</strong><p>{runner.type}</p>
              <div><span style={{ "--load": runner.load } as React.CSSProperties} /><small>CAPACITY {runner.load}</small></div>
              <footer><i /><i /><i /><i /><i /><i /></footer>
            </li>
          ))}
        </ol>
        <div className={styles.fleetRoute} aria-hidden="true"><span>CHECKPOINT / 03</span><i /><strong>RECOVERY READY</strong></div>
        <a className={styles.alwaysDiscover} href="#product-proof"><span>DISCOVER</span><small>Trace one durable run</small><ArrowDown aria-hidden="true" size={13} /></a>
      </div>
    </section>
  );
}

function PluginsProductHero({ page, index, chapter }: ProductHeroProps) {
  return (
    <section className={styles.pluginsHero} data-hero="plugin-manifest" aria-labelledby="product-title">
      <div className={styles.pluginsIndex}><span>PRODUCT / 0{index + 1}</span><strong>PACKAGE REVIEW DESK</strong><small>REGISTRY / VERIFIED</small></div>
      <div className={styles.pluginsLead}>
        <p><PackageCheck aria-hidden="true" size={14} /> {page.eyebrow}</p>
        <h1 id="product-title"><span>Permission</span><em>before</em><strong>installation.</strong></h1>
        <div className={styles.pluginsSummary}>
          <p>{page.summary}</p>
          <div><Link href="/downloads">Browse verified plugins <ArrowRight aria-hidden="true" size={15} /></Link><a href="#product-proof">Read a manifest <ArrowDown aria-hidden="true" size={13} /></a></div>
          <small><ShieldCheck aria-hidden="true" size={12} /> {chapter}</small>
        </div>
      </div>

      <div className={styles.packageDesk} role="group" aria-label="Plugin package and permission manifest">
        <article className={styles.packageBlock}>
          <header><Box aria-hidden="true" size={18} /><span>VERIFIED PACKAGE</span><small>01 / 01</small></header>
          <div><b>SBX</b><strong>CSV<br />TOOLKIT</strong><span>v2.4.1</span></div>
          <footer><PackageCheck aria-hidden="true" size={13} /> SIGNATURE VALID</footer>
        </article>
        <article className={styles.manifestSheet}>
          <header><span>CAPABILITY MANIFEST</span><small>sandbox.plugin.json</small></header>
          <div className={styles.manifestIdentity}><span>PUBLISHER</span><strong>Northstar Labs / verified</strong><i>NL</i></div>
          <ol>
            <li><span><FileCheck2 aria-hidden="true" size={14} /> READ FILE</span><code>selected input only</code><Check aria-hidden="true" size={13} /></li>
            <li><span><HardDrive aria-hidden="true" size={14} /> WRITE FILE</span><code>approved output root</code><Check aria-hidden="true" size={13} /></li>
            <li><span><WifiOff aria-hidden="true" size={14} /> NETWORK</span><code>none requested</code><Check aria-hidden="true" size={13} /></li>
          </ol>
          <footer><strong>INTEGRITY / SHA256</strong><code>7c9a...42ef</code><span>PINNED</span></footer>
        </article>
        <div className={styles.packageTape} aria-hidden="true">REVIEW • PIN • INSTALL • REVIEW • PIN • INSTALL</div>
        <a className={styles.pluginsDiscover} href="#product-proof"><span>DISCOVER</span><small>Inspect requested capabilities</small><ArrowDown aria-hidden="true" size={13} /></a>
      </div>
    </section>
  );
}

function TeamsProductHero({ page, index, chapter }: ProductHeroProps) {
  const lanes = [
    { role: "BUILDER", person: "MAYA", action: "Draft revision 18", state: "DONE" },
    { role: "REVIEWER", person: "NOAH", action: "Inspect changes", state: "APPROVED" },
    { role: "OPERATOR", person: "INES", action: "Publish to production", state: "READY" },
  ];

  return (
    <section className={styles.teamsHero} data-hero="governance-ledger" aria-labelledby="product-title">
      <div className={styles.teamsLead}>
        <div className={styles.teamsKicker}><span>PRODUCT / 0{index + 1}</span><small>AUTHORITY MAP / WORKSPACE 04</small></div>
        <p><Users aria-hidden="true" size={14} /> {page.eyebrow}</p>
        <h1 id="product-title"><span>Move work</span><i>forward.</i><strong>Keep authority separated.</strong></h1>
        <div className={styles.teamsSummary}>
          <p>{page.summary}</p>
          <div><Link href="/downloads">Create a workspace <ArrowRight aria-hidden="true" size={15} /></Link><a href="#product-proof">Follow an approval <ArrowDown aria-hidden="true" size={13} /></a></div>
          <small><ShieldCheck aria-hidden="true" size={12} /> {chapter}</small>
        </div>
      </div>

      <div className={styles.governanceBoard} role="group" aria-label="Workflow publication approval lanes">
        <header><span>REVISION / 18</span><strong>MORNING REPORT</strong><small>PRODUCTION GATE</small></header>
        <div className={styles.governanceStages}><span>01 / DRAFT</span><span>02 / REVIEW</span><span>03 / PUBLISH</span></div>
        <ol>
          {lanes.map((lane, laneIndex) => (
            <li key={lane.role}>
              <header><span>0{laneIndex + 1}</span><strong>{lane.role}</strong><small>{lane.person}</small></header>
              <div data-stage={laneIndex + 1}><UserCheck aria-hidden="true" size={15} /><span>{lane.action}</span><small>{lane.state}</small></div>
              <i aria-hidden="true" />
            </li>
          ))}
        </ol>
        <aside><FileCheck2 aria-hidden="true" size={20} /><span>APPROVAL RECEIPT</span><strong>2 / 2 policies satisfied</strong><small>Credential access unchanged</small></aside>
        <a className={styles.teamsDiscover} href="#product-proof"><span>DISCOVER</span><small>Inspect the decision trail</small><ArrowDown aria-hidden="true" size={13} /></a>
      </div>
    </section>
  );
}

function DevelopersProductHero({ page, index, chapter }: ProductHeroProps) {
  return (
    <section className={styles.developersHero} data-hero="developer-console" aria-labelledby="product-title">
      <div className={styles.devConsole} role="group" aria-label="Typed developer API request and response">
        <header><span><i /><i /><i /> sandbox / api</span><small>v1 / TYPESCRIPT</small></header>
        <div className={styles.devTabs}><span>create-run.ts</span><small>workflow.schema.json</small><small>runner.log</small></div>
        <pre aria-label="TypeScript API example"><code><span>import</span> {'{ Sandbox }'} <span>from</span> <b>&quot;@sandbox/sdk&quot;</b>;

<em>const</em> client = <span>new</span> Sandbox({'{'}
  token: process.env.SANDBOX_TOKEN
{'}'});

<em>const</em> run = <span>await</span> client.workflows.run({'{'}
  workflow: <b>&quot;morning-report&quot;</b>,
  revision: <strong>18</strong>,
  runnerPool: <b>&quot;production&quot;</b>
{'}'});</code></pre>
        <div className={styles.devResponse}><span><Check aria-hidden="true" size={13} /> 202 ACCEPTED</span><code>run_01J8K7 • schema/v1</code><small>184 ms</small></div>
        <a className={styles.devDiscover} href="#product-proof"><span>DISCOVER</span><small>Inspect the typed contract</small><ArrowDown aria-hidden="true" size={13} /></a>
      </div>

      <div className={styles.devLead}>
        <div className={styles.devIndex}><span>PRODUCT / 0{index + 1}</span><small>DEVELOPER INTERFACE</small></div>
        <p><Braces aria-hidden="true" size={14} /> {page.eyebrow}</p>
        <h1 id="product-title"><span>Code,</span><strong>without the hidden contract.</strong></h1>
        <p className={styles.devSummary}>{page.summary}</p>
        <div className={styles.devActions}><Link href="/downloads">Get the developer tools <ArrowRight aria-hidden="true" size={15} /></Link><a href="#product-proof">Explore the contract <ArrowDown aria-hidden="true" size={13} /></a></div>
        <small className={styles.devAssurance}><Code2 aria-hidden="true" size={12} /> {chapter}</small>
        <dl>{page.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
      </div>
    </section>
  );
}
