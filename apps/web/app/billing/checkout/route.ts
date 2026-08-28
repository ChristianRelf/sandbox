import { NextRequest, NextResponse } from "next/server";
import { authenticatedClient } from "../../../lib/auth";

export async function POST(request:NextRequest){
  const origin=request.headers.get("origin");if(origin&&origin!==request.nextUrl.origin)return NextResponse.json({error:"cross_origin_request_rejected"},{status:403});
  const form=await request.formData(),planId=String(form.get("planId")??"");if(!/^[a-z][a-z0-9_-]{1,49}$/.test(planId))return failure(request,"selection");
  const client=await authenticatedClient();if(!client)return NextResponse.redirect(new URL(`/sign-in?returnTo=${encodeURIComponent(`/billing?plan=${planId}`)}`,request.url),303);
  try{
    const profile=(await client.request<{accountId:string}>({path:"/v1/account/profile"})).data;
    const checkout=(await client.createProductCheckout({ownerType:"personal",ownerId:profile.accountId,planId})).data.checkout;
    const destination=new URL(checkout.url);if(destination.protocol!=="https:")throw new Error("Checkout URL must use HTTPS.");
    return NextResponse.redirect(destination,303);
  }catch{return failure(request,"configuration");}
}
function failure(request:NextRequest,error:string){return NextResponse.redirect(new URL(`/billing?error=${error}`,request.url),303);}
