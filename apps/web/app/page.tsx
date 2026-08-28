import { launchRelease } from "@sandbox/content";
import { ArrowRight, CheckCircle2, CircleAlert, Download, KeyRound, LifeBuoy, Package, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return <main className="portal-page">
    <header className="page-head"><div><p>ACCOUNT OVERVIEW</p><h1>Account and operations.</h1><span>The v0.5 GA identity, organisation, marketplace, security and runner services are connected to this portal boundary.</span></div><Link href="/downloads" className="portal-primary"><Download size={14}/>Downloads</Link></header>
    <section className="plan-banner"><div><small>CURRENT PLAN</small><strong>Product plan not configured</strong><span>Marketplace entitlements exist; product subscription and seat contracts remain a separate launch requirement.</span></div><Link href="/billing">Billing details <ArrowRight size={13}/></Link></section>
    <section className="overview-grid">
      <article><header><Package/><span>Recent release</span></header><strong>Sandbox {launchRelease.version}</strong><p>{launchRelease.summary}</p><Link href="/releases">View release notes <ArrowRight/></Link></article>
      <article><header><KeyRound/><span>Developer access</span></header><strong>Stable v1 API</strong><p>Personal tokens, service accounts and client assertions use the validated public contract.</p><Link href="/security">Review access <ArrowRight/></Link></article>
      <article><header><LifeBuoy/><span>Support access</span></header><strong>Approval protected</strong><p>Temporary diagnostic access is time-boxed, auditable, revocable and automatically expires.</p><Link href="/support">Support options <ArrowRight/></Link></article>
      <article><header><ShieldCheck/><span>Security</span></header><strong>GA controls available</strong><p>OIDC sessions, privacy controls, retention and audit routes are implemented.</p><Link href="/security">Review security <ArrowRight/></Link></article>
    </section>
    <section className="account-status"><h2>Service readiness</h2><p><CheckCircle2/>GA API, runner, workspace, privacy and guarded support-access contracts are present.</p><p><CheckCircle2/>Signed desktop, agent and container release workflow is present.</p><p className="warn"><CircleAlert/>Product-plan licences, customer support cases and a published release manifest still need dedicated contracts; those controls remain disabled.</p></section>
  </main>;
}
