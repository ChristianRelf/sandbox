import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  ListChecks,
  TriangleAlert,
} from "lucide-react";
import { docs } from "../../lib/content";

type Params = Promise<{ slug?: string[] }>;

export function generateStaticParams() {
  return docs.map(page => ({ slug: page.slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const page = docs.find(candidate => candidate.slug === (slug?.join("/") ?? "getting-started"));
  if (!page) return {};

  const articleMetadata = {
    title: page.title,
    description: page.description,
  };

  return slug?.length
    ? {
        ...articleMetadata,
        openGraph: { ...articleMetadata, images: [] },
        twitter: { ...articleMetadata, images: [] },
      }
    : articleMetadata;
}

export default async function Page({ params }: { params: Params }) {
  const { slug } = await params;
  const page = docs.find(candidate => candidate.slug === (slug?.join("/") ?? "getting-started"));
  if (!page) notFound();

  const index = docs.indexOf(page);
  const previous = docs[index - 1];
  const next = docs[index + 1];
  const articleText = [page.description, ...page.steps.flatMap(step => [step.title, step.body]), ...(page.concepts?.flatMap(item => [item.title, item.body]) ?? [])].join(" ");
  const readMinutes = Math.max(3, Math.ceil(articleText.split(/\s+/).length / 180));
  const prerequisiteNumber = page.prerequisites ? 1 : 0;
  const conceptNumber = prerequisiteNumber + (page.concepts ? 1 : 0);
  const procedureNumber = conceptNumber + 1;

  return <main id="doc" className="doc-page">
    <div className="doc-shell">
      <div className="doc-column">
        <div className="breadcrumbs"><Link href="/getting-started">Docs</Link><span>/</span><span>{page.section}</span><span>/</span><b>{page.title}</b></div>
        <article className="doc-article">
          <header className="doc-header">
            <div className="article-badges">
              <span className="version">Applies to {page.version}</span>
              <span className="review"><Clock3 size={11}/>Reviewed {page.reviewed}</span>
              <span className="read-time"><BookOpen size={11}/>{readMinutes} min read</span>
            </div>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <div className="article-facts" aria-label="Article summary">
              <div><span>SECTION</span><strong>{page.section}</strong></div>
              <div><span>PROCEDURE</span><strong>{page.steps.length} steps</strong></div>
              <div><span>OUTCOME</span><strong>Verifiable result</strong></div>
            </div>
          </header>

          {page.prerequisites && <section id="prerequisites" className="prerequisites">
            <div className="section-heading"><span>{String(prerequisiteNumber).padStart(2, "0")}</span><div><small>BEFORE YOU BEGIN</small><h2>Prerequisites</h2></div></div>
            <ul>{page.prerequisites.map(value => <li key={value}><CheckCircle2 size={13}/>{value}</li>)}</ul>
          </section>}

          {page.concepts && <section id="key-concepts">
            <div className="section-heading"><span>{String(conceptNumber).padStart(2, "0")}</span><div><small>MENTAL MODEL</small><h2>Key concepts</h2></div></div>
            <div className="concept-grid">{page.concepts.map(item => <article key={item.title}><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
          </section>}

          {page.notes && <aside className="article-notes" aria-label="Important notes">
            <strong>Keep in mind</strong>
            {page.notes.map(note => <p key={note}>{note}</p>)}
          </aside>}

          <section id="procedure">
            <div className="section-heading"><span>{String(procedureNumber).padStart(2, "0")}</span><div><small>PROCEDURE</small><h2>How it works</h2></div></div>
            <ol className="steps">{page.steps.map((step, stepIndex) => <li key={step.title}>
              <span>{String(stepIndex + 1).padStart(2, "0")}</span>
              <div><h3>{step.title}</h3><p>{step.body}</p>{step.code && <pre><code>{step.code}</code></pre>}</div>
            </li>)}</ol>
          </section>

          <section id="expected-result" className="expected">
            <CheckCircle2 size={18}/>
            <div><small>VERIFY YOUR WORK</small><h2>Expected result</h2><p>{page.result}</p></div>
          </section>

          <section id="troubleshooting">
            <div className="section-heading"><span>!</span><div><small>IF SOMETHING FAILS</small><h2>Common errors</h2></div></div>
            <div className="error-list">{page.errors.map(error => <p className="error" key={error}><TriangleAlert size={14}/><span>{error}</span></p>)}</div>
          </section>

          <section id="related-pages">
            <div className="section-heading"><span>→</span><div><small>KEEP READING</small><h2>Related pages</h2></div></div>
            <div className="related">{page.related.map(path => {
              const relatedPage = docs.find(candidate => candidate.slug === path);
              return <Link href={`/${path}`} key={path}><span><small>{relatedPage?.section ?? "Documentation"}</small><strong>{relatedPage?.title ?? path.replaceAll("-", " ")}</strong></span><ArrowRight size={13}/></Link>;
            })}</div>
          </section>
        </article>

        <nav className="pager" aria-label="Article pagination">
          {previous ? <Link href={`/${previous.slug}`}><ArrowLeft size={14}/><span>Previous<small>{previous.title}</small></span></Link> : <span/>}
          {next && <Link href={`/${next.slug}`}><span>Next<small>{next.title}</small></span><ArrowRight size={14}/></Link>}
        </nav>
      </div>

      <aside className="article-toc">
        <div><ListChecks size={13}/><span>ON THIS PAGE</span></div>
        {page.prerequisites && <a href="#prerequisites">Prerequisites</a>}
        {page.concepts && <a href="#key-concepts">Key concepts</a>}
        <a href="#procedure">How it works</a>
        <a href="#expected-result">Expected result</a>
        <a href="#troubleshooting">Common errors</a>
        <a href="#related-pages">Related pages</a>
        <footer><span>Was this guide useful?</span><small>Use Support for corrections or gaps.</small></footer>
      </aside>
    </div>
  </main>;
}
