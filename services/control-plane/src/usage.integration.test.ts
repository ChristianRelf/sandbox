import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresUsageLedger, type UsageEventInput } from "./usage.js";

const connectionString=process.env.TEST_DATABASE_URL;
const integration=connectionString?describe:describe.skip;

integration("immutable hosted usage and reconciliation",()=>{
  const pool=new Pool({connectionString,max:4});
  const ledger=new PostgresUsageLedger(pool);
  const accountId=randomUUID(),organisationId=randomUUID(),workspaceId=randomUUID(),roleId=randomUUID(),environmentId=randomUUID();
  const workflowId=randomUUID(),revisionId=randomUUID(),permissionSnapshotId=randomUUID(),deploymentId=randomUUID(),executionId=randomUUID();
  const startedAt=new Date(Date.now()-10_000),endedAt=new Date();

  beforeAll(async()=>{
    await pool.query(`INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name) VALUES($1,$2,$3,true,'Usage audit')`,[accountId,`usage-${accountId}`,`${accountId}@example.invalid`]);
    await pool.query(`INSERT INTO organisations(id,name,slug,created_by) VALUES($1,'Usage audit',$2,$3)`,[organisationId,`usage-${organisationId}`,accountId]);
    await pool.query(`INSERT INTO roles(id,organisation_id,role_key,display_name,built_in) VALUES($1,$2,'usage-audit','Usage audit',true)`,[roleId,organisationId]);
    await pool.query(`INSERT INTO workspaces(id,organisation_id,name,slug,created_by) VALUES($1,$2,'Usage workspace','usage',$3)`,[workspaceId,organisationId,accountId]);
    await pool.query(`INSERT INTO workspace_memberships(workspace_id,account_id,role_id) VALUES($1,$2,$3)`,[workspaceId,accountId,roleId]);
    await pool.query(`INSERT INTO environments(id,workspace_id,environment_key) VALUES($1,$2,'production')`,[environmentId,workspaceId]);
    await pool.query(`INSERT INTO synced_workflows(id,owner_type,owner_id,workspace_id,name) VALUES($1,'workspace',$2,$2,'Usage workflow')`,[workflowId,workspaceId]);
    await pool.query(`INSERT INTO workflow_revisions(id,workflow_id,schema_version,content_hash,encrypted_payload,payload_key_envelope,editor_device_id,updated_by,updated_at) VALUES($1,$2,2,$3,$4,$5,$6,$7,now())`,[revisionId,workflowId,`sha256:${"a".repeat(64)}`,Buffer.alloc(32,1),Buffer.alloc(32,2),randomUUID(),accountId]);
    await pool.query(`INSERT INTO workflow_permission_snapshots(id,workspace_id,workflow_id,workflow_revision_id,permissions,approved_by,approved_at,content_hash) VALUES($1,$2,$3,$4,'{}',$5,now(),$6)`,[permissionSnapshotId,workspaceId,workflowId,revisionId,accountId,`sha256:${"a".repeat(64)}`]);
    await pool.query(`INSERT INTO workflow_deployments(id,workspace_id,workflow_id,workflow_revision_id,environment_id,target_type,region,status,permission_snapshot_id,validation_result,usage_estimate,retention_policy,concurrency_policy,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'managed_cloud_runner','eu-west-2','active',$6,'{}','{}','{}','{}',$7,now(),now())`,[deploymentId,workspaceId,workflowId,revisionId,environmentId,permissionSnapshotId,accountId]);
    await pool.query(`INSERT INTO executions(id,workspace_id,environment_id,deployment_id,workflow_id,workflow_revision_id,trigger_type,idempotency_key,status,permission_snapshot_id,routing_requirements,encrypted_payload_reference,correlation_id,queued_at,started_at,completed_at,timeout_at) VALUES($1,$2,$3,$4,$5,$6,'manual',$7,'succeeded',$8,'{}','object://workflow',$9,$10,$10,$11,$11)`,[executionId,workspaceId,environmentId,deploymentId,workflowId,revisionId,`usage-execution-${executionId}`,permissionSnapshotId,randomUUID(),startedAt,endedAt]);
  });

  afterAll(async()=>{await pool.query(`DELETE FROM organisations WHERE id=$1`,[organisationId]).catch(()=>undefined);await pool.query(`DELETE FROM accounts WHERE id=$1`,[accountId]).catch(()=>undefined);await pool.end();});

  it("deduplicates identical meter events, rejects mutation, and reconciles exact quantities",async()=>{
    const input:UsageEventInput={eventId:randomUUID(),workspaceId,environmentId,executionId,deploymentId,meter:"hosted_runner_seconds",quantity:10,unit:"seconds",sourceEventId:`workload-stop-${executionId}`,idempotencyKey:`usage-${executionId}`,periodStartedAt:startedAt.toISOString(),periodEndedAt:endedAt.toISOString(),region:"eu-west-2",metadata:{runnerClass:"standard",accessToken:"must-not-persist"}};
    expect(await ledger.record(input)).toEqual({eventId:input.eventId,created:true});
    expect(await ledger.record(input)).toEqual({eventId:input.eventId,created:false});
    expect(await ledger.record({...input,eventId:randomUUID()})).toEqual({eventId:input.eventId,created:false});
    await expect(ledger.record({...input,quantity:11})).rejects.toMatchObject({code:"usage_idempotency_conflict"});
    await expect(ledger.record({...input,eventId:randomUUID(),executionId:randomUUID(),idempotencyKey:`invalid-scope-${executionId}`,sourceEventId:`invalid-scope-${executionId}`})).rejects.toMatchObject({code:"usage_deployment_scope_invalid"});
    const stored=await pool.query<{ metadata:Record<string,unknown> }>(`SELECT metadata FROM usage_events WHERE id=$1`,[input.eventId]);
    expect(stored.rows[0].metadata).toEqual({runnerClass:"standard",accessToken:"[REDACTED]"});
    expect(await ledger.reconcile(executionId,{hosted_runner_seconds:10},randomUUID())).toMatchObject({status:"matched",actual:{hosted_runner_seconds:10},discrepancies:{}});
    expect(await ledger.invoiceInputs(new Date(startedAt.getTime()-1000).toISOString(),new Date(endedAt.getTime()+1000).toISOString())).toEqual([expect.objectContaining({workspaceId,meter:"hosted_runner_seconds",unit:"seconds",quantity:10,executionCount:1,evidenceDigest:expect.stringMatching(/^sha256:[a-f0-9]{64}$/)})]);
    const summary=await ledger.workspaceSummary(workspaceId,7,new Date(endedAt.getTime()+1000));
    expect(summary).toMatchObject({workspaceId,reconciliation:"matched",meters:expect.arrayContaining([expect.objectContaining({meter:"hosted_runner_seconds",unit:"seconds",quantity:10})])});
    expect(summary.daily.find(point=>point.date===endedAt.toISOString().slice(0,10))?.quantities.hosted_runner_seconds).toBe(10);
    expect(await ledger.reconcile(executionId,{hosted_runner_seconds:9},randomUUID())).toMatchObject({version:2,status:"discrepancy",discrepancies:{hosted_runner_seconds:1}});
    expect(await ledger.invoiceInputs(new Date(startedAt.getTime()-1000).toISOString(),new Date(endedAt.getTime()+1000).toISOString())).toEqual([]);
    expect((await ledger.workspaceSummary(workspaceId,7,new Date(endedAt.getTime()+1000))).meters.every(meter=>meter.quantity===0)).toBe(true);
    await expect(pool.query(`UPDATE usage_events SET quantity=0 WHERE id=$1`,[input.eventId])).rejects.toThrow(/append-only/i);
  });
});
