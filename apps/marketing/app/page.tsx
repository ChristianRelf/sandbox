import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDot,
  Cloud,
  Code2,
  FileCheck2,
  GitBranch,
  Globe2,
  HardDrive,
  ListChecks,
  MousePointer2,
  Play,
  ShieldCheck,
} from "lucide-react";
import { brand } from "@sandbox/brand";
import { HeroExperience } from "./HeroExperience";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "Make the work move. Keep the control.",
  description: "Build visible workflows for browsers, files and APIs, then run them on your computer or infrastructure you choose.",
  alternates: { canonical: "/" },
};

const methodSteps = [
  {
    number: "01",
    label: "CAPTURE",
    title: "Start with the job as it happens.",
    body: "Record the browser routine or connect typed steps for files, APIs, decisions and notifications.",
    detail: "Editable from the first step",
    icon: MousePointer2,
  },
  {
    number: "02",
    label: "ROUTE",
    title: "Make the logic visible.",
    body: "Inputs, branches and permissions stay on the canvas, so the route can be reviewed before it runs.",
    detail: "No hidden branch logic",
    icon: GitBranch,
  },
  {
    number: "03",
    label: "PROVE",
    title: "Read what happened.",
    body: "Each run records outputs, skips, retries and bounded failure evidence without turning into a black box.",
    detail: "Evidence attached to the run",
    icon: ListChecks,
  },
] as const;

const examples = [
  {
    number: "01",
    category: "BROWSER WORK",
    title: "Collect a report before anyone has to ask for it.",
    body: "Sign in, download the report, confirm it contains data and notify the team.",
    href: "/solutions/report-collection",
    flow: ["Schedule", "Browser", "Check file", "Notify"],
    icon: Globe2,
  },
  {
    number: "02",
    category: "LOCAL WORK",
    title: "Keep an incoming folder organised on the machine it belongs to.",
    body: "Watch an approved folder, validate new files and move them without uploading their contents.",
    href: "/solutions/file-folder-automation",
    flow: ["File watch", "Condition", "Rename", "Archive"],
    icon: FileCheck2,
  },
  {
    number: "03",
    category: "DEVELOPER WORK",
    title: "Turn a fragile script chain into a run the whole team can read.",
    body: "Join commands, private APIs and decisions with explicit inputs and useful failure evidence.",
    href: "/solutions/developer-workflows",
    flow: ["Command", "API", "Branch", "Evidence"],
    icon: Code2,
  },
] as const;

export default function HomePage() {
  return (
    <main id="content" className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroFrame}>
          <div className={styles.heroCopy}>
            <div className={styles.heroIndex}>
              <span>SB / 0.7 BETA</span>
              <span>LOCAL-FIRST VISUAL AUTOMATION</span>
            </div>
            <h1 id="hero-title">
              <span>Make the work</span>
              <strong>move.</strong>
              <em>Keep the control.</em>
            </h1>
            <div className={styles.heroSummary}>
              <p>Build a visible route through browsers, files, APIs and decisions. Run it on your computer first, then move it only when the job needs to stay awake.</p>
              <div className={styles.heroActions}>
                <Link className={styles.primaryButton} href="/downloads">Download for Windows <ArrowRight aria-hidden="true" size={15} /></Link>
                <a className={styles.secondaryButton} href={brand.domains.docs + "/getting-started"}><Play aria-hidden="true" size={11} fill="currentColor" /> See the 5-minute quickstart</a>
              </div>
              <p className={styles.heroAssurance}><ShieldCheck aria-hidden="true" size={12} /> Free local runs. Every step inspectable.</p>
            </div>
          </div>
          <HeroExperience />
        </div>

        <div className={styles.heroFooter}>
          <div><span>01</span><strong>Build visually</strong><small>Typed steps, explicit branches.</small></div>
          <div><span>02</span><strong>Run in your boundary</strong><small>Local, hosted or self-managed.</small></div>
          <div><span>03</span><strong>Inspect the evidence</strong><small>Outputs, skips, retries, failures.</small></div>
          <a href="#method">
            <span>DISCOVER</span>
            <small>Follow the route</small>
            <ArrowDown aria-hidden="true" size={14} />
          </a>
        </div>
      </section>

      <ol className={styles.handoff} aria-label="A Sandbox workflow progresses from input to evidence">
        <li><span>01</span><strong>INPUT</strong></li>
        <li aria-hidden="true"><i /></li>
        <li><span>02</span><strong>VISIBLE ROUTE</strong></li>
        <li aria-hidden="true"><i /></li>
        <li><span>03</span><strong>CHOSEN RUNNER</strong></li>
        <li aria-hidden="true"><i /></li>
        <li><span>04</span><strong>EVIDENCE</strong></li>
      </ol>

      <section id="method" className={styles.method} aria-labelledby="method-title">
        <div className={styles.methodInner}>
          <header className={styles.sectionHeader}>
            <div className={styles.discoverLabel}><span>DISCOVER</span><small>02 / TRACE THE RUN</small></div>
            <h2 id="method-title">A route you can read<br />before it becomes real.</h2>
            <p>Sandbox keeps the sequence, execution boundary and result in the same mental model. Nothing important disappears between building and running.</p>
          </header>

          <div className={styles.methodRail}>
            {methodSteps.map(({ number, label, title, body, detail, icon: Icon }) => (
              <article key={number}>
                <header><span>{number}</span><small>{label}</small><Icon aria-hidden="true" size={18} /></header>
                <h3>{title}</h3>
                <p>{body}</p>
                <footer><CircleDot aria-hidden="true" size={10} /> {detail}</footer>
              </article>
            ))}
          </div>

          <div className={styles.runLedger} aria-label="Example execution evidence">
            <div className={styles.ledgerLead}>
              <small>EXECUTION / 01842</small>
              <strong>Morning report</strong>
              <span><i /> COMPLETED IN 4.8S</span>
            </div>
            <ol>
              <li><span>08:00:00</span><Check aria-hidden="true" size={11} /><strong>Trigger received</strong><small>weekday_schedule</small></li>
              <li><span>08:00:02</span><Check aria-hidden="true" size={11} /><strong>Portal opened</strong><small>managed_profile</small></li>
              <li><span>08:00:04</span><Check aria-hidden="true" size={11} /><strong>Report verified</strong><small>12 rows / 42 KB</small></li>
            </ol>
            <Link href="/product/visual-workflow-builder">Open the workflow builder <ArrowUpRight aria-hidden="true" size={13} /></Link>
          </div>
        </div>
      </section>

      <section className={styles.boundary} aria-labelledby="boundary-title">
        <div className={styles.boundaryCopy}>
          <p>THE RUNNER IS PART OF THE ROUTE</p>
          <h2 id="boundary-title">Keep private work close. Move only when it helps.</h2>
          <p>Local execution is the full product, not a limited preview. Publish the same visible workflow to an always-on runner when a schedule, team or environment calls for it.</p>
          <div>
            <Link href="/security"><span>DISCOVER</span> Review the security model <ArrowRight aria-hidden="true" size={14} /></Link>
            <Link href="/product/always-on-execution">Explore always-on execution <ArrowRight aria-hidden="true" size={14} /></Link>
          </div>
        </div>

        <div className={styles.runnerMap} aria-label="Available execution targets">
          <header><span>EXECUTION TARGET</span><strong>Choose per workflow</strong></header>
          <article className={styles.runnerSelected}>
            <span><HardDrive aria-hidden="true" size={18} /></span>
            <div><small>START HERE</small><strong>This computer</strong><p>Local files, private apps and free local runs.</p></div>
            <b><Check aria-hidden="true" size={11} /> SELECTED</b>
          </article>
          <article>
            <span><Cloud aria-hidden="true" size={18} /></span>
            <div><small>WHEN NEEDED</small><strong>Hosted runner</strong><p>Durable schedules on managed infrastructure.</p></div>
            <b>AVAILABLE</b>
          </article>
          <article>
            <span><Code2 aria-hidden="true" size={18} /></span>
            <div><small>YOUR BOUNDARY</small><strong>Self-hosted runner</strong><p>Linux x64 or ARM64 inside your network.</p></div>
            <b>AVAILABLE</b>
          </article>
          <footer><ShieldCheck aria-hidden="true" size={12} /> Permissions stay explicit at every target.</footer>
        </div>
      </section>

      <section className={styles.examples} aria-labelledby="examples-title">
        <header className={styles.examplesHeader}>
          <div className={styles.discoverLabel}><span>DISCOVER</span><small>03 / START WITH THE JOB</small></div>
          <h2 id="examples-title">Real work makes<br />the clearest demo.</h2>
          <div><p>Choose a familiar routine and see the entire route—trigger, permissions, execution and result.</p><Link href="/solutions">View all solutions <ArrowRight aria-hidden="true" size={14} /></Link></div>
        </header>

        <div className={styles.exampleGrid}>
          {examples.map(({ number, category, title, body, href, flow, icon: Icon }) => (
            <Link href={href} key={href}>
              <header><span>{number}</span><small>{category}</small><Icon aria-hidden="true" size={18} /></header>
              <h3>{title}</h3>
              <p>{body}</p>
              <ol aria-label="Workflow route">
                {flow.map((step, index) => <li key={step}>{step}{index < flow.length - 1 && <i aria-hidden="true" />}</li>)}
              </ol>
              <footer><span>DISCOVER</span><small>Explore this solution</small><ArrowUpRight aria-hidden="true" size={14} /></footer>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.system} aria-labelledby="system-title">
        <header>
          <p>SAME ROUTE / MORE REACH</p>
          <h2 id="system-title">Extend the system<br />without losing the boundary.</h2>
        </header>
        <div>
          <Link href="/marketplace"><span>01</span><strong>Marketplace</strong><small>Review capabilities and permissions before install.</small><ArrowUpRight aria-hidden="true" size={15} /></Link>
          <Link href="/developers"><span>02</span><strong>Developer platform</strong><small>Build typed nodes and versioned workflow packages.</small><ArrowUpRight aria-hidden="true" size={15} /></Link>
          <Link href="/product/teams-governance"><span>03</span><strong>Teams & governance</strong><small>Publish, approve and operate without widening access.</small><ArrowUpRight aria-hidden="true" size={15} /></Link>
        </div>
      </section>
    </main>
  );
}
