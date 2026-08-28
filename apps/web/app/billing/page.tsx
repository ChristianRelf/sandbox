import type { ProductAccountSummary, ProductPlan } from "@sandbox/api-client";
import { CreditCard, ShieldCheck } from "lucide-react";
import { authenticatedClient } from "../../lib/auth";
import "./billing.css";

export const dynamic="force-dynamic";
type SearchParams=Promise<Record<string,string|undefined>>;

export default async function BillingPage({searchParams}:{searchParams:SearchParams}) {
  const query=await searchParams,client=await authenticatedClient();
  let plans:ProductPlan[]=[],account:ProductAccountSummary|null=null;
  if(client)try{[plans,account]=await Promise.all([(await client.listProductPlans()).data.items,(await client.getProductAccount()).data]);}catch{}
  const current=account?.subscriptions[0];
  return <main className="portal-page"><header className="page-head"><div><p>ACCOUNT</p><h1>Billing</h1><span>Subscriptions and marketplace purchases remain separate.</span></div></header>
    {query.error&&<section className="blocked-notice" role="alert"><CreditCard/><div><strong>Checkout could not start</strong><p>{query.error==="configuration"?"Billing is not configured for this plan.":"Your session or selected plan could not be verified."}</p></div></section>}
    <section className="plan-banner"><div><small>CURRENT PRODUCT PLAN</small><strong>{current?.planName??"Local"}</strong><span>{current?`${current.status}${current.currentPeriodEndsAt?` · period ends ${new Date(current.currentPeriodEndsAt).toLocaleDateString("en-GB")}`:""}`:"Local execution remains available without a subscription."}</span></div></section>
    <section className="section-list billing-plans"><header><h2>Available plans</h2><span>Loaded from the product entitlement service</span></header>{plans.map(plan=><article key={plan.id}><span><ShieldCheck/></span><strong>{plan.displayName} · {formatPrice(plan)}</strong>{plan.audience==="individual"?<form action="/billing/checkout" method="post"><input type="hidden" name="planId" value={plan.id}/><button className="portal-primary" disabled={current?.planId===plan.id}>{current?.planId===plan.id?"Current":"Choose"}</button></form>:<span>{plan.audience==="enterprise"?"Contact sales":"Choose an organisation"}</span>}</article>)}{!plans.length&&<article><span>—</span><strong>No published plans are available.</strong><span>Configuration required</span></article>}</section>
  </main>;
}
function formatPrice(plan:ProductPlan){if(!plan.price)return plan.audience==="enterprise"?"Contract":"Free";return `${new Intl.NumberFormat("en-GB",{style:"currency",currency:plan.price.currency.toUpperCase()}).format(plan.price.unitAmount/100)} / ${plan.price.interval}`;}
