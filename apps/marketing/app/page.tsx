import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Cloud,
  Download,
  FolderLock,
  Globe2,
  HardDrive,
  History,
  Server,
  ShieldCheck,
} from "lucide-react";
import { brand } from "@sandbox/brand";
import { LiveWorkflowDemo } from "../components/LiveWorkflowDemo";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "Visual automation you can inspect",
  description:
    "Build visible workflows for browsers, files, APIs and decisions, then run them on your computer or infrastructure you control.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <main id="content" className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>
            <span aria-hidden="true" />
            Visual automation for the work your machine can reach
          </p>
          <h1 id="hero-title">
            Build the workflow.
            <span>See every step.</span>
          </h1>
          <p className={styles.lede}>
            Connect browser, file, API and decision nodes on one canvas. Run the
            workflow locally, inspect what happened, and move it to a runner only
            when the job needs to stay awake.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/downloads">
              <Download aria-hidden="true" size={16} />
              Download for Windows
            </Link>
            <a className={styles.secondaryAction} href={`${brand.domains.docs}/getting-started`}>
              <BookOpen aria-hidden="true" size={15} />
              Read the quickstart
              <ArrowRight aria-hidden="true" size={14} />
            </a>
          </div>
          <p className={styles.assurance}>
            <ShieldCheck aria-hidden="true" size={14} />
            Local workflows run without an account. Current desktop build is an
            unsigned Windows beta.
          </p>
        </div>

        <div className={styles.heroAside} aria-hidden="true">
          <span>Carry the work.</span>
          <Image
            className={styles.mascot}
            src="/brand/hermit-hero-v3.png"
            alt=""
            width={1536}
            height={1024}
            priority
          />
        </div>

        <figure className={styles.productStage}>
          <div className={styles.productHeading}>
            <div>
              <span className={styles.liveDot} aria-hidden="true" />
              <strong>Workflow editor</strong>
            </div>
            <p>Built-in website change monitor</p>
          </div>
          <div className={styles.productViewport}>
            <Image
              src="/product/workflow-editor.png"
              alt="The real sndbox desktop editor showing the built-in website change monitor workflow as connected nodes on a canvas."
              width={1456}
              height={939}
              sizes="(max-width: 760px) 100vw, 1456px"
            />
          </div>
          <figcaption>
            <span>Schedule</span>
            <i aria-hidden="true" />
            <span>Open browser</span>
            <i aria-hidden="true" />
            <span>Navigate</span>
            <i aria-hidden="true" />
            <span>Compare</span>
            <i aria-hidden="true" />
            <span>Notify</span>
          </figcaption>
        </figure>

        <a className={styles.scrollCue} href="#product-story">
          See how it works <ArrowDown aria-hidden="true" size={14} />
        </a>
      </section>

      <section id="product-story" className={styles.productStory} aria-labelledby="story-title">
        <header>
          <p>One route from idea to evidence</p>
          <h2 id="story-title">The product stays readable as the work gets real.</h2>
        </header>
        <div className={styles.storyPoints}>
          <article>
            <h3>Build on a visible canvas</h3>
            <p>Typed connections and explicit branches show how data and decisions move between steps.</p>
          </article>
          <article>
            <h3>Run inside the right boundary</h3>
            <p>Start on your computer. Use a hosted or self-managed runner when a schedule or environment requires it.</p>
          </article>
          <article>
            <h3>Inspect the result</h3>
            <p>Execution history keeps outputs, skipped branches, retries and bounded failure evidence together.</p>
          </article>
        </div>
      </section>

      <section className={styles.demoSection} aria-labelledby="demo-title">
        <div className={styles.sectionIntro}>
          <div>
            <p>Use the real editor surface</p>
            <h2 id="demo-title">Follow a workflow without filling in the blanks.</h2>
          </div>
          <p>
            This is the built-in Website Change Monitor from the desktop app. Pan
            the canvas and select a node to inspect the exact configuration that
            ships in the repository.
          </p>
        </div>
        <LiveWorkflowDemo />
      </section>

      <section className={styles.boundarySection} aria-labelledby="boundary-title">
        <div className={styles.boundaryCopy}>
          <p>Execution is a product decision</p>
          <h2 id="boundary-title">Run close to the work. Move only when it helps.</h2>
          <p>
            Local execution is the product, not a limited preview. Publish the
            same visible workflow to another runner when a schedule, team or
            network boundary calls for it.
          </p>
          <Link href="/product/always-on-execution">
            See execution options <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>

        <div className={styles.runnerList} aria-label="sndbox execution targets">
          <article>
            <span><HardDrive aria-hidden="true" size={19} /></span>
            <div><strong>This computer</strong><p>Local files, private services and desktop schedules.</p></div>
            <small>Start here</small>
          </article>
          <article>
            <span><Cloud aria-hidden="true" size={19} /></span>
            <div><strong>Hosted runner</strong><p>Durable schedules on managed runner infrastructure.</p></div>
            <small>When needed</small>
          </article>
          <article>
            <span><Server aria-hidden="true" size={19} /></span>
            <div><strong>Self-hosted runner</strong><p>Linux x64 or ARM64 inside infrastructure you control.</p></div>
            <small>Your boundary</small>
          </article>
        </div>
      </section>

      <section className={styles.capabilities} aria-labelledby="capabilities-title">
        <header>
          <p>Built for work that crosses tools</p>
          <h2 id="capabilities-title">One canvas. Different kinds of work.</h2>
        </header>
        <div className={styles.capabilityRows}>
          <Link href="/product/browser-automation">
            <span><Globe2 aria-hidden="true" size={20} /></span>
            <div><h3>Record browser routines</h3><p>Capture navigation, clicks, fields and downloads in managed Chromium, then edit the resulting nodes.</p></div>
            <ArrowUpRight aria-hidden="true" size={18} />
          </Link>
          <Link href="/product/local-automation">
            <span><FolderLock aria-hidden="true" size={20} /></span>
            <div><h3>Reach local files and private services</h3><p>Work inside approved folders, run explicit commands and call named network targets.</p></div>
            <ArrowUpRight aria-hidden="true" size={18} />
          </Link>
          <Link href="/product/visual-workflow-builder">
            <span><History aria-hidden="true" size={20} /></span>
            <div><h3>Keep the run inspectable</h3><p>Read outputs, skipped branches, retry decisions and bounded failure evidence in execution history.</p></div>
            <ArrowUpRight aria-hidden="true" size={18} />
          </Link>
        </div>
      </section>

      <section className={styles.startSection} aria-labelledby="start-title">
        <div>
          <p>Start with the machine in front of you</p>
          <h2 id="start-title">Build one useful workflow. Keep every step in view.</h2>
        </div>
        <div>
          <p>Download the current Windows beta, or read the setup guide before installing.</p>
          <div>
            <Link href="/downloads">Download sndbox <ArrowRight aria-hidden="true" size={15} /></Link>
            <a href={`${brand.domains.docs}/getting-started`}>Open documentation <ArrowUpRight aria-hidden="true" size={14} /></a>
          </div>
        </div>
      </section>
    </main>
  );
}
