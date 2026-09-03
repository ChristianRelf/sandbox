import type { ReferralSummary } from "@sandbox/api-client";
import { ArrowRight,Check,Clock3,Gift,ShieldCheck,Undo2,Users } from "lucide-react";
import Link from "next/link";
import { authenticatedClient } from "../../lib/auth";
import { CopyReferralButton } from "./CopyReferralButton";
import "./referrals.css";

export const dynamic="force-dynamic";

export default async function ReferralsPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const query=await searchParams;
  const client=await authenticatedClient();
  let summary:ReferralSummary|null=null;
  if(client)try{summary=(await client.getAccountReferrals()).data;}catch{}
  return <main className="portal-page referrals-page">
    <header className="page-head"><div><h1>Referrals</h1><span>Give a friend cloud credit and earn credit when they start using managed runs.</span></div><Link className="portal-secondary" href="/billing">View cloud credit <ArrowRight/></Link></header>
    {!summary?<section className="referral-unavailable"><Gift/><strong>Referral details unavailable</strong><p>Sign in again or retry when the account service is available.</p></section>:<>
      {query.referral==="not_eligible"&&!summary.claim&&<section className="referral-claim ineligible" role="alert"><ShieldCheck/><div><strong>Referral could not be claimed</strong><p>The link was invalid, already used, belonged to this account, or the new-account claim window had closed.</p></div></section>}
      {summary.claim&&<section className={`referral-claim ${summary.claim.status}`} role="status">{summary.claim.status==="rewarded"?<Check/>:summary.claim.status==="reversed"?<Undo2/>:<Clock3/>}<div><strong>{claimTitle(summary.claim.status)}</strong><p>{claimDescription(summary.claim.status,summary.policy.qualifyingTopUpCents,summary.policy.rewardMicros)}</p></div></section>}
      <section className="referral-hero">
        <div><small>YOUR INVITE LINK</small><h2>Give {formatWhole(summary.policy.rewardMicros)}. Get {formatWhole(summary.policy.rewardMicros)}.</h2><p>Send your personal link. A new account has {summary.policy.claimWindowDays} days to claim it and qualifies after adding at least {formatCents(summary.policy.qualifyingTopUpCents)} cloud credit.</p><code>{summary.shareUrl}</code><CopyReferralButton url={summary.shareUrl}/></div>
        <Gift aria-hidden="true"/>
      </section>
      <section className="referral-stats" aria-label="Referral totals">
        <article><Users/><span><small>Invited</small><strong>{summary.stats.invited}</strong></span></article>
        <article><Clock3/><span><small>Pending</small><strong>{summary.stats.pending}</strong></span></article>
        <article><Check/><span><small>Rewarded</small><strong>{summary.stats.rewarded}</strong></span></article>
        <article><Gift/><span><small>Credit earned</small><strong>{formatMicros(summary.stats.earnedMicros)}</strong></span></article>
      </section>
      <section className="referral-history">
        <header><div><h2>Invite activity</h2><p>Account details stay private; only referral state and dates are shown.</p></div></header>
        {summary.referrals.map((referral,index)=><article key={referral.id}><span className={`referral-state ${referral.status}`}>{statusIcon(referral.status)}</span><div><strong>Referral {summary.referrals.length-index}</strong><small>Claimed {formatDate(referral.claimedAt)}</small></div><span><b>{sentenceCase(referral.status)}</b><small>{referral.rewardedAt?`Rewarded ${formatDate(referral.rewardedAt)}`:referral.reversedAt?`Reversed ${formatDate(referral.reversedAt)}`:"Waiting for a qualifying top-up"}</small></span></article>)}
        {!summary.referrals.length&&<div className="referral-empty"><Users/><strong>No invites claimed yet</strong><p>Share your link to start earning cloud credit.</p></div>}
      </section>
      <section className="referral-terms"><ShieldCheck/><div><strong>Fair-use safeguards</strong><p>One referral per new account. Self-referrals and referral cycles are blocked. Rewards are limited to {summary.policy.maximumRewardsPerRollingYear} successful referrals in a rolling year and are reversed if the qualifying payment is refunded below {formatCents(summary.policy.qualifyingTopUpCents)}.</p></div></section>
    </>}
  </main>;
}

function statusIcon(status:ReferralSummary["referrals"][number]["status"]){return status==="rewarded"?<Check/>:status==="reversed"?<Undo2/>:status==="pending"?<Clock3/>:<ShieldCheck/>}
function claimTitle(status:NonNullable<ReferralSummary["claim"]>["status"]){return status==="rewarded"?"Your referral reward is ready":status==="pending"?"Referral recorded":status==="reversed"?"Referral reward reversed":"Referral is not eligible"}
function claimDescription(status:NonNullable<ReferralSummary["claim"]>["status"],minimum:number,reward:number){return status==="rewarded"?`${formatWhole(reward)} cloud credit was added to your account.`:status==="pending"?`Add at least ${formatCents(minimum)} cloud credit to give both accounts ${formatWhole(reward)} credit.`:status==="reversed"?"The qualifying payment fell below the referral threshold after a refund.":"This referral did not meet the program's fair-use rules."}
function formatMicros(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value/1_000_000)}
function formatWhole(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(value/1_000_000)}
function formatCents(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(value/100)}
function formatDate(value:string){return new Date(value).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
function sentenceCase(value:string){return value.charAt(0).toUpperCase()+value.slice(1)}
