import type { ProductAccountSummary, ProductPlan } from "@sandbox/api-client";
import { ArrowRight, Check, CircleAlert, CreditCard, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { SubmitButton } from "../SubmitButton";
import { authenticatedClient } from "../../lib/auth";
import "./billing.css";

export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | undefined>>;

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const client = await authenticatedClient();
  let plans: ProductPlan[] = [];
  let account: ProductAccountSummary | null = null;
  if (client) {
    try {
      [plans, account] = await Promise.all([
        (await client.listProductPlans()).data.items,
        (await client.getProductAccount()).data,
      ]);
    } catch {}
  }
  const current = account?.subscriptions[0];

  return (
    <main className="portal-page billing-page">
      <header className="page-head">
        <div><p>ACCOUNT</p><h1>Plan & billing</h1><span>Review your current plan and available account options.</span></div>
      </header>
      {query.error && <section className="blocked-notice" role="alert"><CircleAlert /><div><strong>Checkout could not start</strong><p>{query.error === "configuration" ? "Billing is not configured for this plan." : "Your session or selected plan could not be verified."}</p></div></section>}

      <section className="current-plan-card">
        <span className="settings-card-icon"><CreditCard /></span>
        <div><small>CURRENT PLAN</small><strong>{current?.planName ?? "Local"}</strong><p>{current ? `${sentenceCase(current.status)}${current.currentPeriodEndsAt ? ` · renews ${new Date(current.currentPeriodEndsAt).toLocaleDateString("en-GB")}` : ""}` : "Run workflows on your own devices with no task limits."}</p></div>
        <span className="health-badge"><ShieldCheck /> {current?.status === "past_due" ? "Action needed" : "Active"}</span>
      </section>

      <section className="plan-section-head"><div><small>PLANS</small><h2>Available plans</h2></div><Link href="/usage">Review usage <ArrowRight /></Link></section>
      {plans.length ? (
        <section className="plan-card-grid">
          {plans.map((plan) => {
            const selected = current?.planId === plan.id;
            const features = planFeatures(plan);
            return (
              <article className={selected ? "selected" : undefined} key={plan.id}>
                <header><span>{sentenceCase(plan.audience)}</span>{selected && <small>Current plan</small>}</header>
                <h2>{plan.displayName}</h2>
                <p>{plan.description}</p>
                <strong className="plan-price">{formatPrice(plan)}</strong>
                <ul>{features.map((feature) => <li key={feature}><Check /> {feature}</li>)}</ul>
                {plan.audience === "individual" ? (
                  selected ? <button className="portal-primary" disabled>Current plan</button> : <form action="/billing/checkout" method="post"><input type="hidden" name="planId" value={plan.id} /><SubmitButton pendingLabel="Opening checkout…">Choose plan</SubmitButton></form>
                ) : plan.audience === "enterprise" ? (
                  <a className="portal-secondary" href="https://sndbox.app/contact">Talk to us <ArrowRight /></a>
                ) : (
                  <Link className="portal-secondary" href="/organisations">Choose a workspace <ArrowRight /></Link>
                )}
              </article>
            );
          })}
        </section>
      ) : (
        <section className="billing-empty"><CreditCard /><h2>No upgrade plans are published yet.</h2><p>Your Local plan remains available and unmetered. Published plans will appear here automatically.</p></section>
      )}
      <p className="billing-footnote"><ShieldCheck /> Checkout is handled by the configured billing provider. sndbox does not collect card details on this page.</p>
    </main>
  );
}

function planFeatures(plan: ProductPlan): string[] {
  const included = Object.entries(plan.includedUsage).slice(0, 2).map(([key, value]) => `${value.toLocaleString("en-GB")} ${sentenceCase(key.replaceAll("_", " "))}`);
  const features = ["Unlimited local workflow runs", ...included];
  if (plan.seatAllowance) features.push(`${plan.seatAllowance} included seat${plan.seatAllowance === 1 ? "" : "s"}`);
  features.push(`${plan.offlineGraceDays}-day offline grace period`);
  return features.slice(0, 4);
}

function formatPrice(plan: ProductPlan) {
  if (!plan.price) return plan.audience === "enterprise" ? "Custom" : "Free";
  return `${new Intl.NumberFormat("en-GB", { style: "currency", currency: plan.price.currency.toUpperCase(), maximumFractionDigits: 0 }).format(plan.price.unitAmount / 100)} / ${plan.price.interval}`;
}

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
