import { NextRequest, NextResponse } from "next/server";
import { authenticatedClient } from "../../../lib/auth";

export async function POST(request:NextRequest){
  const appOrigin=request.nextUrl.origin;
  const origin=request.headers.get("origin");
  if(origin&&origin!==appOrigin)return NextResponse.json({error:"cross_origin_request_rejected"},{status:403});
  const form=await request.formData(),amount=Number(form.get("amount")),amountCents=Math.round(amount*100);
  if(!Number.isFinite(amount)||!Number.isSafeInteger(amountCents)||amountCents<500||amountCents>50_000)return failure(appOrigin,"topup_amount");
  const client=await authenticatedClient();
  if(!client)return NextResponse.redirect(new URL(`/sign-in?returnTo=${encodeURIComponent("/billing")}`,appOrigin),303);
  try{
    const checkout=(await client.createWalletTopUp(amountCents)).data.checkout;
    const destination=new URL(checkout.url);
    const localHttp=destination.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(destination.hostname);
    if(destination.protocol!=="https:"&&!localHttp)throw new Error("Checkout URL must use HTTPS.");
    return NextResponse.redirect(destination,303);
  }catch{return failure(appOrigin,"topup_configuration");}
}

function failure(appOrigin:string,error:string){return NextResponse.redirect(new URL(`/billing?error=${error}`,appOrigin),303);}
