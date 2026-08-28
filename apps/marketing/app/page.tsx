import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Box,
  Camera,
  Check,
  Cloud,
  Code2,
  Cpu,
  FileDown,
  FolderOpen,
  Globe2,
  HardDrive,
  KeyRound,
  MousePointer2,
  Network,
  Play,
  PlugZap,
  RotateCcw,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import { WorkflowDemo } from "./WorkflowDemo";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "Give the busywork back to your computer",
  description: "Give repetitive browser, file and app work back to your computer with visual workflows that run where you choose.",
};

export default function HomePage() {
  return <main id="content">
    <section className={styles.hero}>
      <div className={styles.heroTexture} aria-hidden="true"><i/><i/><i/></div>
      <div className={styles.heroCopy}>
        <p className={styles.kicker}><span /> Visual automation for work that has to get done</p>
        <h1 className={styles.headline}>Give the busywork back to <em>your computer.</em></h1>
        <p className={styles.lede}>Build a clear sequence that clicks through browsers, moves files, calls APIs and tells your team when it is done. Run it on your machine or a runner you choose.</p>
        <div className={styles.heroActions}>
          <Link className="sb-button sb-button--primary" href="/downloads">Download for Windows <ArrowRight size={15}/></Link>
          <a className={styles.secondaryAction} href="#how-it-works"><Play size={12} fill="currentColor"/> See how it works</a>
        </div>
        <div className={styles.assurances} aria-label="Product assurances">
          <span><Check size={11}/> Free local runs</span>
          <span><Check size={11}/> Every step inspectable</span>
          <span><Check size={11}/> Move to the cloud when you choose</span>
        </div>
        <p className={styles.platforms}>Windows available now <span>/</span> macOS and Linux status on downloads</p>
      </div>

      <div className={styles.heroVisual} id="hero-demo">
        <WorkflowDemo />
        <div className={styles.visualCaption}>
          <span>01 / A REAL RUN</span>
          <p><strong>No magic.</strong> Just a sequence you can see, edit, approve and replay.</p>
        </div>
      </div>

      <a className={styles.scrollCue} href="#product"><span /> SCROLL TO EXPLORE</a>
    </section>

    <div className={styles.capabilityRail} aria-label="Work Sandbox can automate">
      <span>ONE CANVAS FOR</span>
      <div><b>Browser actions</b><i/>Files and folders<i/>APIs<i/>Private apps<i/>Team handoffs</div>
    </div>

    <section className={styles.principles} id="product" aria-labelledby="principles-title">
      <header className={styles.principlesHeader}>
        <div><span>01</span><small>THE SANDBOX MODEL</small></div>
        <h2 id="principles-title">Automation should be powerful enough for the messy work and clear enough that you still trust it tomorrow.</h2>
      </header>
      <div className={styles.principleGrid}>
        <article><span>01</span><i/><h2>Draw the work.</h2><p>Turn the real sequence into typed nodes, branches and visible data mapping.</p></article>
        <article><span>02</span><i/><h2>Keep it close.</h2><p>Reach files, apps and private services without sending the job somewhere else.</p></article>
        <article><span>03</span><i/><h2>Know what happened.</h2><p>Inspect inputs, outputs, skips, retries and failures instead of guessing.</p></article>
        <article><span>04</span><i/><h2>Move when ready.</h2><p>Start on desktop. Add hosted or self-managed runners only when the work needs them.</p></article>
      </div>
    </section>

    <section className={`${styles.storySection} ${styles.boundarySection}`} id="how-it-works" aria-labelledby="boundary-title">
      <div className={styles.sectionIndex}><span>02</span><small>EXECUTION<br/>BOUNDARY</small></div>
      <div className={styles.storyCopy}>
        <p className={styles.sectionTag}><span/> Choose where the work runs</p>
        <h2 id="boundary-title">Automation that knows where the line is.</h2>
        <p>Sensitive files and private services can stay exactly where they are. Pick a runner for each deployment, then move to always-on infrastructure only when the job actually needs it.</p>
        <ul className={styles.storyPoints}>
          <li><Check size={12}/> Local runs are not metered per task</li>
          <li><Check size={12}/> Permissions are explicit before the first run</li>
          <li><Check size={12}/> The same workflow can move between runners</li>
        </ul>
        <Link className={styles.inlineLink} href="/product/local-automation">Explore local automation <ArrowRight size={14}/></Link>
      </div>

      <div className={styles.runnerPanel} aria-label="Example workflow runner selection">
        <header>
          <div><span>WORKFLOW</span><strong>Collect morning report</strong></div>
          <small>RUNNER TARGET</small>
        </header>
        <div className={styles.machineBoundary}>
          <div className={styles.boundaryTitle}><span><i/> YOUR MACHINE</span><small>ONLINE / 4 MS</small></div>
          <article className={styles.selectedRunner}>
            <span><Cpu size={19}/></span>
            <div><small>SELECTED RUNNER</small><strong>This computer</strong><p>Windows 11 · approved folders</p></div>
            <i><Check size={12}/></i>
          </article>
          <div className={styles.localRoute} aria-hidden="true"><span/><i/><span/></div>
          <div className={styles.localPermissions}>
            <span><FolderOpen size={12}/> Reports</span>
            <span><Globe2 size={12}/> portal.example</span>
            <span><ShieldCheck size={12}/> 2 grants</span>
          </div>
        </div>
        <div className={styles.runnerAlternatives}>
          <article><Cloud size={16}/><div><strong>Managed cloud</strong><small>Always on · optional</small></div></article>
          <article><Server size={16}/><div><strong>Your server</strong><small>Self-hosted runner</small></div></article>
          <article><HardDrive size={16}/><div><strong>NAS or Pi</strong><small>ARM64 agent</small></div></article>
        </div>
        <footer><span><i/> READY</span><small>Nothing leaves this boundary until a step says so.</small></footer>
      </div>
    </section>

    <section className={`${styles.storySection} ${styles.browserSection}`} aria-labelledby="browser-title">
      <div className={styles.sectionIndex}><span>03</span><small>BROWSER<br/>CAPTURE</small></div>
      <div className={styles.browserVisual} aria-label="Browser recorder capturing a monthly report download">
        <header>
          <span><i/><i/><i/></span>
          <div><Globe2 size={11}/> portal.example/reports/monthly</div>
        </header>
        <div className={styles.browserBody}>
          <div className={styles.fakePage}>
            <nav><b>Northstar</b><span>Dashboard&nbsp;&nbsp; Reports&nbsp;&nbsp; Settings</span></nav>
            <div className={styles.fakePageContent}>
              <span>FINANCE / REPORTS</span>
              <h3>Monthly report</h3>
              <p>August 2026 · 12 reconciled entries</p>
              <div className={styles.downloadTarget}>
                <b className={styles.downloadButton}><FileDown size={13}/> Download CSV</b>
                <MousePointer2 className={styles.captureCursor} size={18} fill="currentColor" aria-hidden="true"/>
                <i className={styles.clickRing} aria-hidden="true"/>
              </div>
            </div>
          </div>
          <ol className={styles.captureSteps}>
            <li><span><Globe2 size={13}/></span><div><small>01 / NAVIGATE</small><strong>Open monthly reports</strong><p>/reports/monthly</p></div><Check size={12}/></li>
            <li><span><MousePointer2 size={13}/></span><div><small>02 / CLICK</small><strong>Download CSV</strong><p>role=button</p></div><Check size={12}/></li>
            <li><span><Camera size={13}/></span><div><small>03 / SAFETY</small><strong>Capture on failure</strong><p>Screenshot + page state</p></div><i>3</i></li>
          </ol>
        </div>
        <footer><span>3 actions became 3 editable nodes</span><small>Locator strategy saved</small></footer>
      </div>

      <div className={styles.storyCopy}>
        <p className={styles.sectionTag}><span/> Browser automation</p>
        <h2 id="browser-title">Teach it once. Own every step.</h2>
        <p>Capture the routine in a real browser, then edit the nodes, locator strategy, extracted data and failure behaviour. The recording is a starting point—not a black box.</p>
        <div className={styles.microProof}>
          <span><b>REAL SESSION</b> Uses an isolated managed profile</span>
          <span><b>FAILURE PROOF</b> Saves the state that explains what broke</span>
        </div>
        <Link className={styles.inlineLink} href="/product/browser-automation">Explore browser automation <ArrowRight size={14}/></Link>
      </div>
    </section>

    <section className={styles.diagnosticsSection} aria-labelledby="diagnostics-title">
      <header className={styles.diagnosticsHeader}>
        <div><span>04</span><small>EXECUTION DIAGNOSTICS</small></div>
        <h2 id="diagnostics-title">Nothing disappears into a <em>black box.</em></h2>
        <p>Open any step and see what entered, what came out, why a branch was skipped and whether a retry is safe.</p>
      </header>

      <div className={styles.inspectorShell}>
        <nav>
          <div><i/><b>RUN 2408</b><span>Collect morning report</span></div>
          <p><strong><Check size={11}/> COMPLETED</strong><span>4.8 s</span></p>
        </nav>
        <div className={styles.inspectorBody}>
          <aside className={styles.runSteps}>
            <header>NODES <span>4 / 4</span></header>
            <ol>
              <li><i><Check size={9}/></i><span><strong>Schedule</strong><small>12 ms</small></span></li>
              <li><i><Check size={9}/></i><span><strong>Open browser</strong><small>1.2 s</small></span></li>
              <li><i><Check size={9}/></i><span><strong>Download report</strong><small>2.9 s</small></span></li>
              <li className={styles.inspectedStep}><i><Check size={9}/></i><span><strong>Check result</strong><small>84 ms</small></span></li>
            </ol>
          </aside>
          <article className={styles.nodeInspector}>
            <header><div><small>NODE 04 / CONDITION</small><strong>Check result</strong></div><span><Check size={11}/> Succeeded</span></header>
            <dl>
              <div><dt>Input</dt><dd><code>{`{ file: "report.csv", rows: 12 }`}</code></dd></div>
              <div><dt>Condition</dt><dd><code>rows &gt; 0</code></dd></div>
              <div><dt>Output</dt><dd><code>{`{ branch: "true" }`}</code></dd></div>
              <div><dt>Retry</dt><dd>Not required</dd></div>
            </dl>
          </article>
          <aside className={styles.runEvidence}>
            <header>EVIDENCE</header>
            <div><span><Camera size={13}/></span><strong>Final page</strong><small>1280 × 720 PNG</small></div>
            <div><span><FileDown size={13}/></span><strong>report.csv</strong><small>42 KB · 12 rows</small></div>
            <p><ShieldCheck size={12}/> No secrets in logs</p>
          </aside>
        </div>
      </div>

      <footer className={styles.diagnosticsFooter}>
        <p><span>THE PRINCIPLE</span> If a workflow cannot explain itself, it is not ready to run unattended.</p>
        <a href="https://docs.sandbox.com/getting-started/understand-executions">Understand executions <ArrowRight size={14}/></a>
      </footer>
    </section>

    <section className={styles.ecosystemSection} aria-labelledby="ecosystem-title">
      <header>
        <div><p className={styles.sectionTag}><span/> Plugin ecosystem</p><h2 id="ecosystem-title">Add capability.<br/>Keep the boundary visible.</h2></div>
        <p>Every package declares its nodes, network domains and host capabilities before it runs. Workflows pin the exact signed version you reviewed.</p>
      </header>
      <div className={styles.ecosystemCards}>
        <article>
          <div className={styles.cardNumber}>01</div>
          <span className={styles.pluginIcon}><Box size={19}/></span>
          <small>FIRST-PARTY</small>
          <h3>Core nodes</h3>
          <p>Files, HTTP, browser, Gmail, Slack and Discord arrive in the desktop catalogue.</p>
          <div className={styles.capabilityTape}><Code2 size={12}/> 18 NODES INCLUDED</div>
          <footer><BadgeCheck size={12}/> Built by Sandbox</footer>
        </article>
        <article className={styles.featuredPlugin}>
          <div className={styles.cardNumber}>02</div>
          <span className={styles.pluginIcon}><ShieldCheck size={19}/></span>
          <small>CONTROLLED RUNTIME</small>
          <h3>Sandboxed plugins</h3>
          <p>Capability-controlled WebAssembly with a manifest you can read before install.</p>
          <div className={styles.permissionManifest}>
            <span><Network size={11}/> api.example.com</span>
            <span><FolderOpen size={11}/> No file access</span>
          </div>
          <footer><ShieldCheck size={12}/> Signed packages</footer>
        </article>
        <article>
          <div className={styles.cardNumber}>03</div>
          <span className={styles.pluginIcon}><Users size={19}/></span>
          <small>YOUR ORGANISATION</small>
          <h3>Private capabilities</h3>
          <p>Share internal nodes with your workspace without publishing them to a public marketplace.</p>
          <div className={styles.capabilityTape}><KeyRound size={12}/> WORKSPACE ONLY</div>
          <footer><PlugZap size={12}/> Version pinned</footer>
        </article>
      </div>
      <div className={styles.ecosystemFooter}><span>Review once. Run the exact version you approved.</span><Link className={styles.inlineLink} href="/integrations">Browse integrations <ArrowRight size={14}/></Link></div>
    </section>

    <section className={styles.teamSection} aria-labelledby="team-title">
      <div className={styles.teamCopy}>
        <p className={styles.sectionTag}><span/> Teams and governance</p>
        <h2 id="team-title">Ship the workflow. Keep the passwords out of it.</h2>
        <p>Publish reviewed versions, deploy shared connections by environment, approve sensitive changes and manage the runners that keep the work online.</p>
        <div className={styles.teamFacts}>
          <article><strong>2 / 2</strong><span>required approvals</span></article>
          <article><strong>v12</strong><span>immutable revision</span></article>
          <article><strong>0</strong><span>shared passwords</span></article>
        </div>
        <Link className={styles.inlineLink} href="/product/teams-governance">Explore teams and governance <ArrowRight size={14}/></Link>
      </div>

      <div className={styles.publicationLedger} aria-label="Example workflow publication timeline">
        <header><div><span>WORKFLOW PUBLICATION</span><strong>Report collection</strong></div><p><i/> PRODUCTION</p></header>
        <div className={styles.ledgerBody}>
          <article><span><Check size={11}/></span><div><small>14:32 / DRAFT</small><strong>Revision v12 prepared</strong><p>Changed browser locator and retry policy</p></div><em>Christian</em></article>
          <article><span><Check size={11}/></span><div><small>14:41 / APPROVAL</small><strong>2 of 2 approved</strong><p>Operations and Security</p></div><em>9 min</em></article>
          <article className={styles.publishedRow}><span><Check size={11}/></span><div><small>14:42 / PUBLISHED</small><strong>Revision v12 is live</strong><p>Audit event recorded · runners updated</p></div><em>Current</em></article>
        </div>
        <footer><RotateCcw size={13}/><span>Previous published revision remains available</span><b>ROLLBACK READY</b></footer>
      </div>
    </section>

    <section className={styles.finalCta} aria-labelledby="cta-title">
      <div className={styles.ctaTexture} aria-hidden="true"><i/><i/><i/></div>
      <div className={styles.ctaCopy}>
        <p><span/> READY WHEN YOU ARE</p>
        <h2 id="cta-title">Start with one<br/><em>boring task.</em></h2>
        <p>Build it on your computer. Watch every step. Keep it local for free, or move it online when the work needs to keep running.</p>
        <div>
          <Link href="/downloads" className={styles.ctaPrimary}>Download Sandbox <ArrowRight size={15}/></Link>
          <a href="https://docs.sandbox.com/getting-started" className={styles.ctaSecondary}>Read the quickstart</a>
        </div>
        <small><Check size={11}/> Windows available now · no card required</small>
      </div>
      <div className={styles.ctaRoute} aria-label="Example workflow from browser to file to team notification">
        <article><span><Globe2 size={16}/></span><div><small>01</small><strong>Open browser</strong></div></article>
        <i><ArrowRight size={14}/></i>
        <article><span><FileDown size={16}/></span><div><small>02</small><strong>Save report</strong></div></article>
        <i><ArrowRight size={14}/></i>
        <article><span><Users size={16}/></span><div><small>03</small><strong>Tell the team</strong></div></article>
        <b><Check size={12}/> DONE IN 4.8 S</b>
      </div>
    </section>
  </main>;
}
