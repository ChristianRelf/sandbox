import Link from "next/link";
import { ArrowRight, BadgeCheck, Box, Camera, Check, ChevronDown, Cloud, Cpu, FileDown, Globe2, HardDrive, Play, RotateCcw, Server, ShieldCheck, Users } from "lucide-react";
import { WorkflowDemo } from "./WorkflowDemo";

export default function HomePage() {
  return <main id="content">
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow"><span /> Local-first visual automation</p>
        <h1>Automate anything.<br/><em>Run it anywhere.</em></h1>
        <p className="lede">Build powerful workflows for your browser, files, apps and private network. Run them on your computer, in the cloud or on infrastructure you control.</p>
        <div className="hero-actions"><Link className="sb-button sb-button--primary" href="/downloads">Download for free <ArrowRight size={15}/></Link><a className="text-action" href="#how-it-works"><Play size={13} fill="currentColor"/> See how it works</a></div>
        <p className="platforms">Windows available now <span>·</span> macOS and Linux status shown on downloads</p>
      </div>
      <WorkflowDemo />
      <a className="scroll-cue" href="#product"><ChevronDown size={16}/> Explore the product</a>
    </section>

    <section className="proof-strip" id="product" aria-label="Core product capabilities">
      <div><span>01</span><strong>Build visually</strong><small>Typed nodes, branches and data mapping.</small></div>
      <div><span>02</span><strong>Run locally</strong><small>Reach files, apps and private services.</small></div>
      <div><span>03</span><strong>Inspect everything</strong><small>Inputs, outputs, skips, retries and failures.</small></div>
      <div><span>04</span><strong>Deploy anywhere</strong><small>Desktop, hosted runner or your own server.</small></div>
    </section>

    <section className="section local-section" id="how-it-works">
      <div className="section-intro"><p className="eyebrow"><span/> Choose the execution boundary</p><h2>Your workflow.<br/>Your machine boundary.</h2><p>Keep sensitive files and private services where they are. Choose a runner per deployment, and move to always-on infrastructure only when you need it.</p><Link className="inline-link" href="/product/local-automation">Explore local automation <ArrowRight size={14}/></Link></div>
      <div className="runner-selector" aria-label="Available workflow execution targets">
        <div className="runner-head"><span>Run workflow on</span><strong>Report collector</strong></div>
        <div className="runner-option selected"><span><Cpu size={18}/></span><div><strong>This computer</strong><small>Online · Windows 11</small></div><i><Check size={12}/></i></div>
        <div className="runner-option"><span><Cloud size={18}/></span><div><strong>Managed cloud</strong><small>Optional · usage metered</small></div></div>
        <div className="runner-option"><span><Server size={18}/></span><div><strong>Your server</strong><small>Self-hosted runner</small></div></div>
        <div className="runner-option"><span><HardDrive size={18}/></span><div><strong>Raspberry Pi or NAS</strong><small>ARM64 agent</small></div></div>
        <p>Local execution <b>is not charged per task.</b></p>
      </div>
    </section>

    <section className="section browser-section">
      <div className="browser-proof"><header><span><i/><i/><i/></span><strong>Recorder</strong><small>3 actions captured</small></header><div className="browser-frame"><div className="browser-page"><span>portal.example</span><b>Monthly report</b><button>Download CSV</button></div><div className="recorded-steps"><article><Globe2/><span><strong>Navigate</strong><small>/reports/monthly</small></span><Check/></article><article><FileDown/><span><strong>Click element</strong><small>button “Download CSV”</small></span><Check/></article><article><Camera/><span><strong>Screenshot</strong><small>On failure</small></span><i>3</i></article></div></div></div>
      <div className="section-intro"><p className="eyebrow"><span/> Browser automation</p><h2>Record the routine.<br/>Keep the steps.</h2><p>Capture a real browser action, then edit the resulting nodes, locator strategy, data extraction and failure behaviour. Managed profiles keep sessions isolated; screenshots explain failures without claiming to bypass site restrictions.</p><Link className="inline-link" href="/product/browser-automation">Explore browser automation <ArrowRight size={14}/></Link></div>
    </section>

    <section className="inspector-section"><div className="inspector-copy"><p className="eyebrow"><span/> Execution diagnostics</p><h2>The run should<br/>explain itself.</h2><p>Open any node to see what entered, what it produced, why a branch was skipped and whether a retry is safe.</p><Link className="inline-link" href="https://docs.sandbox.com/getting-started/understand-executions">Understand executions <ArrowRight size={14}/></Link></div><div className="inspector-ui"><nav><span>RUN 2408</span><strong>Completed</strong><small>4.8 s</small></nav><aside><p className="selected"><Check/>Schedule<small>12 ms</small></p><p><Check/>Open browser<small>1.2 s</small></p><p><Check/>Download report<small>2.9 s</small></p><p><Check/>Check result<small>84 ms</small></p></aside><article><header><div><small>NODE 04</small><strong>Check result</strong></div><span><Check/>Succeeded</span></header><dl><div><dt>Input</dt><dd><code>{`{ file: "report.csv", rows: 12 }`}</code></dd></div><div><dt>Condition</dt><dd><code>rows &gt; 0</code></dd></div><div><dt>Output</dt><dd><code>{`{ branch: "true" }`}</code></dd></div><div><dt>Retry</dt><dd>Not required</dd></div></dl></article></div></section>

    <section className="ecosystem-section"><header><div><p className="eyebrow"><span/> Plugin ecosystem</p><h2>Add capabilities.<br/>Review the boundary.</h2></div><p>First-party and reviewed third-party packages declare the nodes, domains and host capabilities they need. Workflows pin the exact signed version that runs.</p></header><div className="plugin-row"><article><span><Box/></span><small>FIRST-PARTY</small><h3>Core nodes</h3><p>Files, HTTP, browser, Gmail, Slack and Discord nodes included in the desktop catalogue.</p><b><BadgeCheck/> Sandbox</b></article><article><span><ShieldCheck/></span><small>RUNTIME</small><h3>Sandboxed plugins</h3><p>Capability-controlled WebAssembly with explicit network and permission review.</p><b>Signed packages</b></article><article><span><Users/></span><small>ORGANISATIONS</small><h3>Private plugins</h3><p>Scoped visibility for internal nodes without publishing them to the public marketplace.</p><b>Workspace controlled</b></article></div><Link className="inline-link" href="/integrations">Browse available integrations <ArrowRight size={14}/></Link></section>

    <section className="team-section"><div><p className="eyebrow"><span/> Teams</p><h2>Operational automation<br/>without shared passwords.</h2><p>Publish reviewed workflow versions, deploy shared connections by environment, approve sensitive changes and manage the runners that keep work online.</p><Link className="inline-link" href="/product/teams-governance">Explore teams and governance <ArrowRight size={14}/></Link></div><div className="team-ledger"><header><span>Workflow publication</span><strong>Production</strong></header><article><span>Draft</span><b>Report collection · v12</b><small>Christian · 14:32</small></article><i/><article><span>Approval</span><b>2 of 2 approved</b><small>Operations · 14:41</small></article><i/><article><span>Published</span><b>Revision v12</b><small>Audit event recorded</small></article><footer><RotateCcw size={13}/> Previous published revision remains available</footer></div></section>

    <section className="final-cta home-cta"><p className="eyebrow"><span/> Local first</p><h2>Build your first local workflow.</h2><p>Start with the desktop editor. Move to hosted or self-hosted execution when the workflow needs to stay online.</p><div><Link href="/downloads" className="sb-button sb-button--primary">Download Sandbox <ArrowRight size={15}/></Link><a href="https://docs.sandbox.com/getting-started" className="text-action">View documentation</a></div></section>
  </main>;
}
