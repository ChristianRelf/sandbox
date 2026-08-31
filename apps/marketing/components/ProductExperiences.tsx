import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Cloud,
  Code2,
  Download,
  FileCode2,
  FolderLock,
  GitBranch,
  Globe2,
  HardDrive,
  KeyRound,
  Layers3,
  LockKeyhole,
  MousePointer2,
  Network,
  PackageCheck,
  PanelTop,
  Play,
  Radio,
  Route,
  ScanSearch,
  Server,
  ShieldCheck,
  Terminal,
  TimerReset,
  Users,
  Workflow,
} from "lucide-react";
import { brand } from "@sandbox/brand";
import type { ProductPage } from "@sandbox/content";
import { LiveWorkflowDemo } from "./LiveWorkflowDemo";
import styles from "./ProductExperiences.module.css";

const productOrder = [
  ["visual-workflow-builder", "Visual workflow builder"],
  ["local-automation", "Local automation"],
  ["browser-automation", "Browser automation"],
  ["always-on-execution", "Always-on execution"],
  ["plugins-marketplace", "Plugins and marketplace"],
  ["teams-governance", "Teams and governance"],
  ["developers", "Developer platform"],
] as const;

function productHref(slug: string) {
  return slug === "developers" ? "/developers" : `/product/${slug}`;
}

function documentationUrl(path: string) {
  return `${brand.domains.docs}/${path}`;
}

function nextProduct(slug: string) {
  const index = Math.max(productOrder.findIndex(([candidate]) => candidate === slug), 0);
  const [nextSlug, label] = productOrder[(index + 1) % productOrder.length];
  return { href: productHref(nextSlug), label };
}

function RelatedDocs({ page, className }: { page: ProductPage; className: string }) {
  return (
    <nav className={className} aria-label={`${page.eyebrow} documentation`}>
      {page.related.map((path) => (
        <a href={documentationUrl(path)} key={path}>
          <span>{path.split("/").at(-1)?.replaceAll("-", " ")}</span>
          <ArrowUpRight aria-hidden="true" size={13} />
        </a>
      ))}
    </nav>
  );
}

function BuilderPage({ page }: { page: ProductPage }) {
  const next = nextProduct(page.slug);
  return (
    <main id="content" className={`${styles.productPage} ${styles.builderPage}`}>
      <section className={styles.builderHero} aria-labelledby="product-title">
        <div className={styles.builderLead}>
          <p className={styles.builderEyebrow}><Workflow aria-hidden="true" size={15} /> {page.eyebrow}</p>
          <h1 id="product-title">{page.title}</h1>
        </div>
        <div className={styles.builderSummary}>
          <p>{page.summary}</p>
          <div className={styles.builderActions}>
            <Link href="/downloads"><Download aria-hidden="true" size={15} /> Download sndbox</Link>
            <a href={documentationUrl(page.related[0])}>Open editor guide <ArrowUpRight aria-hidden="true" size={14} /></a>
          </div>
        </div>
        <div className={styles.builderSequence} aria-label="Workflow authoring sequence">
          <span>Connect typed nodes</span><ChevronRight aria-hidden="true" size={14} />
          <span>Test each step</span><ChevronRight aria-hidden="true" size={14} />
          <span>Publish a revision</span>
        </div>
      </section>

      <section className={styles.builderCanvas} aria-labelledby="builder-canvas-title">
        <header>
          <div>
            <p>Actual desktop component</p>
            <h2 id="builder-canvas-title">Read the workflow on the canvas.</h2>
          </div>
          <p>Select any node to inspect the exact configuration in the built-in Website Change Monitor.</p>
        </header>
        <LiveWorkflowDemo />
      </section>

      <section className={styles.builderReasoning} aria-labelledby="builder-reasoning-title">
        <header>
          <span>Visible logic</span>
          <h2 id="builder-reasoning-title">Nothing important disappears between the nodes.</h2>
        </header>
        <div className={styles.builderBenefits}>
          {page.benefits.map((benefit, index) => (
            <article key={benefit.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{benefit.title}</h3>
              <p>{benefit.body}</p>
            </article>
          ))}
        </div>
        <aside className={styles.builderProof}>
          <ShieldCheck aria-hidden="true" size={20} />
          <div><strong>Verified product behaviour</strong><p>{page.proof}</p></div>
        </aside>
      </section>

      <section className={styles.builderSpecification}>
        <div className={styles.builderFacts}>
          {page.details.map((detail) => (
            <div key={detail.label}><span>{detail.label}</span><strong>{detail.value}</strong></div>
          ))}
        </div>
        <div className={styles.builderDocs}>
          <p>Continue in the documentation</p>
          <RelatedDocs page={page} className={styles.builderDocLinks} />
        </div>
      </section>

      <section className={styles.builderNext}>
        <p>Next, bring the canvas closer to the work.</p>
        <Link href={next.href}>{next.label}<ArrowRight aria-hidden="true" size={17} /></Link>
      </section>
    </main>
  );
}

function LocalPage({ page }: { page: ProductPage }) {
  const next = nextProduct(page.slug);
  return (
    <main id="content" className={`${styles.productPage} ${styles.localPage}`}>
      <section className={styles.localHero} aria-labelledby="product-title">
        <div className={styles.localTitle}>
          <p><HardDrive aria-hidden="true" size={16} /> {page.eyebrow}</p>
          <h1 id="product-title">{page.title}</h1>
          <p>{page.summary}</p>
          <div>
            <Link href="/downloads">Run on this computer <ArrowRight aria-hidden="true" size={15} /></Link>
            <a href={documentationUrl(page.related[0])}>Read the local setup guide</a>
          </div>
        </div>

        <figure className={styles.localBoundary}>
          <figcaption>Execution boundary</figcaption>
          <div className={styles.localInputs}>
            <span><FolderLock aria-hidden="true" size={16} /> Approved roots</span>
            <span><Terminal aria-hidden="true" size={16} /> Explicit commands</span>
            <span><Network aria-hidden="true" size={16} /> Private APIs</span>
            <span><TimerReset aria-hidden="true" size={16} /> Local schedules</span>
          </div>
          <div className={styles.localMachine}>
            <span aria-hidden="true"><HardDrive size={26} /></span>
            <strong>This computer</strong>
            <small>Workflow and data stay local</small>
          </div>
        </figure>
      </section>

      <section className={styles.localPermissions} aria-labelledby="local-boundary-title">
        <div className={styles.localPermissionIntro}>
          <p>Deliberate access</p>
          <h2 id="local-boundary-title">The boundary is part of the workflow.</h2>
          <p>{page.proof}</p>
        </div>
        <div className={styles.localPermissionRows}>
          {page.details.map((detail, index) => (
            <article key={detail.label}>
              <span>{index + 1}</span>
              <h3>{detail.label}</h3>
              <p>{detail.value}</p>
              <Check aria-hidden="true" size={17} />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.localOutcomes} aria-labelledby="local-outcomes-title">
        <header>
          <h2 id="local-outcomes-title">Useful where hosted automation cannot reach.</h2>
          <RelatedDocs page={page} className={styles.localDocLinks} />
        </header>
        <div>
          {page.benefits.map((benefit) => (
            <article key={benefit.title}><h3>{benefit.title}</h3><p>{benefit.body}</p></article>
          ))}
        </div>
      </section>

      <section className={styles.localNext}>
        <span>From the machine to the browser</span>
        <Link href={next.href}>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

const recorderSteps = [
  ["Navigate", Globe2],
  ["Click Element", MousePointer2],
  ["Fill Field", PanelTop],
  ["Select Option", CircleDot],
  ["Extract Data", ScanSearch],
  ["Download File", Download],
] as const;

function BrowserPage({ page }: { page: ProductPage }) {
  const next = nextProduct(page.slug);
  return (
    <main id="content" className={`${styles.productPage} ${styles.browserPage}`}>
      <section className={styles.browserHero} aria-labelledby="product-title">
        <div className={styles.browserCopy}>
          <p>{page.eyebrow}</p>
          <h1 id="product-title">{page.title}</h1>
          <p>{page.summary}</p>
          <Link href="/downloads">Open the recorder <ArrowRight aria-hidden="true" size={15} /></Link>
        </div>

        <div className={styles.recorderStrip} aria-label="Browser recorder node output">
          <header><Radio aria-hidden="true" size={15} /><span>Recorder output</span><small>Editable nodes</small></header>
          <ol>
            {recorderSteps.map(([label, Icon], index) => (
              <li key={label}><span>{index + 1}</span><Icon aria-hidden="true" size={16} /><strong>{label}</strong></li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.browserLocator} aria-labelledby="browser-locator-title">
        <div className={styles.locatorExample} aria-label="Semantic locator strategy">
          <span>Semantic locator</span>
          <code>role=button[name=&apos;Download report&apos;]</code>
          <div><CheckCircle2 aria-hidden="true" size={16} /><p>Candidate retained with fallbacks</p></div>
          <div><ShieldCheck aria-hidden="true" size={16} /><p>Protected field values excluded</p></div>
        </div>
        <div className={styles.browserLocatorCopy}>
          <p>Record the behaviour, keep the reasoning.</p>
          <h2 id="browser-locator-title">A recording becomes ordinary workflow logic.</h2>
          <p>{page.proof}</p>
        </div>
      </section>

      <section className={styles.browserStory} aria-labelledby="browser-story-title">
        <header>
          <span>From interaction to evidence</span>
          <h2 id="browser-story-title">Capture. Edit. Diagnose.</h2>
        </header>
        <div className={styles.browserBenefitTrack}>
          {page.benefits.map((benefit, index) => (
            <article key={benefit.title}>
              <span>{index + 1}</span>
              <h3>{benefit.title}</h3>
              <p>{benefit.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.browserReference}>
        <dl>
          {page.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
        </dl>
        <div>
          <p>Recorder, locators and failure diagnosis</p>
          <RelatedDocs page={page} className={styles.browserDocLinks} />
        </div>
      </section>

      <section className={styles.browserNext}>
        <div><span>Keep the routine awake</span><strong>{next.label}</strong></div>
        <Link href={next.href}>Continue <ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

function AlwaysOnPage({ page }: { page: ProductPage }) {
  const next = nextProduct(page.slug);
  return (
    <main id="content" className={`${styles.productPage} ${styles.alwaysPage}`}>
      <section className={styles.alwaysHero} aria-labelledby="product-title">
        <div className={styles.alwaysHeadline}>
          <p><Activity aria-hidden="true" size={15} /> {page.eyebrow}</p>
          <h1 id="product-title">{page.title}</h1>
        </div>
        <div className={styles.alwaysIntro}>
          <p>{page.summary}</p>
          <a href={documentationUrl(page.related[0])}>Read the runner guide <ArrowUpRight aria-hidden="true" size={14} /></a>
        </div>

        <figure className={styles.runnerTopology}>
          <figcaption>Published workflow routing</figcaption>
          <div className={styles.topologySource}><Workflow aria-hidden="true" size={20} /><strong>Published workflow</strong><small>Versioned revision</small></div>
          <span className={styles.topologyLine} aria-hidden="true" />
          <div className={styles.topologyControl}><Route aria-hidden="true" size={20} /><strong>Control plane</strong><small>Queue and deterministic routing</small></div>
          <div className={styles.topologyBranches} aria-hidden="true"><i /><i /><i /></div>
          <div className={styles.topologyTargets}>
            <div><Cloud aria-hidden="true" size={19} /><strong>Hosted</strong><small>Isolated worker</small></div>
            <div><Server aria-hidden="true" size={19} /><strong>Linux x64</strong><small>Self-hosted</small></div>
            <div><Radio aria-hidden="true" size={19} /><strong>Linux ARM64</strong><small>Self-hosted</small></div>
          </div>
        </figure>
      </section>

      <section className={styles.alwaysPrimitives} aria-labelledby="always-primitives-title">
        <header>
          <p>Operational primitives</p>
          <h2 id="always-primitives-title">Durability you can name.</h2>
          <p>{page.proof}</p>
        </header>
        <div>
          {["Heartbeats", "Leases", "Checkpoints", "Pool routing"].map((label, index) => (
            <article key={label}><span>{index + 1}</span><strong>{label}</strong><i aria-hidden="true" /></article>
          ))}
        </div>
      </section>

      <section className={styles.alwaysOperations} aria-labelledby="always-operations-title">
        <div className={styles.alwaysOperationTitle}>
          <span>One workflow, deliberate environments</span>
          <h2 id="always-operations-title">Operate the work after the laptop closes.</h2>
        </div>
        <div className={styles.alwaysBenefits}>
          {page.benefits.map((benefit, index) => (
            <article key={benefit.title}><small>0{index + 1}</small><h3>{benefit.title}</h3><p>{benefit.body}</p></article>
          ))}
        </div>
        <dl className={styles.alwaysFacts}>
          {page.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
        </dl>
      </section>

      <section className={styles.alwaysResources}>
        <RelatedDocs page={page} className={styles.alwaysDocLinks} />
        <Link href={next.href}><span>Next capability</span>{next.label}<ArrowRight aria-hidden="true" size={17} /></Link>
      </section>
    </main>
  );
}

const weatherManifest = `{
  "pluginId": "com.sandbox.examples.weather",
  "version": "1.0.0",
  "capabilities": [
    "workflow_input",
    "network",
    "structured_logging"
  ],
  "networkDomains": [{
    "domain": "api.open-meteo.com",
    "methods": ["get"]
  }]
}`;

function PluginsPage({ page }: { page: ProductPage }) {
  const next = nextProduct(page.slug);
  return (
    <main id="content" className={`${styles.productPage} ${styles.pluginsPage}`}>
      <section className={styles.pluginsHero} aria-labelledby="product-title">
        <div className={styles.pluginsHeroCopy}>
          <p><PackageCheck aria-hidden="true" size={16} /> {page.eyebrow}</p>
          <h1 id="product-title">{page.title}</h1>
          <p>{page.summary}</p>
          <div>
            <a href={documentationUrl(page.related[0])}>Read plugin documentation <ArrowUpRight aria-hidden="true" size={14} /></a>
            <Link href="/integrations">Open integrations</Link>
          </div>
        </div>
        <figure className={styles.manifestPanel}>
          <figcaption><FileCode2 aria-hidden="true" size={15} /> Repository example manifest <span>weather-data</span></figcaption>
          <pre><code>{weatherManifest}</code></pre>
        </figure>
      </section>

      <section className={styles.pluginsReceipt} aria-labelledby="plugins-receipt-title">
        <header>
          <p>Capability receipt</p>
          <h2 id="plugins-receipt-title">Review access before the node appears.</h2>
        </header>
        <div className={styles.receiptBody}>
          <div>
            <span>Runtime</span><strong>WebAssembly component</strong>
            <span>Network</span><strong>Declared domains only</strong>
            <span>Package</span><strong>Signed and immutable</strong>
            <span>Workflow</span><strong>Exact version pin</strong>
          </div>
          <aside><LockKeyhole aria-hidden="true" size={24} /><p>{page.proof}</p></aside>
        </div>
      </section>

      <section className={styles.pluginsPrinciples} aria-labelledby="plugins-principles-title">
        <h2 id="plugins-principles-title">Extension without ambient authority.</h2>
        <div>
          {page.benefits.map((benefit, index) => (
            <article key={benefit.title}><span>0{index + 1}</span><h3>{benefit.title}</h3><p>{benefit.body}</p></article>
          ))}
        </div>
      </section>

      <section className={styles.pluginsIndex}>
        <div>
          {page.details.map((detail) => <p key={detail.label}><span>{detail.label}</span><strong>{detail.value}</strong></p>)}
        </div>
        <div>
          <span>Go deeper</span>
          <RelatedDocs page={page} className={styles.pluginsDocLinks} />
        </div>
      </section>

      <section className={styles.pluginsNext}>
        <p>Extensions become shared operational surface.</p>
        <Link href={next.href}>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

const builtInRoles = ["Owner", "Administrator", "Developer", "Operator", "Viewer"];

function TeamsPage({ page }: { page: ProductPage }) {
  const next = nextProduct(page.slug);
  return (
    <main id="content" className={`${styles.productPage} ${styles.teamsPage}`}>
      <section className={styles.teamsHero} aria-labelledby="product-title">
        <p className={styles.teamsEyebrow}><Users aria-hidden="true" size={16} /> {page.eyebrow}</p>
        <div className={styles.teamsHeadline}>
          <h1 id="product-title">{page.title}</h1>
          <div><p>{page.summary}</p><a href={documentationUrl(page.related[0])}>Read workspace roles <ArrowUpRight aria-hidden="true" size={14} /></a></div>
        </div>
        <div className={styles.approvalPath} aria-label="Revision approval path">
          <span><i>1</i> Draft revision</span><ArrowRight aria-hidden="true" size={17} />
          <span><i>2</i> Required review</span><ArrowRight aria-hidden="true" size={17} />
          <span><i>3</i> Published revision</span>
        </div>
      </section>

      <section className={styles.teamsRoles} aria-labelledby="teams-roles-title">
        <div>
          <p>Built-in roles</p>
          <h2 id="teams-roles-title">Access has a shape.</h2>
          <p>{page.proof}</p>
        </div>
        <ol>
          {builtInRoles.map((role, index) => <li key={role}><span>{String(index + 1).padStart(2, "0")}</span><strong>{role}</strong></li>)}
        </ol>
      </section>

      <section className={styles.teamsGovernance} aria-labelledby="teams-governance-title">
        <header>
          <span>Governance without hiding the work</span>
          <h2 id="teams-governance-title">Make decisions visible at the moment they matter.</h2>
        </header>
        <div className={styles.governanceColumns}>
          {page.benefits.map((benefit) => <article key={benefit.title}><h3>{benefit.title}</h3><p>{benefit.body}</p></article>)}
        </div>
        <div className={styles.auditCoverage}>
          <span>Workspace audit coverage</span>
          {[
            ["Member", "Role and access changes"],
            ["Policy", "Governance changes"],
            ["Runner", "Control actions"],
            ["Publication", "Revision decisions"],
          ].map(([name, value]) => <p key={name}><strong>{name}</strong><span>{value}</span><CircleDot aria-hidden="true" size={12} /></p>)}
        </div>
      </section>

      <section className={styles.teamsReference}>
        <dl>{page.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
        <div>
          <RelatedDocs page={page} className={styles.teamsDocLinks} />
          <Link href={next.href}><span>Continue to</span>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
        </div>
      </section>
    </main>
  );
}

const apiExample = `import { SandboxApiClient } from "@sandbox/api-client";

const api = new SandboxApiClient({
  baseUrl: "https://api.sndbox.app",
  accessToken: () => process.env.SANDBOX_ACCESS_TOKEN ?? null
});

const result = await api.listPersonalAccessTokens();`;

function DevelopersPage({ page }: { page: ProductPage }) {
  const next = nextProduct(page.slug);
  return (
    <main id="content" className={`${styles.productPage} ${styles.developersPage}`}>
      <section className={styles.developerHero} aria-labelledby="product-title">
        <div className={styles.developerLead}>
          <p><Code2 aria-hidden="true" size={16} /> {page.eyebrow}</p>
          <h1 id="product-title">{page.title}</h1>
          <p>{page.summary}</p>
          <div>
            <a href={documentationUrl("developers/api")}>Read the API guide <ArrowUpRight aria-hidden="true" size={14} /></a>
            <a href={documentationUrl("plugins/sdk-setup")}>Set up the plugin SDK</a>
          </div>
        </div>
        <figure className={styles.apiPanel}>
          <figcaption><Braces aria-hidden="true" size={15} /><span>@sandbox/api-client</span><small>v1 beta contract</small></figcaption>
          <pre><code>{apiExample}</code></pre>
        </figure>
      </section>

      <section className={styles.developerToolchain} aria-labelledby="developer-toolchain-title">
        <header>
          <p>Plugin toolchain</p>
          <h2 id="developer-toolchain-title">From a directory to a reviewable package.</h2>
        </header>
        <div className={styles.cliRail} aria-label="Current plugin CLI commands">
          <p><span>$</span><code>sandbox plugin create example-plugin --plugin-id com.example.plugin --publisher-id com.example</code></p>
          <p><span>$</span><code>sandbox plugin validate</code></p>
          <p><span>$</span><code>sandbox plugin pack</code></p>
        </div>
      </section>

      <section className={styles.developerContracts} aria-labelledby="developer-contracts-title">
        <div>
          <p>Repository-backed surface</p>
          <h2 id="developer-contracts-title">Use the contract that fits the job.</h2>
          <p>{page.proof}</p>
        </div>
        <div className={styles.contractList}>
          {page.benefits.map((benefit, index) => (
            <article key={benefit.title}><span>{index + 1}</span><div><h3>{benefit.title}</h3><p>{benefit.body}</p></div><ArrowUpRight aria-hidden="true" size={16} /></article>
          ))}
        </div>
      </section>

      <section className={styles.developerIndex}>
        <div className={styles.developerFacts}>
          {page.details.map((detail) => <div key={detail.label}><span>{detail.label}</span><strong>{detail.value}</strong></div>)}
        </div>
        <div className={styles.developerResources}>
          <p><BookOpen aria-hidden="true" size={15} /> Documentation</p>
          <RelatedDocs page={page} className={styles.developerDocLinks} />
        </div>
      </section>

      <section className={styles.developerNext}>
        <div><span>The complete product loop</span><h2>Code when code is clearer. Return to the canvas when it is not.</h2></div>
        <Link href={next.href}>{next.label}<ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
    </main>
  );
}

export function ProductExperience({ page }: { page: ProductPage }) {
  switch (page.slug) {
    case "visual-workflow-builder": return <BuilderPage page={page} />;
    case "local-automation": return <LocalPage page={page} />;
    case "browser-automation": return <BrowserPage page={page} />;
    case "always-on-execution": return <AlwaysOnPage page={page} />;
    case "plugins-marketplace": return <PluginsPage page={page} />;
    case "teams-governance": return <TeamsPage page={page} />;
    case "developers": return <DevelopersPage page={page} />;
    default: return null;
  }
}
