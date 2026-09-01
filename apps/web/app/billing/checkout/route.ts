import { NextRequest, NextResponse } from "next/server";
import { authenticatedClient } from "../../../lib/auth";
import { publicAppOrigin } from "../../../lib/public-origin";

export async function POST(request:NextRequest){
  const appOrigin=publicAppOrigin(process.env.OIDC_REDIRECT_URI);
  const origin=request.headers.get("origin");if(origin&&origin!==appOrigin)return NextResponse.json({error:"cross_origin_request_rejected"},{status:403});
  const form=await request.formData(),planId=String(form.get("planId")??"");if(!/^[a-z][a-z0-9_-]{1,49}$/.test(planId))return failure(appOrigin,"selection");
  const client=await authenticatedClient();if(!client)return NextResponse.redirect(new URL(`/sign-in?returnTo=${encodeURIComponent(`/billing?plan=${planId}`)}`,appOrigin),303);
  try{
    const profile=(await client.request<{accountId:string}>({path:"/v1/account/profile"})).data;
    const checkout=(await client.createProductCheckout({ownerType:"personal",ownerId:profile.accountId,planId})).data.checkout;
    const destination=new URL(checkout.url);if(destination.protocol!=="https:")throw new Error("Checkout URL must use HTTPS.");
    return NextResponse.redirect(destination,303);
  }catch{return failure(appOrigin,"configuration");}
}
function failure(appOrigin:string,error:string){return NextResponse.redirect(new URL(`/billing?error=${error}`,appOrigin),303);}
