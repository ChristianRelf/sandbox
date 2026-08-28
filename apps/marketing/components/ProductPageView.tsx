import Link from "next/link";
import { ArrowRight, Check, Circle, Terminal } from "lucide-react";
import type { ProductPage } from "@sandbox/content";

export function ProductPageView({ page }: { page: ProductPage }) {
  return <main id="content" className="detail-page">
    <section className="detail-hero"><p className="eyebrow"><span/>{page.eyebrow}</p><h1>{page.title}</h1><p>{page.summary}</p><Link href="/downloads" className="sb-button sb-button--primary">Download for free <ArrowRight size={15}/></Link></section>
    <section className="product-proof"><div className="product-window"><header><i/><i/><i/><span>Sandbox · Workflow inspector</span></header><div className="proof-layout"><div className="mini-flow"><article><Circle size={12}/><span>Input</span><code>report.csv</code></article><b/><article className="active"><Terminal size={12}/><span>Check result</span><code>12 rows</code></article><b/><article><Check size={12}/><span>Complete</span><code>4.8 s</code></article></div><aside><small>PRODUCT PROOF</small><p>{page.proof}</p></aside></div></div></section>
    <section className="benefit-grid">{page.benefits.map((item,index)=><article key={item.title}><span>0{index+1}</span><h2>{item.title}</h2><p>{item.body}</p></article>)}</section>
    <section className="technical-section"><div><p className="eyebrow"><span/> Technical details</p><h2>Clear boundaries by design.</h2><p>The desktop editor remains the primary place to build workflows. Web surfaces manage accounts, releases and infrastructure.</p></div><dl>{page.details.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></section>
    <section className="related-section"><div><h2>Continue in the documentation</h2><p>Detailed setup, security notes and troubleshooting live in the technical manual.</p></div><div>{page.related.map(path=><a key={path} href={`https://docs.sandbox.com/${path}`}>{path.split("/").at(-1)?.replaceAll("-"," ")} <ArrowRight size={13}/></a>)}</div></section>
    <section className="final-cta"><p className="eyebrow"><span/> Start on your machine</p><h2>Build your first local workflow.</h2><Link href="/downloads" className="sb-button sb-button--primary">Download Sandbox <ArrowRight size={15}/></Link></section>
  </main>;
}
