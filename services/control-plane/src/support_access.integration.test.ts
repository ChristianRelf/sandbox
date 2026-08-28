import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSupportAccess } from "./support_access.js";
import type { AuthenticatedSession } from "./types.js";

const connectionString=process.env.TEST_DATABASE_URL;
const integration=connectionString?describe:describe.skip;

integration("customer-approved support access",()=>{
  const pool=new Pool({connectionString,max:4}),supportAccess=new PostgresSupportAccess(pool);
  const supportAccountId=randomUUID(),customerAccountId=randomUUID(),organisationId=randomUUID(),workspaceId=randomUUID(),roleId=randomUUID();
  const actor=(accountId:string,platformPermissions:string[]=[]):AuthenticatedSession=>({accountId,sessionId:randomUUID(),subject:`test:${accountId}`,email:`${accountId}@example.invalid`,issuedAt:new Date(),expiresAt:new Date(Date.now()+3_600_000),authenticationMethods:["passkey"],platformPermissions});

  beforeAll(async()=>{
    await pool.query(`INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name) VALUES($1,$2,$3,true,'Support operator'),($4,$5,$6,true,'Customer administrator')`,[supportAccountId,`support-${supportAccountId}`,`${supportAccountId}@example.invalid`,customerAccountId,`customer-${customerAccountId}`,`${customerAccountId}@example.invalid`]);
    await pool.query(`INSERT INTO organisations(id,name,slug,created_by) VALUES($1,'Support access test',$2,$3)`,[organisationId,`support-${organisationId}`,customerAccountId]);
    await pool.query(`INSERT INTO roles(id,organisation_id,role_key,display_name,built_in) VALUES($1,$2,'support-test','Support test',true)`,[roleId,organisationId]);
    await pool.query(`INSERT INTO workspaces(id,organisation_id,name,slug,created_by) VALUES($1,$2,'Support workspace','support',$3)`,[workspaceId,organisationId,customerAccountId]);
    await pool.query(`INSERT INTO workspace_memberships(workspace_id,account_id,role_id) VALUES($1,$2,$3)`,[workspaceId,customerAccountId,roleId]);
  });

  afterAll(async()=>{await pool.end();});

  it("denies access until a different customer actor approves and records every use",async()=>{
    const staff=actor(supportAccountId,["support_access.manage"]),customer=actor(customerAccountId),correlationId="support-correlation-0001";
    const requested=await supportAccess.request(staff,workspaceId,"Investigate aggregate runner capacity failures.",["diagnostics.read"],60,correlationId);
    await expect(supportAccess.diagnostics(staff,requested.id,correlationId)).rejects.toMatchObject({code:"support_access_denied"});
    await expect(supportAccess.decide(staff,requested.id,"approve","Self approval attempt.",correlationId)).rejects.toMatchObject({code:"support_self_approval_denied"});
    const approved=await supportAccess.decide(customer,requested.id,"approve","Approved for aggregate diagnostics only.",correlationId);
    expect(approved.status).toBe("approved");
    const diagnostics=await supportAccess.diagnostics(staff,requested.id,correlationId);
    expect(diagnostics).toEqual({collectedAt:expect.any(String),workspaceId,runners:{},executionsLast24Hours:{},queuedEvents:{},webhookDeliveries:{}});
    await supportAccess.revoke(customer,requested.id,"Investigation complete.",correlationId);
    await expect(supportAccess.diagnostics(staff,requested.id,correlationId)).rejects.toMatchObject({code:"support_access_denied"});
    const client=await pool.connect();try{await client.query("BEGIN");await client.query(`SELECT set_config('app.system_role','support_access_service',true)`);const events=await client.query<{event_type:string}>(`SELECT event_type FROM support_access_events WHERE request_id=$1 ORDER BY sequence`,[requested.id]);expect(events.rows.map(row=>row.event_type)).toEqual(["requested","approved","diagnostics_accessed","revoked"]);await client.query("ROLLBACK");}finally{client.release();}
  });
});
