import { SandboxApiClient, type ProductPlan } from "@sandbox/api-client";
import { brand } from "@sandbox/brand";
import { ArrowRight, CircleAlert } from "lucide-react";
import Link from "next/link";

export const dynamic="force-dynamic";
export const metadata={title:"Pricing",description:"Sandbox plans with unmetered local execution and separately measured hosted usage."};

async function plans():Promise<ProductPlan[]> {
  const baseUrl=process.env.CONTROL_PLANE_URL;
  if(!baseUrl)return [];
  try{return (await new SandboxApiClient({baseUrl}).listProductPlans()).data.items;}catch{return []}
}

export default async function Page(){
  const configured=await plans();
  return <main id="content" className="index-page pricing-page"><header><p className="eyebrow"><span/>Pricing</p><h1>Local work stays<br/>off the task meter.</h1><p>Workflows running entirely on your own machines are not charged per task.</p></header>
    {!configured.length&&<aside className="config-notice"><CircleAlert size={16}/><p><strong>Pricing is not published yet.</strong> No reviewed product plans are available from the entitlement service. This page will not invent prices or allowances.</p></aside>}
    <section className="plan-grid">{configured.map((plan,index)=><article key={plan.id} className={plan.id==="pro"?"featured":""}><small>{String(index+1).padStart(2,"0")}</small><h2>{plan.displayName}</h2><p>{plan.description}</p><strong>{formatPrice(plan)}</strong><ul>{Object.entries(plan.entitlements).filter(([,enabled])=>enabled!==false).map(([key,value])=><li key={key}>{label(key,value)}</li>)}<li>Local execution unmetered</li>{Object.entries(plan.includedUsage).map(([key,value])=><li key={key}>{value.toLocaleString()} {label(key,true).toLowerCase()} included</li>)}</ul>{plan.audience==="enterprise"?<Link href="/enterprise">Contact sales <ArrowRight size={13}/></Link>:<a href={`${brand.domains.app}/sign-in?returnTo=${encodeURIComponent(`/billing?plan=${plan.id}`)}`}>Choose {plan.displayName} <ArrowRight size={13}/></a>}</article>)}</section>
    <section className="pricing-explainer"><h2>What is billed separately</h2><div><p><b>Subscription</b><span>The selected plan and billing interval shown above.</span></p><p><b>Hosted execution</b><span>Included allowance and overage policy come from the plan contract.</span></p><p><b>Managed browsers</b><span>Measured separately from local browser runs.</span></p><p><b>Marketplace plugins</b><span>Publisher pricing appears on reviewed listings.</span></p></div></section>
  </main>;
}

function formatPrice(plan:ProductPlan):string {
  if(!plan.price)return plan.audience==="enterprise"?"Contract pricing":"Free";
  return `${new Intl.NumberFormat("en-GB",{style:"currency",currency:plan.price.currency.toUpperCase(),maximumFractionDigits:2}).format(plan.price.unitAmount/100)} / ${plan.price.interval}`;
}
function label(key:string,value:boolean|number|string):string {const name=key.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ");return typeof value==="boolean"?name[0].toUpperCase()+name.slice(1):`${name[0].toUpperCase()+name.slice(1)}: ${value}`;}
