import type {Pool} from "pg";
import {describe,expect,it,vi} from "vitest";
import {ActiveAccountSessionVerifier,ProvisioningAccountSessionVerifier} from "./auth.js";
import type {AuthenticatedSession,SessionVerifier} from "./types.js";

const session:AuthenticatedSession={accountId:"11111111-1111-4111-8111-111111111111",sessionId:"22222222-2222-4222-8222-222222222222",subject:"identity|privacy",email:"privacy@example.com",issuedAt:new Date(),expiresAt:new Date(Date.now()+60_000),authenticationMethods:["passkey"],platformPermissions:[]};
describe("active account sessions",()=>{it("invalidates an otherwise valid identity-provider token after account deletion",async()=>{const verifier:SessionVerifier={verify:vi.fn(async()=>session)},query=vi.fn(async()=>({rowCount:0})),active=new ActiveAccountSessionVerifier(verifier,{query} as unknown as Pick<Pool,"query">);await expect(active.verify("valid-jwt")).rejects.toMatchObject({code:"invalid_session",statusCode:401});expect(query).toHaveBeenCalledWith(expect.stringContaining("deleted_at IS NULL"),[session.accountId]);});});

describe("beta account provisioning",()=>{
  it("creates the database account only after a valid identity token",async()=>{
    const verifier:SessionVerifier={verify:vi.fn(async()=>session)};
    const query=vi.fn(async()=>({rowCount:1}));
    const provisioning=new ProvisioningAccountSessionVerifier(verifier,{query} as unknown as Pick<Pool,"query">);
    await expect(provisioning.verify("valid-jwt")).resolves.toEqual(session);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO accounts"),[session.accountId,session.subject,session.email,"privacy"]);
  });

  it("fails closed when an email or identity belongs to another account",async()=>{
    const verifier:SessionVerifier={verify:vi.fn(async()=>session)};
    const query=vi.fn(async()=>{throw Object.assign(new Error("unique violation"),{code:"23505"});});
    const provisioning=new ProvisioningAccountSessionVerifier(verifier,{query} as unknown as Pick<Pool,"query">);
    await expect(provisioning.verify("valid-jwt")).rejects.toMatchObject({code:"account_identity_conflict",statusCode:409});
  });
});
