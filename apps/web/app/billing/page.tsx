import type { PrepaidWalletSummary, ProductAccountSummary, ProductPlan } from "@sandbox/api-client";
import { ArrowDownLeft, ArrowRight, Check, CircleAlert, Cloud, Globe2, HardDrive, MonitorSmartphone, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
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
  let wallet: PrepaidWalletSummary | null = null;
  if (client) {
    const [planResult,accountResult,walletResult]=await Promise.allSettled([client.listProductPlans(),client.getProductAccount(),client.getAccountWallet()]);
    if(planResult.status==="fulfilled")plans=planResult.value.data.items;
    if(accountResult.status==="fulfilled")account=accountResult.value.data;
    if(walletResult.status==="fulfilled")wallet=walletResult.value.data;
  }
  const current = account?.subscriptions[0];

  return (
    <main className="portal-page billing-page">
      <header className="page-head">
        <div><h1>Billing</h1><span>Add credit for hosted runs and see exactly what each resource costs.</span></div>
        <Link className="portal-secondary" href="/usage">View usage <ArrowRight /></Link>
      </header>

      {query.topup === "success" && <section className="billing-notice success" role="status"><Check /><div><strong>Credit added</strong><p>Your payment is complete. The balance refreshes as soon as the billing event is confirmed.</p></div></section>}
      {query.topup === "cancelled" && <section className="billing-notice"><CircleAlert /><div><strong>Top-up cancelled</strong><p>No payment was taken and your balance has not changed.</p></div></section>}
      {query.error && <section className="billing-notice error" role="alert"><CircleAlert /><div><strong>Checkout could not start</strong><p>{checkoutError(query.error)}</p></div></section>}

      <section className="billing-overview-grid">
        <article className="wallet-card">
          <header><span>Cloud balance</span></header>
          <strong className="wallet-balance">{formatMicros(wallet?.balanceMicros??0)}</strong>
          <p>{wallet&&wallet.balanceMicros>0?`${formatRunway(wallet.balanceMicros,wallet.rates.hostedRunnerMicrosPerMinute)} runner time or ${formatRunway(wallet.balanceMicros,wallet.rates.managedBrowserMicrosPerMinute)} browser time remaining.`:"Add credit before starting a managed cloud run. Local and self-hosted runs stay free."}</p>
          <form action="/billing/top-up" method="post" className="topup-form">
            <label><span>Top-up amount</span><span className="money-input"><b>$</b><input aria-label="Top-up amount in dollars" name="amount" type="number" min="5" max="500" step="5" defaultValue="20" required /></span></label>
            <SubmitButton pendingLabel="Opening checkout…">Add credit</SubmitButton>
          </form>
          <small>Minimum $5 · secure checkout · no subscription required</small>
        </article>

      </section>

      <section className="billing-section-head rate-section-head">
        <div><h2>Pay for what runs</h2><p>Only managed cloud resources draw from your balance. Local and self-hosted work stays free.</p></div>
      </section>
      <section className="rate-card-list">
        <header><span>RESOURCE</span><span>WHAT IS METERED</span><span>RATE</span></header>
        <Rate icon={<Cloud />} name="Hosted runner" detail="Standard Linux execution" meter="Active compute time · 1 min minimum" price={formatRateAmount(wallet?.rates.hostedRunnerMicrosPerMinute??5_000)} unit="minute" equivalent={formatHourlyRate(wallet?.rates.hostedRunnerMicrosPerMinute??5_000)} />
        <Rate icon={<MonitorSmartphone />} name="Managed browser" detail="Isolated browser worker" meter="Active browser time · 1 min minimum" price={formatRateAmount(wallet?.rates.managedBrowserMicrosPerMinute??10_000)} unit="minute" equivalent={formatHourlyRate(wallet?.rates.managedBrowserMicrosPerMinute??10_000)} />
        <Rate icon={<Globe2 />} name="Network egress" detail="Data sent to the internet" meter="Outbound data transferred" price={formatRateAmount(wallet?.rates.networkEgressMicrosPerGib??200_000)} unit="GiB" />
        <Rate icon={<HardDrive />} name="Artifact storage" detail="Retained output over time" meter="Stored data over a month" price={formatRateAmount(wallet?.rates.artifactStorageMicrosPerGibMonth??50_000)} unit="GiB-month" />
      </section>

      <section className="billing-history-grid">
        <div className="billing-section-head"><div><h2>Credit history</h2><p>Top-ups, refunds and settled cloud usage.</p></div></div>
        <section className="wallet-history">
          {wallet?.recentEntries.map((entry)=><article key={entry.id}>
            <span className={`wallet-entry-icon ${entry.amountMicros>0?"credit":"debit"}`}>{entry.amountMicros>0?<ArrowDownLeft />:<Cloud />}</span>
            <div><strong>{entry.description}</strong><small>{new Date(entry.createdAt).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</small></div>
            <span className={entry.amountMicros>0?"credit":"debit"}>{entry.amountMicros>0?"+":"−"}{formatMicros(Math.abs(entry.amountMicros))}</span>
          </article>)}
          {!wallet?.recentEntries.length&&<div className="wallet-empty"><WalletCards /><strong>No credit activity yet</strong><p>Your first top-up and every settled cloud run will appear here.</p></div>}
        </section>
      </section>

      {plans.length>0&&<>
        <section className="plan-section-head"><div><h2>Product plans</h2></div></section>
        <section className="plan-card-grid">
          {plans.map((plan) => {
            const selected = current?.planId === plan.id;
            const features = planFeatures(plan);
            return <article className={selected ? "selected" : undefined} key={plan.id}>
              <header><span>{sentenceCase(plan.audience)}</span>{selected && <small>Current plan</small>}</header>
              <h2>{plan.displayName}</h2><p>{plan.description}</p><strong className="plan-price">{formatPrice(plan)}</strong>
              <ul>{features.map((feature) => <li key={feature}><Check /> {feature}</li>)}</ul>
              {plan.audience === "individual" ? selected ? <button className="portal-primary" disabled>Current plan</button> : <form action="/billing/checkout" method="post"><input type="hidden" name="planId" value={plan.id} /><SubmitButton pendingLabel="Opening checkout…">Choose plan</SubmitButton></form> : plan.audience === "enterprise" ? <a className="portal-secondary" href="https://sndbox.app/contact">Talk to us <ArrowRight /></a> : <Link className="portal-secondary" href="/organisations">Choose a workspace <ArrowRight /></Link>}
            </article>;
          })}
        </section>
      </>}
      <p className="billing-footnote"><ShieldCheck /> Card details are handled by the configured payment provider and never touch sndbox servers.</p>
    </main>
  );
}

function Rate({icon,name,detail,meter,price,unit,equivalent}:{icon:ReactNode;name:string;detail:string;meter:string;price:string;unit:string;equivalent?:string}){return <article><div className="rate-resource"><span>{icon}</span><div><strong>{name}</strong><small>{detail}</small></div></div><p>{meter}</p><div className="rate-price"><b>{price}</b><span>/ {unit}</span>{equivalent&&<small>{equivalent}</small>}</div></article>}
function formatMicros(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(value/1_000_000)}
function formatRateAmount(value:number){const amount=value/1_000_000;return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:amount<.01?3:2,maximumFractionDigits:3}).format(amount)}
function formatHourlyRate(value:number){return `${formatMicros(value*60)} / hour`}
function formatRunway(balance:number,rate:number){const minutes=Math.floor(balance/rate),hours=Math.floor(minutes/60),remainder=minutes%60;return hours?`${hours}h ${remainder}m`:`${minutes}m`}
function checkoutError(error:string){if(error==="topup_amount")return "Choose a top-up between $5 and $500.";if(error==="topup_configuration")return "Cloud credit checkout is not available right now.";if(error==="configuration")return "Billing is not configured for this plan.";return "Your session or selection could not be verified."}
function planFeatures(plan: ProductPlan): string[] {const included=Object.entries(plan.includedUsage).slice(0,2).map(([key,value])=>`${value.toLocaleString("en-GB")} ${sentenceCase(key.replaceAll("_"," "))}`);const features=["Unlimited local workflow runs",...included];if(plan.seatAllowance)features.push(`${plan.seatAllowance} included seat${plan.seatAllowance===1?"":"s"}`);features.push(`${plan.offlineGraceDays}-day offline grace period`);return features.slice(0,4)}
function formatPrice(plan: ProductPlan){if(!plan.price)return plan.audience==="enterprise"?"Custom":"Free";return `${new Intl.NumberFormat("en-GB",{style:"currency",currency:plan.price.currency.toUpperCase(),maximumFractionDigits:0}).format(plan.price.unitAmount/100)} / ${plan.price.interval}`}
function sentenceCase(value:string){return value.charAt(0).toUpperCase()+value.slice(1).replaceAll("_"," ")}
