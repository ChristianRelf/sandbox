import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeReturnTo } from "../../../lib/auth";

export async function GET(request:NextRequest) {
  const authorize=required("OIDC_AUTHORIZE_URL"),clientId=required("OIDC_CLIENT_ID"),redirectUri=required("OIDC_REDIRECT_URI");
  const state=randomBytes(32).toString("base64url"),verifier=randomBytes(48).toString("base64url");
  const challenge=createHash("sha256").update(verifier).digest("base64url");
  const target=new URL(authorize);
  target.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:"code",scope:"openid email profile",state,code_challenge:challenge,code_challenge_method:"S256"}).toString();
  const response=NextResponse.redirect(target);
  const options={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/auth",maxAge:600};
  response.cookies.set("sandbox_oidc_state",state,options);response.cookies.set("sandbox_oidc_verifier",verifier,options);response.cookies.set("sandbox_oidc_return",safeReturnTo(request.nextUrl.searchParams.get("returnTo")),options);
  return response;
}
function required(name:string):string{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
