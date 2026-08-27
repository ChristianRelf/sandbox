import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedSession } from "./types.js";
import { CompositeSessionVerifier, PostgresCredentialService } from "./credentials.js";

const connectionString=process.env.TEST_DATABASE_URL;
const integration=connectionString?describe:describe.skip;

integration("service accounts and access tokens",()=>{
  const pool=new Pool({connectionString,max:4});
  const credentials=new PostgresCredentialService(pool,randomBytes(32));
  const accountId=randomUUID(),organisationId=randomUUID(),workspaceId=randomUUID(),environmentId=randomUUID(),ownerRoleId=randomUUID(),serviceRoleId=randomUUID();
  const actor:AuthenticatedSession={accountId,sessionId:randomUUID(),subject:`user:${accountId}`,email:`${accountId}@example.invalid`,issuedAt:new Date(),expiresAt:new Date(Date.now()+3600_000),authenticationMethods:["passkey"],platformPermissions:[]};
  let serviceAccountId:string;
  let servicePrincipalId:string;

  beforeAll(async()=>{
    await pool.query(`INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name) VALUES($1,$2,$3,true,'Credential owner')`,[accountId,actor.subject,actor.email]);
    await pool.query(`INSERT INTO organisations(id,name,slug,created_by) VALUES($1,'Credential audit',$2,$3)`,[organisationId,`credential-${organisationId}`,accountId]);
    await pool.query(`INSERT INTO roles(id,organisation_id,role_key,display_name,built_in) VALUES($1,$2,'owner','Owner',true),($3,$2,'automation','Automation',false)`,[ownerRoleId,organisationId,serviceRoleId]);
    await pool.query(`INSERT INTO role_permissions(role_id,permission) VALUES($1,'service_accounts.manage'),($1,'api_credentials.manage'),($1,'workflows.run'),($2,'workflows.run'),($2,'workflows.view')`,[ownerRoleId,serviceRoleId]);
    await pool.query(`INSERT INTO memberships(organisation_id,account_id,role_id) VALUES($1,$2,$3)`,[organisationId,accountId,ownerRoleId]);
    await pool.query(`INSERT INTO workspaces(id,organisation_id,name,slug,created_by) VALUES($1,$2,'Credential workspace','credentials',$3)`,[workspaceId,organisationId,accountId]);
    await pool.query(`INSERT INTO workspace_memberships(workspace_id,account_id,role_id) VALUES($1,$2,$3)`,[workspaceId,accountId,ownerRoleId]);
    await pool.query(`INSERT INTO environments(id,workspace_id,environment_key) VALUES($1,$2,'production')`,[environmentId,workspaceId]);
  });
  afterAll(async()=>{await pool.query(`DELETE FROM organisations WHERE id=$1`,[organisationId]).catch(()=>undefined);await pool.query(`DELETE FROM accounts WHERE identity_subject LIKE 'service-account:%' OR id=$1`,[accountId]).catch(()=>undefined);await pool.end();});

  it("issues a show-once hashed PAT, enforces expiry, verifies restrictions, and revokes it",async()=>{
    const issued=await credentials.issuePersonalToken(actor,{name:"CI token",scopes:["workflows.run"],organisationId,workspaceIds:[workspaceId],environmentIds:[environmentId],expiresAt:new Date(Date.now()+7*86_400_000)},randomUUID());
    expect(issued.token).toMatch(/^sbx_pat_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/);
    const stored=await pool.query<{ token_hash:Buffer }>(`SELECT token_hash FROM access_tokens WHERE id=$1`,[issued.id]);
    expect(stored.rows[0].token_hash.toString("utf8")).not.toContain(issued.token);
    const verified=await credentials.verify(issued.token);
    expect(verified).toMatchObject({accountId,principalType:"personal_access_token",credentialScopes:["workflows.run"],workspaceRestrictions:[workspaceId],environmentRestrictions:[environmentId]});
    expect(await credentials.listPersonalTokens(actor)).toEqual([expect.objectContaining({id:issued.id,prefix:issued.prefix,lastUsedAt:expect.any(String)})]);
    expect(await credentials.revokeToken(actor,issued.id,"rotation",randomUUID())).toBe(true);
    await expect(credentials.verify(issued.token)).rejects.toMatchObject({code:"invalid_session"});
    await expect(credentials.issuePersonalToken(actor,{name:"Permanent",scopes:["workflows.run"],organisationId,workspaceIds:[workspaceId],environmentIds:[],expiresAt:new Date(Date.now()+91*86_400_000)},randomUUID())).rejects.toMatchObject({code:"credential_expiry_invalid"});
  });

  it("creates a non-interactive service principal with a human owner and role-bounded credential",async()=>{
    const service=await credentials.createServiceAccount(actor,{workspaceId,name:"Deployment bot",description:"Applies reviewed deployments",roleId:serviceRoleId,environmentIds:[environmentId],expiryPolicyDays:30},randomUUID());
    serviceAccountId=service.id;
    expect(service).toMatchObject({organisationId,workspaceId,ownerAccountIds:[accountId],environmentIds:[environmentId],status:"active"});
    const principal=await pool.query<{ account_kind:string;identity_subject:string }>(`SELECT account_kind,identity_subject FROM accounts account JOIN service_accounts service ON service.principal_account_id=account.id WHERE service.id=$1`,[service.id]);
    servicePrincipalId=(await pool.query<{ principal_account_id:string }>(`SELECT principal_account_id FROM service_accounts WHERE id=$1`,[service.id])).rows[0].principal_account_id;
    expect(principal.rows[0]).toEqual({account_kind:"service_account",identity_subject:`service-account:${service.id}`});
    const issued=await credentials.issueServiceAccountToken(actor,service.id,{name:"Production deploy",scopes:["workflows.run"],organisationId,workspaceIds:[workspaceId],environmentIds:[environmentId],expiresAt:new Date(Date.now()+14*86_400_000)},randomUUID());
    expect(issued.token).toMatch(/^sbx_sa_/);
    expect(await credentials.verify(issued.token)).toMatchObject({principalType:"service_account",principalId:service.id,credentialScopes:["workflows.run"],principalPermissions:expect.arrayContaining(["workflows.run","workflows.view"])});
    await expect(credentials.issueServiceAccountToken(actor,service.id,{name:"Escalated",scopes:["organisation.delete"],organisationId,workspaceIds:[workspaceId],environmentIds:[environmentId],expiresAt:new Date(Date.now()+86_400_000)},randomUUID())).rejects.toMatchObject({code:"credential_scope_denied"});
    const interactive=new CompositeSessionVerifier({verify:async()=>({...actor,accountId:servicePrincipalId})},credentials);
    await expect(interactive.verify("oidc-token")).rejects.toMatchObject({code:"interactive_login_forbidden"});
    const client=await pool.connect();
    try{await client.query('BEGIN');await client.query(`DELETE FROM service_account_owners WHERE service_account_id=$1`,[service.id]);await expect(client.query('COMMIT')).rejects.toThrow(/human_owner_required/);}finally{await client.query('ROLLBACK').catch(()=>undefined);client.release();}
  });

  it("keeps credential metadata hidden from a different tenant at the RLS boundary",async()=>{
    const outsiderId=randomUUID();await pool.query(`INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name) VALUES($1,$2,$3,true,'Outsider')`,[outsiderId,`outsider:${outsiderId}`,`${outsiderId}@example.invalid`]);
    await pool.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_v050_rls_test') THEN CREATE ROLE sandbox_v050_rls_test NOLOGIN; END IF; END $$`);
    await pool.query(`GRANT SELECT ON service_accounts,access_tokens,service_account_owners TO sandbox_v050_rls_test`);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query(`SET LOCAL ROLE sandbox_v050_rls_test`);await client.query(`SELECT set_config('app.account_id',$1,true)`,[outsiderId]);
      expect((await client.query(`SELECT id FROM service_accounts WHERE id=$1`,[serviceAccountId])).rowCount).toBe(0);
      expect((await client.query(`SELECT id FROM access_tokens`)).rowCount).toBe(0);await client.query('ROLLBACK');
      await client.query('BEGIN');await client.query(`SET LOCAL ROLE sandbox_v050_rls_test`);await client.query(`SELECT set_config('app.account_id',$1,true)`,[accountId]);
      expect((await client.query(`SELECT id FROM service_accounts WHERE id=$1`,[serviceAccountId])).rowCount).toBe(1);
      expect((await client.query(`SELECT id FROM access_tokens`)).rowCount).toBeGreaterThan(0);await client.query('ROLLBACK');
    }finally{await client.query('ROLLBACK').catch(()=>undefined);client.release();await pool.query(`DELETE FROM accounts WHERE id=$1`,[outsiderId]);}
  });
});
