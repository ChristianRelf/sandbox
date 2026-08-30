import { launchRelease } from "@sandbox/content";
import { ArrowRight, CheckCircle2, Download, KeyRound, LifeBuoy, Package, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { authenticatedClient } from "../lib/auth";

export const dynamic="force-dynamic";

export default async function Home() {
  const api=await authenticatedClient();
  const [profile,organisations,commerce]=api?await Promise.allSettled([api.getAccountProfile(),api.listAccountOrganisations(),api.getProductAccount()]):[];
  const account=profile?.status==="fulfilled"?profile.value.data:null;
  const organisationItems=organisations?.status==="fulfilled"?organisations.value.data.items:[];
  const product=commerce?.status==="fulfilled"?commerce.value.data:null;
  const subscription=product?.subscriptions[0];
  return <main className="portal-page">
    <header className="page-head"><div><p>ACCOUNT OVERVIEW</p><h1>{account?`Welcome, ${account.displayName}.`:"Account and operations."}</h1><span>Identity, organisations, governed workflows, security and runners in one live account boundary.</span></div><Link href="/downloads" className="portal-primary"><Download size={14}/>Downloads</Link></header>
    <section className="plan-banner"><div><small>CURRENT PLAN</small><strong>{subscription?.planName??"Local"}</strong><span>{subscription?`${subscription.status}${subscription.currentPeriodEndsAt?` · renews ${new Date(subscription.currentPeriodEndsAt).toLocaleDateString("en-GB")}`:""}`:"Local execution remains available without a product subscription."}</span></div><Link href="/billing">Billing details <ArrowRight size={13}/></Link></section>
    <section className="overview-grid">
      <article><header><Package/><span>Recent release</span></header><strong>Sandbox {launchRelease.version}</strong><p>{launchRelease.summary}</p><Link href="/releases">View release notes <ArrowRight/></Link></article>
      <article><header><Users/><span>Team workspaces</span></header><strong>{organisationItems.length} organisation{organisationItems.length===1?"":"s"}</strong><p>{organisationItems.flatMap(item=>item.workspaces).length} accessible workspaces with enforced roles and governance.</p><Link href="/organisations">Open operations <ArrowRight/></Link></article>
      <article><header><KeyRound/><span>Developer access</span></header><strong>Stable v1 API</strong><p>Personal tokens, service accounts and client assertions use the validated public contract.</p><Link href="/security">Review access <ArrowRight/></Link></article>
      <article><header><LifeBuoy/><span>Support access</span></header><strong>Approval protected</strong><p>Temporary diagnostic access is time-boxed, auditable, revocable and automatically expires.</p><Link href="/support">Support options <ArrowRight/></Link></article>
    </section>
    <section className="account-status"><h2>Service readiness</h2><p><CheckCircle2/>Account data above is loaded from the authenticated control plane.</p><p><CheckCircle2/>Encrypted sync, publication approvals, deployment preflight and runner pools are available.</p><p><ShieldCheck/>Credentials stay server-side and every workspace operation is authorised again at the API.</p></section>
  </main>;
}
