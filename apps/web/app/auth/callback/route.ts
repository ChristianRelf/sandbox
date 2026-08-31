import { NextRequest, NextResponse } from "next/server";
import { safeReturnTo, sessionCookie } from "../../../lib/auth";

export async function GET(request:NextRequest) {
  const state=request.nextUrl.searchParams.get("state"),code=request.nextUrl.searchParams.get("code");
  if(!state||!code||state!==request.cookies.get("sandbox_oidc_state")?.value)return NextResponse.json({error:"invalid_oauth_state"},{status:400});
  const verifier=request.cookies.get("sandbox_oidc_verifier")?.value;if(!verifier)return NextResponse.json({error:"missing_pkce_verifier"},{status:400});
  const tokenResponse=await fetch(required("OIDC_TOKEN_URL"),{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","accept":"application/json"},body:new URLSearchParams({grant_type:"authorization_code",code,client_id:required("OIDC_CLIENT_ID"),redirect_uri:required("OIDC_REDIRECT_URI"),code_verifier:verifier,...(process.env.OIDC_CLIENT_SECRET?{client_secret:process.env.OIDC_CLIENT_SECRET}:{})}),cache:"no-store"});
  if(!tokenResponse.ok)return NextResponse.json({error:"token_exchange_failed"},{status:502});
  const token=await tokenResponse.json() as {access_token?:unknown;expires_in?:unknown};
  if(typeof token.access_token!=="string"||token.access_token.length<20)return NextResponse.json({error:"invalid_token_response"},{status:502});
  const profile=await fetch(`${required("CONTROL_PLANE_URL").replace(/\/$/,"")}/v1/account/profile`,{headers:{authorization:`Bearer ${token.access_token}`,accept:"application/json"},cache:"no-store"});
  if(!profile.ok){
    const failure=await profile.json().catch(()=>null) as {error?:{code?:unknown;message?:unknown};correlationId?:unknown}|null;
    const reason=typeof failure?.error?.code==="string"?failure.error.code:"upstream_rejected";
    console.warn("Account session rejected by the control plane",{status:profile.status,reason,message:typeof failure?.error?.message==="string"?failure.error.message:undefined,correlationId:typeof failure?.correlationId==="string"?failure.correlationId:profile.headers.get("x-correlation-id")??undefined});
    return NextResponse.json({error:"account_session_rejected",reason},{status:401});
  }
  const destination=new URL(safeReturnTo(request.cookies.get("sandbox_oidc_return")?.value),request.nextUrl.origin);
  const response=NextResponse.redirect(destination);
  response.cookies.set(sessionCookie,token.access_token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:typeof token.expires_in==="number"?Math.min(Math.max(token.expires_in,60),28_800):3_600,priority:"high"});
  for(const name of ["sandbox_oidc_state","sandbox_oidc_verifier","sandbox_oidc_return"])response.cookies.set(name,"",{path:"/auth",maxAge:0});
  return response;
}
function required(name:string):string{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
