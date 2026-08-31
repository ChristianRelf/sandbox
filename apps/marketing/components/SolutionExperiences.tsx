import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Cloud,
  Code2,
  Download,
  FileCheck2,
  FileDown,
  FolderInput,
  FolderLock,
  GitBranch,
  Globe2,
  HardDrive,
  HousePlug,
  MonitorCheck,
  MoveRight,
  Network,
  Play,
  ScanSearch,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useCases } from "@sandbox/content";
import styles from "./SolutionExperiences.module.css";

type UseCase = (typeof useCases)[number];

const solutionOrder = [
  ["browser-automation", "Browser routine"],
  ["file-folder-automation", "File and folder automation"],
  ["website-monitoring", "Website monitoring"],
  ["report-collection", "Report collection"],
  ["developer-workflows", "Developer workflows"],
  ["homelab-automation", "Homelab automation"],
] as const;

const solutionSteps: Record<string, string[]> = {
  "browser-automation": ["Schedule", "Open browser", "Navigate", "Download file", "Condition", "Notification"],
  "file-folder-automation": ["File watch", "Condition", "Move file", "Notification"],
  "website-monitoring": ["Schedule", "HTTP request", "Condition", "Discord webhook"],
  "report-collection": ["Schedule", "Open browser", "Download", "Extract data", "Condition", "Slack webhook"],
  "developer-workflows": ["Manual trigger", "Run command", "HTTP request", "Condition", "Notification"],
  "homelab-automation": ["Schedule", "HTTP request", "Condition", "Discord webhook"],
};

function nextSolution(slug: string) {
  const index = Math.max(solutionOrder.findIndex(([candidate]) => candidate === slug), 0);
  const [nextSlug, label] = solutionOrder[(index + 1) % solutionOrder.length];
  return { href: `/solutions/${nextSlug}`, label };
}

function BrowserRoutine({ item }: { item: UseCase }) {
  const next = nextSolution(item.slug);
  const steps = solutionSteps[item.slug];
  return (
    <main id="content" className={`${styles.solutionPage} ${styles.browserRoutine}`}>
      <section className={styles.browserRoutineHero} aria-labelledby="solution-title">
        <div className={styles.browserRoutineCopy}>
          <p><Globe2 aria-hidden="true" size={16} /> Browser routine</p>
          <h1 id="solution-title">{item.title}</h1>
          <p>{item.problem}</p>
          <div>
            <Link href={`/templates/${item.slug}`}>View the real template <ArrowRight aria-hidden="true" size={15} /></Link>
            <Link href="/product/browser-automation">Browser product details</Link>
          </div>
        </div>
        <div className={styles.browserRoute} aria-label="Browser workflow route">
          <header><CircleDot aria-hidden="true" size={14} /><span>Inspectable route</span></header>
          <ol>
            {steps.map((step, index) => (
              <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>{index < steps.length - 1 && <ArrowDown aria-hidden="true" size={14} />}</li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.browserCapture} aria-labelledby="browser-capture-title">
        <header>
          <p>Recorder to workflow</p>
          <h2 id="browser-capture-title">Capture the routine once. Keep the pieces editable.</h2>
          <p>The recorder turns browser behaviour into the same ordinary nodes used everywhere else on the canvas.</p>
        </header>
        <div className={styles.browserCaptureSurface}>
          <div className={styles.capturedActions}>
            <span>Captured behaviour</span>
            <p><Globe2 aria-hidden="true" size={16} /><strong>Navigation</strong><small>Target page</small></p>
            <p><CircleDot aria-hidden="true" size={16} /><strong>Interaction</strong><small>Semantic locator</small></p>
            <p><Download aria-hidden="true" size={16} /><strong>Download</strong><small>Approved folder</small></p>
          </div>
          <div className={styles.captureHandoff}><ArrowRight aria-hidden="true" size={20} /><span>Recorder output</span></div>
          <div className={styles.editableActions}>
            <span>Editable workflow nodes</span>
            <article><Globe2 aria-hidden="true" size={17} /><div><strong>Navigate</strong><small>URL and wait condition remain visible</small></div><Check aria-hidden="true" size={14} /></article>
            <article><Download aria-hidden="true" size={17} /><div><strong>Download File</strong><small>Folder and size controls remain visible</small></div><Check aria-hidden="true" size={14} /></article>
            <article><GitBranch aria-hidden="true" size={17} /><div><strong>Condition</strong><small>The branch stays explicit on the canvas</small></div><Check aria-hidden="true" size={14} /></article>
          </div>
        </div>
      </section>

      <section className={styles.browserRoutineEvidence} aria-labelledby="browser-evidence-title">
        <div>
          <p>What the workflow needs</p>
          <h2 id="browser-evidence-title">A browser profile, a destination, and named domains.</h2>
        </div>
        <dl>
          <div><dt>Runs on</dt><dd>{item.target}</dd></div>
          <div><dt>Setup</dt><dd>{item.difficulty}</dd></div>
          <div><dt>Permissions</dt><dd>{item.permissions}</dd></div>
        </dl>
      </section>

      <section className={styles.browserFailureShowcase} aria-labelledby="browser-failure-title">
        <header><span>When a page changes</span><h2 id="browser-failure-title">The failure keeps enough evidence to investigate.</h2></header>
        <div>
          <article><ScanSearch aria-hidden="true" size={21} /><span>Locator</span><h3>See which semantic locator failed.</h3></article>
          <article><MonitorCheck aria-hidden="true" size={21} /><span>Screenshot</span><h3>Preserve a bounded view of the failed page.</h3></article>
          <article><ShieldCheck aria-hidden="true" size={21} /><span>Protected fields</span><h3>Exclude protected field values from diagnostics.</h3></article>
        </div>
      </section>

      <section className={styles.browserRoutineResult}>
        <div><Download aria-hidden="true" size={24} /><span>Expected result</span></div>
        <p>{item.result}</p>
        <Link href={next.href}><span>Next solution</span>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

function FileFolderRoutine({ item }: { item: UseCase }) {
  const next = nextSolution(item.slug);
  const steps = solutionSteps[item.slug];
  return (
    <main id="content" className={`${styles.solutionPage} ${styles.fileRoutine}`}>
      <section className={styles.fileHero} aria-labelledby="solution-title">
        <div className={styles.fileHeroCopy}>
          <p><FolderInput aria-hidden="true" size={16} /> File and folder automation</p>
          <h1 id="solution-title">{item.title}</h1>
          <p>{item.problem}</p>
        </div>
        <figure className={styles.folderStack}>
          <figcaption>Approved local folders</figcaption>
          <div><FolderLock aria-hidden="true" size={23} /><strong>Incoming</strong><small>Watched folder</small></div>
          <MoveRight aria-hidden="true" size={19} />
          <div><FileCheck2 aria-hidden="true" size={23} /><strong>Organised</strong><small>Matching files only</small></div>
        </figure>
      </section>

      <section className={styles.fileDecisionSurface} aria-labelledby="file-decision-title">
        <div className={styles.fileDecisionCopy}>
          <p>Move only what matches</p>
          <h2 id="file-decision-title">The condition sits between detection and movement.</h2>
          <p>A watched file becomes workflow input. The visible condition decides whether the Move File node runs.</p>
        </div>
        <div className={styles.fileDecisionMap} aria-label="File matching decision">
          <div className={styles.fileDetected}><FolderInput aria-hidden="true" size={19} /><span>File watch</span><strong>Detected file</strong></div>
          <ArrowRight aria-hidden="true" size={18} />
          <div className={styles.fileCondition}><GitBranch aria-hidden="true" size={19} /><span>Condition</span><strong>Does it match?</strong></div>
          <div className={styles.fileBranches}>
            <p><span>Matches</span><MoveRight aria-hidden="true" size={15} /><strong>Move file</strong></p>
            <p><span>Does not match</span><CircleDot aria-hidden="true" size={12} /><strong>No move</strong></p>
          </div>
        </div>
      </section>

      <section className={styles.fileSequence} aria-labelledby="file-sequence-title">
        <header>
          <span>Local workflow</span>
          <h2 id="file-sequence-title">Watch. Decide. Move. Report.</h2>
        </header>
        <ol>
          {steps.map((step, index) => <li key={step}><span>{index + 1}</span><strong>{step}</strong>{index < steps.length - 1 && <ChevronRight aria-hidden="true" size={15} />}</li>)}
        </ol>
      </section>

      <section className={styles.fileBoundary}>
        <div>
          <ShieldCheck aria-hidden="true" size={22} />
          <h2>The files do not need to leave the machine.</h2>
          <p>{item.result}</p>
        </div>
        <dl>
          <div><dt>Execution target</dt><dd>{item.target}</dd></div>
          <div><dt>Permission boundary</dt><dd>{item.permissions}</dd></div>
          <div><dt>Setup</dt><dd>{item.difficulty}</dd></div>
        </dl>
      </section>

      <section className={styles.fileHistory} aria-labelledby="file-history-title">
        <header><span>Inspectable local run</span><h2 id="file-history-title">The movement leaves a readable history.</h2></header>
        <div>
          <p><span>01</span><FolderInput aria-hidden="true" size={17} /><strong>File detected</strong><small>The watched root produced an input.</small></p>
          <p><span>02</span><GitBranch aria-hidden="true" size={17} /><strong>Condition evaluated</strong><small>The matching decision remains visible.</small></p>
          <p><span>03</span><MoveRight aria-hidden="true" size={17} /><strong>File moved</strong><small>The action appears in run history.</small></p>
          <p><span>04</span><Bell aria-hidden="true" size={17} /><strong>Notification sent</strong><small>The final node reports the result.</small></p>
        </div>
      </section>

      <section className={styles.fileActions}>
        <Link href={`/templates/${item.slug}`}>Review the template <ArrowRight aria-hidden="true" size={15} /></Link>
        <Link href={next.href}><span>Continue to</span>{next.label}<ArrowUpRight aria-hidden="true" size={15} /></Link>
      </section>
    </main>
  );
}

function WebsiteMonitor({ item }: { item: UseCase }) {
  const next = nextSolution(item.slug);
  const steps = solutionSteps[item.slug];
  return (
    <main id="content" className={`${styles.solutionPage} ${styles.monitorRoutine}`}>
      <section className={styles.monitorHero} aria-labelledby="solution-title">
        <div className={styles.monitorSignal} aria-hidden="true"><i /><i /><i /><MonitorCheck size={34} /></div>
        <div className={styles.monitorHeroCopy}>
          <p><MonitorCheck aria-hidden="true" size={16} /> Website monitoring</p>
          <h1 id="solution-title">{item.title}</h1>
          <p>{item.problem}</p>
          <Link href={`/templates/${item.slug}`}>Inspect the monitor template <ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      </section>

      <section className={styles.monitorLoop} aria-labelledby="monitor-loop-title">
        <header><span>Repeatable check</span><h2 id="monitor-loop-title">Signal only when the condition says it matters.</h2></header>
        <div>
          {steps.map((step, index) => (
            <article key={step}><span>{index + 1}</span>{index === 0 ? <Clock3 aria-hidden="true" size={19} /> : index === 1 ? <Network aria-hidden="true" size={19} /> : index === 2 ? <GitBranch aria-hidden="true" size={19} /> : <Bell aria-hidden="true" size={19} />}<strong>{step}</strong></article>
          ))}
        </div>
      </section>

      <section className={styles.monitorDecision} aria-labelledby="monitor-decision-title">
        <header>
          <p>Condition-led notification</p>
          <h2 id="monitor-decision-title">A check does not have to become an alert.</h2>
        </header>
        <div className={styles.monitorDecisionMap}>
          <div><Network aria-hidden="true" size={20} /><span>HTTP response</span><strong>Structured result</strong></div>
          <ArrowRight aria-hidden="true" size={18} />
          <div><GitBranch aria-hidden="true" size={20} /><span>Condition</span><strong>Meaningful status change?</strong></div>
          <div className={styles.monitorBranches}>
            <p><i>True</i><Bell aria-hidden="true" size={17} /><strong>Send Discord webhook</strong></p>
            <p><i>False</i><CircleDot aria-hidden="true" size={13} /><strong>No notification</strong></p>
          </div>
        </div>
      </section>

      <section className={styles.monitorFacts}>
        <div><span>Runs on</span><strong>{item.target}</strong></div>
        <div><span>Permissions</span><strong>{item.permissions}</strong></div>
        <div><span>Result</span><strong>{item.result}</strong></div>
        <div><span>Setup</span><strong>{item.difficulty}</strong></div>
      </section>

      <section className={styles.monitorTargets} aria-labelledby="monitor-targets-title">
        <header><span>Choose where the check runs</span><h2 id="monitor-targets-title">The same visible route can sit beside the target or stay awake elsewhere.</h2></header>
        <div>
          <article><HardDrive aria-hidden="true" size={21} /><h3>Local</h3><p>Run from the machine that can reach the page.</p></article>
          <article><Cloud aria-hidden="true" size={21} /><h3>Hosted</h3><p>Keep a public-page schedule on managed infrastructure.</p></article>
          <article><Server aria-hidden="true" size={21} /><h3>Self-hosted</h3><p>Place the check inside infrastructure you control.</p></article>
        </div>
      </section>

      <section className={styles.monitorNext}>
        <Link href="/product/always-on-execution">Keep the schedule awake <ArrowUpRight aria-hidden="true" size={15} /></Link>
        <Link href={next.href}><span>Next solution</span>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

function ReportCollection({ item }: { item: UseCase }) {
  const next = nextSolution(item.slug);
  const steps = solutionSteps[item.slug];
  return (
    <main id="content" className={`${styles.solutionPage} ${styles.reportRoutine}`}>
      <section className={styles.reportHero} aria-labelledby="solution-title">
        <div className={styles.reportTime}><Clock3 aria-hidden="true" size={18} /><span>Before the workday</span><i aria-hidden="true" /></div>
        <h1 id="solution-title">{item.title}</h1>
        <div className={styles.reportHeroFoot}>
          <p>{item.problem}</p>
          <Link href={`/templates/${item.slug}`}>View report template <ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      </section>

      <section className={styles.reportCollectionBoard} aria-labelledby="report-board-title">
        <header>
          <span>One collection, three phases</span>
          <h2 id="report-board-title">Acquire the file. Verify the contents. Deliver the signal.</h2>
        </header>
        <div>
          <article>
            <span>Acquire</span>
            <Globe2 aria-hidden="true" size={23} />
            <h3>Open browser and download</h3>
            <p>The managed profile and approved download folder stay explicit.</p>
          </article>
          <article>
            <span>Verify</span>
            <ScanSearch aria-hidden="true" size={23} />
            <h3>Extract data and evaluate</h3>
            <p>The condition checks whether the downloaded result is usable.</p>
          </article>
          <article>
            <span>Deliver</span>
            <Bell aria-hidden="true" size={23} />
            <h3>Send the Slack webhook</h3>
            <p>The notification comes after collection and verification.</p>
          </article>
        </div>
      </section>

      <section className={styles.reportTimeline} aria-labelledby="report-timeline-title">
        <header><p>Collection route</p><h2 id="report-timeline-title">The report passes through six visible decisions.</h2></header>
        <ol>
          {steps.map((step, index) => (
            <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><i aria-hidden="true" /><strong>{step}</strong></li>
          ))}
        </ol>
      </section>

      <section className={styles.reportDelivery}>
        <div className={styles.reportResult}><FileDown aria-hidden="true" size={28} /><span>Expected delivery</span><p>{item.result}</p></div>
        <div className={styles.reportSpecs}>
          <p><span>Target</span>{item.target}</p>
          <p><span>Permissions</span>{item.permissions}</p>
          <p><span>Setup</span>{item.difficulty}</p>
        </div>
      </section>

      <section className={styles.reportEvidence} aria-labelledby="report-evidence-title">
        <div>
          <p>Two useful endings</p>
          <h2 id="report-evidence-title">A verified report—or evidence of why collection stopped.</h2>
        </div>
        <div className={styles.reportOutcomePair}>
          <article><FileCheck2 aria-hidden="true" size={22} /><span>Collection succeeds</span><h3>Verified report ready</h3><p>The file reaches the expected download folder before notification.</p></article>
          <article><MonitorCheck aria-hidden="true" size={22} /><span>Collection fails</span><h3>Failure evidence retained</h3><p>The execution can preserve a screenshot and bounded browser diagnostics.</p></article>
        </div>
      </section>

      <section className={styles.reportNext}>
        <p>From scheduled reports to toolchain routines.</p>
        <Link href={next.href}>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

function DeveloperRoutine({ item }: { item: UseCase }) {
  const next = nextSolution(item.slug);
  const steps = solutionSteps[item.slug];
  return (
    <main id="content" className={`${styles.solutionPage} ${styles.devRoutine}`}>
      <section className={styles.devHero} aria-labelledby="solution-title">
        <div className={styles.devPrompt}><Terminal aria-hidden="true" size={16} /><code>workflow.run --reviewed</code></div>
        <h1 id="solution-title">{item.title}</h1>
        <div className={styles.devIntro}>
          <p>{item.problem}</p>
          <Link href={`/templates/${item.slug}`}>Open workflow definition <ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      </section>

      <section className={styles.devControlSurface} aria-labelledby="dev-control-title">
        <header>
          <p>Review before execution</p>
          <h2 id="dev-control-title">The command boundary is configuration, not hidden shell text.</h2>
        </header>
        <div className={styles.devPermissionSpec}>
          <div><span>Executable</span><strong>Explicitly approved</strong><Check aria-hidden="true" size={15} /></div>
          <div><span>Arguments</span><strong>Structured argument array</strong><Check aria-hidden="true" size={15} /></div>
          <div><span>Working directory</span><strong>Reviewed location</strong><Check aria-hidden="true" size={15} /></div>
          <div><span>HTTP target</span><strong>Approved API domain</strong><Check aria-hidden="true" size={15} /></div>
        </div>
      </section>

      <section className={styles.devPipeline} aria-labelledby="dev-pipeline-title">
        <header><span>Visible pipeline</span><h2 id="dev-pipeline-title">Keep the tools. Make their hand-offs inspectable.</h2></header>
        <div>
          {steps.map((step, index) => <article key={step}><span>{index + 1}</span>{index === 0 ? <Play aria-hidden="true" size={18} /> : index === 1 ? <Terminal aria-hidden="true" size={18} /> : index === 2 ? <Network aria-hidden="true" size={18} /> : index === 3 ? <GitBranch aria-hidden="true" size={18} /> : <Bell aria-hidden="true" size={18} />}<strong>{step}</strong></article>)}
        </div>
      </section>

      <section className={styles.devReview}>
        <div><ShieldCheck aria-hidden="true" size={22} /><h2>Approval stays explicit.</h2><p>{item.permissions}</p></div>
        <dl>
          <div><dt>Runs on</dt><dd>{item.target}</dd></div>
          <div><dt>Setup</dt><dd>{item.difficulty}</dd></div>
          <div><dt>Result</dt><dd>{item.result}</dd></div>
        </dl>
      </section>

      <section className={styles.devInspection} aria-labelledby="dev-inspection-title">
        <header><span>One execution view</span><h2 id="dev-inspection-title">Read each hand-off without replacing the underlying tools.</h2></header>
        <div>
          <article><Terminal aria-hidden="true" size={21} /><span>Command</span><h3>Inspect the command result.</h3></article>
          <article><Network aria-hidden="true" size={21} /><span>Response</span><h3>Inspect the HTTP response.</h3></article>
          <article><GitBranch aria-hidden="true" size={21} /><span>Branch</span><h3>See which condition path ran.</h3></article>
          <article><Bell aria-hidden="true" size={21} /><span>Notification</span><h3>Keep the final delivery in the same run.</h3></article>
        </div>
      </section>

      <section className={styles.devNext}>
        <Link href="/developers"><Code2 aria-hidden="true" size={16} /> Developer platform</Link>
        <Link href={next.href}><span>Next solution</span>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

function HomelabRoutine({ item }: { item: UseCase }) {
  const next = nextSolution(item.slug);
  const steps = solutionSteps[item.slug];
  return (
    <main id="content" className={`${styles.solutionPage} ${styles.homelabRoutine}`}>
      <section className={styles.homelabHero} aria-labelledby="solution-title">
        <div className={styles.homelabCopy}>
          <p><HousePlug aria-hidden="true" size={16} /> Homelab automation</p>
          <h1 id="solution-title">{item.title}</h1>
          <p>{item.problem}</p>
          <Link href={`/templates/${item.slug}`}>View homelab template <ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
        <figure className={styles.homelabTopology}>
          <figcaption>Private network boundary</figcaption>
          <div className={styles.homelabCore}><Network aria-hidden="true" size={23} /><strong>Local service</strong><small>Private HTTP target</small></div>
          <div className={styles.homelabNodes}>
            <span><HardDrive aria-hidden="true" size={18} /> NAS</span>
            <span><Server aria-hidden="true" size={18} /> Linux server</span>
            <span><HousePlug aria-hidden="true" size={18} /> Raspberry Pi</span>
          </div>
        </figure>
      </section>

      <section className={styles.homelabPlacement} aria-labelledby="homelab-placement-title">
        <header>
          <p>Put the runner inside the boundary</p>
          <h2 id="homelab-placement-title">Use the machine that already has private-network access.</h2>
        </header>
        <div>
          <article><HousePlug aria-hidden="true" size={23} /><span>Low-power host</span><h3>Raspberry Pi</h3><p>Keep the schedule close to always-on home services.</p></article>
          <article><HardDrive aria-hidden="true" size={23} /><span>Storage host</span><h3>NAS</h3><p>Run alongside services that already live on the appliance.</p></article>
          <article><Server aria-hidden="true" size={23} /><span>General host</span><h3>Linux server</h3><p>Use a self-hosted runner inside the private network.</p></article>
        </div>
      </section>

      <section className={styles.homelabRoute} aria-labelledby="homelab-route-title">
        <div><p>Runs inside the network</p><h2 id="homelab-route-title">The check stays close to the service.</h2><p>{item.result}</p></div>
        <ol>{steps.map((step, index) => <li key={step}><span>{index + 1}</span><strong>{step}</strong><Check aria-hidden="true" size={15} /></li>)}</ol>
      </section>

      <section className={styles.homelabBoundary}>
        <div><span>Execution target</span><strong>{item.target}</strong></div>
        <div><span>Network permissions</span><strong>{item.permissions}</strong></div>
        <div><span>Setup</span><strong>{item.difficulty}</strong></div>
      </section>

      <section className={styles.homelabEgress} aria-labelledby="homelab-egress-title">
        <div className={styles.homelabBoundaryDiagram}>
          <span>Private network</span>
          <div><Network aria-hidden="true" size={19} /><strong>Local service</strong><small>HTTP request</small></div>
          <ArrowRight aria-hidden="true" size={17} />
          <div><GitBranch aria-hidden="true" size={19} /><strong>Condition</strong><small>Evaluate locally</small></div>
        </div>
        <div className={styles.homelabEgressCopy}>
          <p>Notify after the local decision</p>
          <h2 id="homelab-egress-title">The service stays private. The signal can still leave.</h2>
          <div><Bell aria-hidden="true" size={18} /><span>Discord webhook</span></div>
        </div>
      </section>

      <section className={styles.homelabNext}>
        <Link href="/product/local-automation"><FolderLock aria-hidden="true" size={16} /> Explore local automation</Link>
        <Link href={next.href}><span>Return to</span>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

export function SolutionExperience({ item }: { item: UseCase }) {
  switch (item.slug) {
    case "browser-automation": return <BrowserRoutine item={item} />;
    case "file-folder-automation": return <FileFolderRoutine item={item} />;
    case "website-monitoring": return <WebsiteMonitor item={item} />;
    case "report-collection": return <ReportCollection item={item} />;
    case "developer-workflows": return <DeveloperRoutine item={item} />;
    case "homelab-automation": return <HomelabRoutine item={item} />;
    default: return null;
  }
}
