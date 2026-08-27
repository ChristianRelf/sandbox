import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUNNER_PROTOCOL_VERSION, type ExecutionTransition, type RunnerIdentity, type RunnerRequirements } from "@sandbox/contracts";
import { PostgresExecutionCoordinator } from "./execution_coordinator.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

integration("PostgreSQL execution coordination", () => {
  const pool = new Pool({ connectionString, max: 4 });
  const coordinator = new PostgresExecutionCoordinator(pool);
  const accountId=randomUUID(), organisationId=randomUUID(), workspaceId=randomUUID(), roleId=randomUUID(), environmentId=randomUUID(), workflowId=randomUUID(), revisionId=randomUUID(), runnerId=randomUUID();
  const executionId=randomUUID(), deploymentId=randomUUID(), permissionSnapshotId=randomUUID(), correlationId=randomUUID();

  beforeAll(async () => {
    await pool.query(`INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name) VALUES($1,$2,$3,true,'Execution audit')`, [accountId,`execution-${accountId}`,`${accountId}@example.invalid`]);
    await pool.query(`INSERT INTO organisations(id,name,slug,created_by) VALUES($1,'Execution audit',$2,$3)`, [organisationId,`execution-${organisationId}`,accountId]);
    await pool.query(`INSERT INTO roles(id,organisation_id,role_key,display_name,built_in) VALUES($1,$2,'audit','Audit',true)`, [roleId,organisationId]);
    await pool.query(`INSERT INTO workspaces(id,organisation_id,name,slug,created_by) VALUES($1,$2,'Execution workspace','execution',$3)`, [workspaceId,organisationId,accountId]);
    await pool.query(`INSERT INTO workspace_memberships(workspace_id,account_id,role_id) VALUES($1,$2,$3)`, [workspaceId,accountId,roleId]);
    await pool.query(`INSERT INTO environments(id,workspace_id,environment_key) VALUES($1,$2,'development')`, [environmentId,workspaceId]);
    await pool.query(`INSERT INTO synced_workflows(id,owner_type,owner_id,workspace_id,name) VALUES($1,'workspace',$2,$2,'Execution workflow')`, [workflowId,workspaceId]);
    await pool.query(`INSERT INTO workflow_revisions(id,workflow_id,schema_version,content_hash,encrypted_payload,payload_key_envelope,editor_device_id,updated_by,updated_at) VALUES($1,$2,2,$3,$4,$5,$6,$7,now())`, [revisionId,workflowId,`sha256:${"a".repeat(64)}`,Buffer.alloc(32,1),Buffer.alloc(32,2),randomUUID(),accountId]);
    await pool.query(`INSERT INTO runners(id,account_id,workspace_id,display_name,operating_system,architecture,application_version,protocol_version,plugin_runtime_version,capabilities,status) VALUES($1,$2,$3,'Hosted audit','linux','x86_64','0.4.0',$4,'0.4.0','{}','online')`, [runnerId,accountId,workspaceId,RUNNER_PROTOCOL_VERSION]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM runners WHERE id=$1`, [runnerId]).catch(() => undefined);
    await pool.query(`DELETE FROM organisations WHERE id=$1`, [organisationId]).catch(() => undefined);
    await pool.query(`DELETE FROM accounts WHERE id=$1`, [accountId]).catch(() => undefined);
    await pool.end();
  });

  it("deduplicates queueing, claims once, renews, checkpoints, and preserves append-only history", async () => {
    const requirements: RunnerRequirements = {
      protocolVersion: RUNNER_PROTOCOL_VERSION, engineVersion: "0.4.0", pluginRuntimeVersion: "0.4.0", runnerTypes: ["hosted"], architectures: ["x86_64"],
      workspaceId, environmentId, region: "eu-west-2", requiredTags: ["standard"], capabilities: [{ nodeType: "http_request", nodeVersions: [1], constraints: {} }], plugins: [], connectionIds: [], minimumAvailableConcurrency: 1
    };
    const input = { executionId,workspaceId,environmentId,deploymentId,workflowId,workflowRevisionId:revisionId,triggerType:"manual",triggerReference:null,queueEventId:null,idempotencyKey:`execution-${executionId}`,permissionSnapshotId,pluginVersions:[],connectionReferences:[],requirements,encryptedPayloadReference:"object://encrypted-workflow",correlationId,queuedAt:new Date(),timeoutAt:new Date(Date.now()+60_000) };
    expect(await coordinator.enqueue(input)).toEqual({ executionId, created: true });
    expect(await coordinator.enqueue({ ...input, executionId: randomUUID() })).toEqual({ executionId, created: false });

    const waiting: ExecutionTransition = { transitionId:randomUUID(),executionId,fromState:"queued",toState:"waiting_for_runner",occurredAt:new Date().toISOString(),actor:{actorType:"system",actorId:null,runnerId:null},reason:"Ready for routing.",expectedVersion:0,leaseId:null,correlationId,metadata:{} };
    await coordinator.transition(waiting);
    const identity: RunnerIdentity = { runnerId,keyId:"runner-key",runnerType:"hosted",protocolVersion:RUNNER_PROTOCOL_VERSION,engineVersion:"0.4.0",pluginRuntimeVersion:"0.4.0",architecture:"x86_64",operatingSystem:"linux",workspaceId,environmentId,region:"eu-west-2",tags:["standard"],concurrencyLimit:2,maintenanceState:"active",nodeCapabilities:[{nodeType:"http_request",nodeVersions:[1],constraints:{}}],plugins:[],connections:[] };
    const lease = await coordinator.claim(identity,new Date(),30);
    expect(lease?.executionId).toBe(executionId);
    expect(await coordinator.claim(identity,new Date(),30)).toBeNull();
    const renewed = await coordinator.renew(lease!,new Date(),30);
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(Date.now());

    await coordinator.transition({ transitionId:randomUUID(),executionId,fromState:"claimed",toState:"starting",occurredAt:new Date().toISOString(),actor:{actorType:"runner",actorId:null,runnerId},reason:"Runner started workload.",expectedVersion:2,leaseId:lease!.leaseId,correlationId,metadata:{} });
    expect(await coordinator.checkpoint({ checkpointId:randomUUID(),executionId,workflowRevisionId:revisionId,nodeId:"http",nodeVersion:1,attempt:1,status:"completed",inputHash:`sha256:${"b".repeat(64)}`,outputReference:"object://redacted-output",sideEffect:"idempotent",idempotencyKey:`node-${executionId}`,completedAt:new Date().toISOString(),runnerId },lease!.leaseToken,new Date())).toEqual({ created:true });
    await coordinator.markLeaseLost(executionId,{ disposition:"review_required",certainty:"uncertain",checkpointId:null,resumeAfterNodeId:"http",reason:"External action may have completed before the runner partitioned.",preserveIdempotencyKey:true },new Date(),correlationId);
    const lost = await pool.query<{ status:string; outcome_certainty:string; recovery_disposition:string }>(`SELECT status,outcome_certainty,recovery_disposition FROM executions WHERE id=$1`,[executionId]);
    expect(lost.rows[0]).toEqual({ status:"lost", outcome_certainty:"uncertain", recovery_disposition:"review_required" });
    expect(await coordinator.claim(identity,new Date(),30)).toBeNull();
    await expect(pool.query(`UPDATE execution_events SET reason='rewritten' WHERE execution_id=$1`,[executionId])).rejects.toThrow(/append-only/i);
  });
});
