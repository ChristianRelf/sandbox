import type {Pool} from "pg";
import {describe,expect,it,vi} from "vitest";
import {ActiveAccountSessionVerifier} from "./auth.js";
import type {AuthenticatedSession,SessionVerifier} from "./types.js";

const session:AuthenticatedSession={accountId:"11111111-1111-4111-8111-111111111111",sessionId:"22222222-2222-4222-8222-222222222222",subject:"identity|privacy",email:"privacy@example.com",issuedAt:new Date(),expiresAt:new Date(Date.now()+60_000),authenticationMethods:["passkey"],platformPermissions:[]};
describe("active account sessions",()=>{it("invalidates an otherwise valid identity-provider token after account deletion",async()=>{const verifier:SessionVerifier={verify:vi.fn(async()=>session)},query=vi.fn(async()=>({rowCount:0})),active=new ActiveAccountSessionVerifier(verifier,{query} as unknown as Pick<Pool,"query">);await expect(active.verify("valid-jwt")).rejects.toMatchObject({code:"invalid_session",statusCode:401});expect(query).toHaveBeenCalledWith(expect.stringContaining("deleted_at IS NULL"),[session.accountId]);});});
