import { launchRelease } from "@sandbox/content";
import { ArrowRight, CircleAlert, Download, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

type Section = { title: string; description: string; available: boolean; reason?: string; items: string[] };
const sections: Record<string, Section> = {
  downloads: { title:"Downloads", description:"Access releases allowed by your account and verify every artifact.", available:false, reason:"The signed release workflow is implemented, but it does not yet publish an entitlement-aware release manifest or short-lived customer download URL.", items:["Stable, preview and development channels","Short-lived signed download links","Checksums and signatures","Platform and architecture selection"] },
  releases: { title:"Releases", description:"Review release notes and update policy before installing.", available:true, items:[`Sandbox ${launchRelease.version} · ${launchRelease.channel}`,launchRelease.summary,"Signed desktop, Linux agent and OCI-image pipeline"] },
  billing: { title:"Billing", description:"Manage the product subscription separately from marketplace purchases.", available:false, reason:"v0.5 provides Stripe marketplace purchases and entitlements, not product-plan subscriptions, seats or renewal operations.", items:["Plan and renewal","Invoices","Payment method","Change or cancel plan"] },
  usage: { title:"Usage", description:"Hosted infrastructure is measured separately from local execution.", available:true, items:["Durable hosted execution ledger","Managed browser usage events","Invoice-period reconciliation","Idempotent ingestion","Local execution · unmetered"] },
  licences: { title:"Licences", description:"See seats, devices, renewal and offline grace periods.", available:false, reason:"Plugin entitlements are implemented, but no product licence, seat assignment, device entitlement or offline-grace contract exists.", items:["Licence owner and plan","Assigned users and devices","Renewal and offline grace","Revoke device or seat"] },
  purchases: { title:"Purchases", description:"Review marketplace plugin licences and compatibility.", available:true, items:["Entitlement-checked marketplace checkout","Version and package-integrity validation","Publisher and support details","No permanent private package URLs"] },
  organisations: { title:"Organisations", description:"Manage team workspaces, members, runners and shared connections.", available:true, items:["Workspace membership and built-in roles","Shared connections by environment","Runner pairing and management","Workflow approvals and audit history"] },
  security: { title:"Security", description:"Manage sessions and account security without exposing workflow data.", available:true, items:["Verified OIDC sessions and revocation","Personal tokens and service accounts","Privacy export, deletion and retention","Audited, time-boxed support access"] },
  support: { title:"Support", description:"Share only the diagnostic data you explicitly approve.", available:false, reason:"Guarded support access and redacted diagnostic inspection are implemented. A customer support-case provider, conversation model and attachment lifecycle are not.", items:["Create and track a case","Attach an approved diagnostic bundle","Request temporary support access","Reply, close and reopen"] },
  settings: { title:"Account settings", description:"Manage account profile, export and deletion controls.", available:true, items:["Account profile route","Account data export","Session management","Deletion request with audit correlation"] },
};

type Params = Promise<{ section: string }>;
export default async function Page({ params }: { params: Params }) {
  const { section } = await params;
  const page = sections[section];
  if (!page) notFound();
  return <main className="portal-page">
    <header className="page-head"><div><p>ACCOUNT</p><h1>{page.title}</h1><span>{page.description}</span></div>{section === "downloads" && <button disabled className="portal-primary"><Download size={14}/>No eligible build</button>}</header>
    {!page.available && <section className="blocked-notice"><CircleAlert/><div><strong>Dedicated service contract required</strong><p>{page.reason}</p></div></section>}
    <section className="section-list"><header><h2>{page.available ? "Implemented capabilities" : "Required capabilities"}</h2><span>{page.available ? "Backed by the merged v0.5 control plane" : "Deliberately unavailable until its contract exists"}</span></header>{page.items.map((item,index) => <article key={item}><span>{String(index+1).padStart(2,"0")}</span><strong>{item}</strong>{page.available ? <ShieldCheck/> : <CircleAlert/>}</article>)}</section>
    {section === "releases" && <a className="cross-link" href="https://sndbox.app/changelog">Open public changelog <ArrowRight/></a>}
    {section === "support" && <p className="support-fallback">Use <a href="https://docs.sndbox.app/troubleshooting">Sandbox troubleshooting</a> before opening a case with the configured provider. Never send credentials or an unreviewed diagnostic bundle.</p>}
    {section === "purchases" && <Link className="cross-link" href="/marketplace">Browse marketplace <ArrowRight/></Link>}
  </main>;
}
