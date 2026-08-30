import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDot,
  Command,
  GitBranch,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { productPages, type ProductPage } from "@sandbox/content";
import { ProductCapabilityExplorer } from "./ProductCapabilityExplorer";
import styles from "./ProductPageView.module.css";

const productOrder = [
  "visual-workflow-builder",
  "local-automation",
  "browser-automation",
  "always-on-execution",
  "plugins-marketplace",
  "teams-governance",
  "developers",
] as const;

type ProductStory = {
  chapter: string;
  handoff: [string, string, string, string];
  proofHeading: string;
  boundaryHeading: string;
  boundaryBody: string;
};

const productStories: Record<(typeof productOrder)[number], ProductStory> = {
  "visual-workflow-builder": {
    chapter: "Logic you can inspect",
    handoff: ["TRIGGER", "TYPED CANVAS", "VALIDATED ROUTE", "RUN EVIDENCE"],
    proofHeading: "Every connection earns its place.",
    boundaryHeading: "Catch structural mistakes before the runner does.",
    boundaryBody: "Connection types, required configuration, permissions and cycles are checked while the workflow is still a visible draft.",
  },
  "local-automation": {
    chapter: "The machine stays in charge",
    handoff: ["LOCAL EVENT", "APPROVED ROOT", "MACHINE RUNNER", "LOCAL HISTORY"],
    proofHeading: "Reach the machine without giving it away.",
    boundaryHeading: "Local access begins with an explicit boundary.",
    boundaryBody: "Folders, commands, private domains and stored credentials are approved independently, then enforced by the runner that can actually reach them.",
  },
  "browser-automation": {
    chapter: "Recorded, then editable",
    handoff: ["REAL ROUTINE", "SEMANTIC STEP", "MANAGED BROWSER", "FAILURE EVIDENCE"],
    proofHeading: "The recording is a starting point, not a black box.",
    boundaryHeading: "Browser state is isolated and protected fields stay protected.",
    boundaryBody: "Managed profiles, target domains, download folders and diagnostic capture remain visible controls around every recorded step.",
  },
  "always-on-execution": {
    chapter: "Durable by deliberate choice",
    handoff: ["PUBLISHED ROUTE", "RUNNER POOL", "CHECKPOINT", "RECOVERED RUN"],
    proofHeading: "Infrastructure becomes part of the route.",
    boundaryHeading: "A durable run still has a named place to execute.",
    boundaryBody: "Runner identity, pool routing, leases and checkpoints make the move from a laptop operational without making execution anonymous.",
  },
  "plugins-marketplace": {
    chapter: "Extension without ambient trust",
    handoff: ["SIGNED PACKAGE", "MANIFEST REVIEW", "CAPABILITY BROKER", "PINNED RESULT"],
    proofHeading: "Install the capability, not a blank cheque.",
    boundaryHeading: "The manifest is the contract between a plugin and its host.",
    boundaryBody: "Publisher identity, package integrity, network domains and host capabilities can be reviewed before a new node enters the workflow editor.",
  },
  "teams-governance": {
    chapter: "Shared work, separated authority",
    handoff: ["DRAFT REVISION", "REVIEW GATE", "SCOPED DEPLOYMENT", "AUDIT EVENT"],
    proofHeading: "Collaboration does not require universal control.",
    boundaryHeading: "Publication, credentials and operations remain separate decisions.",
    boundaryBody: "Roles, approvals and environment-scoped connections let contributors share the route while administrators retain the operational boundary.",
  },
  developers: {
    chapter: "Typed where it matters",
    handoff: ["VERSIONED SCHEMA", "TYPED CLIENT", "SIGNED RUNNER", "TRACEABLE RESPONSE"],
    proofHeading: "Code joins the same visible operating model.",
    boundaryHeading: "Stable contracts keep custom work from becoming hidden work.",
    boundaryBody: "Versioned schemas, declared plugin capabilities and authenticated runner protocols keep programmatic automation inside the same reviewable system.",
  },
};

const routeIcons = [CircleDot, GitBranch, Command] as const;
const detailIcons = [ScanLine, LockKeyhole, GitBranch, ShieldCheck] as const;

function productHref(slug: string) {
  return slug === "developers" ? "/developers" : `/product/${slug}`;
}

export function ProductPageView({ page }: { page: ProductPage }) {
  const productIndex = Math.max(productOrder.indexOf(page.slug as (typeof productOrder)[number]), 0);
  const story = productStories[page.slug as (typeof productOrder)[number]] ?? productStories["visual-workflow-builder"];
  const titleParts = page.title.match(/[^.]+\.?/g)?.map((part) => part.trim()).filter(Boolean) ?? [page.title];
  const nextProduct = productPages[(productIndex + 1) % productPages.length];

  return (
    <main id="content" className={`${styles.page} detail-page`} data-product={page.slug}>
      <section className={styles.hero} aria-labelledby="product-title">
        <div className={styles.heroCopy}>
          <div className={styles.heroIndex}>
            <span>PRODUCT / 0{productIndex + 1}</span>
            <span>CAPABILITY SYSTEM</span>
          </div>
          <p className={styles.eyebrow}><span />{page.eyebrow}</p>
          <h1 id="product-title">
            {titleParts.map((part, index) => <span key={part} data-tone={index === 0 ? "primary" : "secondary"}>{part}{index < titleParts.length - 1 ? " " : ""}</span>)}
          </h1>
          <p className={styles.summary}>{page.summary}</p>
          <div className={styles.heroActions}>
            <Link href="/downloads">Download for free <ArrowRight aria-hidden="true" size={15} /></Link>
            <a href="#product-proof">See how it works <ArrowDown aria-hidden="true" size={13} /></a>
          </div>
          <p className={styles.assurance}><ShieldCheck aria-hidden="true" size={12} /> {story.chapter}. Inspectable by design.</p>
        </div>

        <div className={styles.heroVisual} aria-label={`${page.eyebrow} capability map`}>
          <span className={styles.texture} aria-hidden="true" />
          <header>
            <div><i /><span>SYSTEM MAP / 0{productIndex + 1}</span></div>
            <small>READY TO INSPECT</small>
          </header>
          <div className={styles.routePlate}>
            <div className={styles.routeTitle}>
              <span>ACTIVE CAPABILITY</span>
              <strong>{page.eyebrow}</strong>
              <small>{page.slug.replaceAll("-", "_")}</small>
            </div>
            <ol>
              {page.details.slice(0, 3).map((detail, index) => {
                const Icon = routeIcons[index];
                return (
                  <li key={detail.label}>
                    <span>0{index + 1}</span>
                    <Icon aria-hidden="true" size={14} />
                    <div><small>{detail.label}</small><strong>{detail.value}</strong></div>
                    <Check aria-hidden="true" size={12} />
                  </li>
                );
              })}
            </ol>
            <footer><span><i /> VERIFIED ROUTE</span><small>{page.details[3]?.value}</small></footer>
          </div>
          <a className={styles.discover} href="#product-proof">
            <span>DISCOVER</span><small>Trace this capability</small><ArrowDown aria-hidden="true" size={13} />
          </a>
        </div>
      </section>

      <ol className={styles.handoff} aria-label={`${page.eyebrow} progresses from ${story.handoff[0]} to ${story.handoff[3]}`}>
        {story.handoff.map((step, index) => <li key={step}><span>0{index + 1}</span><strong>{step}</strong></li>)}
      </ol>

      <section id="product-proof" className={styles.method} aria-labelledby="method-title">
        <div className={styles.methodInner}>
          <header className={styles.sectionHeader}>
            <div className={styles.discoverLabel}><span>DISCOVER</span><small>02 / INSPECT THE CAPABILITY</small></div>
            <h2 id="method-title">{story.proofHeading}</h2>
            <p>Select each decision to see how configuration, capability and evidence stay connected.</p>
          </header>
          <ProductCapabilityExplorer product={page.slug} items={page.benefits} details={page.details} proof={page.proof} />
        </div>
      </section>

      <section className={styles.boundary} aria-labelledby="boundary-title">
        <div className={styles.boundaryCopy}>
          <div className={styles.darkDiscover}><span>DISCOVER</span><small>03 / VERIFY THE BOUNDARY</small></div>
          <h2 id="boundary-title">{story.boundaryHeading}</h2>
          <p>{story.boundaryBody}</p>
          <Link href="/security">Review the security model <ArrowRight aria-hidden="true" size={14} /></Link>
        </div>
        <dl>
          {page.details.map((detail, index) => {
            const Icon = detailIcons[index];
            return (
              <div key={detail.label}>
                <dt><span><Icon aria-hidden="true" size={17} /></span><b>{detail.label}</b><small>0{index + 1}</small></dt>
                <dd>{detail.value}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className={styles.evidence} aria-labelledby="evidence-title">
        <header>
          <p>04 / PRODUCT PROOF</p>
          <h2 id="evidence-title">A claim should leave a trace.</h2>
          <blockquote>{page.proof}</blockquote>
        </header>
        <div className={styles.evidenceLedger}>
          <div className={styles.ledgerHeader}><span>INSPECTION / {String(productIndex + 1).padStart(2, "0")}</span><strong><i /> COMPLETE</strong></div>
          <ol>
            {page.details.map((detail, index) => (
              <li key={detail.label}>
                <span>00:0{index}</span>
                <Check aria-hidden="true" size={11} />
                <div><small>{detail.label}</small><strong>{detail.value}</strong></div>
                <b>VERIFIED</b>
              </li>
            ))}
          </ol>
          <footer><ShieldCheck aria-hidden="true" size={12} /> Evidence stays attached to the product boundary.</footer>
        </div>
      </section>

      <section className={styles.docs} aria-labelledby="docs-title">
        <header>
          <div className={styles.discoverLabel}><span>DISCOVER</span><small>05 / CONTINUE THE ROUTE</small></div>
          <h2 id="docs-title">Go deeper without losing the context.</h2>
          <p>Setup, security notes and troubleshooting continue in the technical manual.</p>
        </header>
        <div>
          {page.related.map((path, index) => (
            <a href={`https://docs.sndbox.app/${path}`} key={path}>
              <span>0{index + 1}</span>
              <div><small>DOCUMENTATION</small><strong>{path.split("/").at(-1)?.replaceAll("-", " ")}</strong><code>/{path}</code></div>
              <footer><b>DISCOVER</b><small>Read this guide</small><ArrowUpRight aria-hidden="true" size={14} /></footer>
            </a>
          ))}
        </div>
      </section>

      <section className={styles.directory} aria-labelledby="directory-title">
        <header>
          <p>PRODUCT SYSTEM / 07 CAPABILITIES</p>
          <h2 id="directory-title">The route continues.</h2>
        </header>
        <nav aria-label="Product pages">
          {productPages.map((product, index) => (
            <Link href={productHref(product.slug)} aria-current={product.slug === page.slug ? "page" : undefined} key={product.slug}>
              <span>0{index + 1}</span><strong>{product.eyebrow}</strong>
            </Link>
          ))}
        </nav>
        <Link className={styles.nextProduct} href={productHref(nextProduct.slug)}>
          <span>NEXT CAPABILITY</span><strong>{nextProduct.eyebrow}</strong><ArrowRight aria-hidden="true" size={18} />
        </Link>
      </section>
    </main>
  );
}
