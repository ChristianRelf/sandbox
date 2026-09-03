import "server-only";
import { SandboxApiClient } from "@sandbox/api-client";
import { cookies } from "next/headers";

export const sessionCookie="sandbox_session";
export const referralCookie="sandbox_referral";

export async function authenticatedClient():Promise<SandboxApiClient|null> {
  const token=(await cookies()).get(sessionCookie)?.value;
  const baseUrl=process.env.CONTROL_PLANE_URL;
  return token&&baseUrl?new SandboxApiClient({baseUrl,accessToken:token}):null;
}

export function safeReturnTo(value:string|null|undefined):string {
  return value?.startsWith("/")&&!value.startsWith("//")&&!value.includes("\\")?value:"/";
}
