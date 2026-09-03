import { NextRequest,NextResponse } from "next/server";
import { referralCookie } from "../../../lib/auth";
import { publicAppOrigin } from "../../../lib/public-origin";

export async function GET(request:NextRequest,{params}:{params:Promise<{code:string}>}){
  const code=(await params).code.trim().toLowerCase();
  const origin=publicAppOrigin(required("OIDC_REDIRECT_URI"));
  if(!/^[a-z0-9]{12,24}$/.test(code))return NextResponse.redirect(new URL("/sign-in?referral=invalid",origin),303);
  const response=NextResponse.redirect(new URL(`/sign-in?returnTo=${encodeURIComponent("/referrals?referred=1")}&referral=invited`,origin),303);
  response.cookies.set(referralCookie,code,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:30*86_400,priority:"high"});
  return response;
}

function required(name:string):string{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
