import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { PostgresScheduler } from "./postgres.js";
import { PostgresEventQueue } from "./queue.js";

const connectionString=process.env.TEST_DATABASE_URL;
const integration=connectionString?describe:describe.skip;

integration("durable scheduler and event queue",()=>{
  const pool=new Pool({connectionString,max:4}),scheduler=new PostgresScheduler(pool),queue=new PostgresEventQueue(pool);
  const accountId=randomUUID(),organisationId=randomUUID(),workspaceId=randomUUID(),roleId=randomUUID(),environmentId=randomUUID(),workflowId=randomUUID(),revisionId=randomUUID(),permissionSnapshotId=randomUUID(),deploymentId=randomUUID(),scheduleId=randomUUID();
  const due=new Date("2026-08-27T12:00:00.000Z");

  beforeAll(async()=>{
    await pool.query(`INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name) VALUES($1,$2,$3,true,'Scheduler audit')`,[accountId,`scheduler-${accountId}`,`${accountId}@example.invalid`]);
    await pool.query(`INSERT INTO organisations(id,name,slug,created_by) VALUES($1,'Scheduler audit',$2,$3)`,[organisationId,`scheduler-${organisationId}`,accountId]);
    await pool.query(`INSERT INTO roles(id,organisation_id,role_key,display_name,built_in) VALUES($1,$2,'scheduler-audit','Scheduler audit',true)`,[roleId,organisationId]);
    await pool.query(`INSERT INTO workspaces(id,organisation_id,name,slug,created_by) VALUES($1,$2,'Scheduler workspace','scheduler',$3)`,[workspaceId,organisationId,accountId]);
    await pool.query(`INSERT INTO workspace_memberships(workspace_id,account_id,role_id) VALUES($1,$2,$3)`,[workspaceId,accountId,roleId]);
    await pool.query(`INSERT INTO environments(id,workspace_id,environment_key) VALUES($1,$2,'production')`,[environmentId,workspaceId]);
    await pool.query(`INSERT INTO synced_workflows(id,owner_type,owner_id,workspace_id,name) VALUES($1,'workspace',$2,$2,'Scheduled workflow')`,[workflowId,workspaceId]);
    await pool.query(`INSERT INTO workflow_revisions(id,workflow_id,schema_version,content_hash,encrypted_payload,payload_key_envelope,editor_device_id,updated_by,updated_at,publish_status) VALUES($1,$2,2,$3,$4,$5,$6,$7,$8,'published')`,[revisionId,workflowId,`sha256:${"c".repeat(64)}`,Buffer.alloc(32,1),Buffer.alloc(32,2),randomUUID(),accountId,due]);
    await pool.query(`INSERT INTO workflow_permission_snapshots(id,workspace_id,workflow_id,workflow_revision_id,permissions,approved_by,approved_at,content_hash) VALUES($1,$2,$3,$4,'{}',$5,$6,$7)`,[permissionSnapshotId,workspaceId,workflowId,revisionId,accountId,due,`sha256:${"d".repeat(64)}`]);
    await pool.query(`INSERT INTO workflow_deployments(id,workspace_id,workflow_id,workflow_revision_id,environment_id,target_type,region,status,permission_snapshot_id,validation_result,usage_estimate,retention_policy,concurrency_policy,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'managed_cloud_runner','eu-west-2','active',$6,'{}','{}','{}','{}',$7,$8,$8)`,[deploymentId,workspaceId,workflowId,revisionId,environmentId,permissionSnapshotId,accountId,due]);
    await pool.query(`INSERT INTO workflow_schedules(id,workspace_id,environment_id,deployment_id,workflow_revision_id,schedule_type,schedule_spec,time_zone,dst_policy,misfire_policy,misfire_grace_seconds,jitter_seconds,concurrency_policy,maximum_parallel,no_runner_policy,routing_requirements,encrypted_payload_reference,next_run_at,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'interval',$6,'UTC','run_once','queue',3600,0,'queue_new',1,'{}','{}','object://encrypted-trigger',$7,$8,$7,$7)`,[scheduleId,workspaceId,environmentId,deploymentId,revisionId,{everySeconds:60,anchorAt:"2026-08-27T00:00:00.000Z"},due,accountId]);
  });

  afterAll(async()=>{await pool.query(`DELETE FROM organisations WHERE id=$1`,[organisationId]).catch(()=>undefined);await pool.query(`DELETE FROM accounts WHERE id=$1`,[accountId]).catch(()=>undefined);await pool.end();});

  it("emits once, prevents duplicate claims, dead-letters poison events, and records identity-preserving replay",async()=>{
    expect(await scheduler.tick(due)).toMatchObject({leader:true,examined:1,queued:1});
    expect(await scheduler.tick(due)).toMatchObject({leader:true,examined:0,queued:0});
    const first=await queue.claim("worker-a",new Date(due.getTime()+1_000),5);
    expect(first).not.toBeNull();
    expect(await queue.claim("worker-b",new Date(due.getTime()+1_000),5)).toBeNull();
    expect(await queue.reclaimVisibilityTimeouts(new Date(due.getTime()+7_000))).toBe(1);
    const recovered=await queue.claim("worker-b",new Date(due.getTime()+8_000),5);
    expect(recovered).toMatchObject({queueId:first!.queueId,attempt:2});
    expect(await queue.fail(recovered!,new Date(due.getTime()+9_000),"poison-payload")).toBe("retry");
    const second=await queue.claim("worker-a",new Date(due.getTime()+3_600_000),5);
    expect(await queue.fail(second!,new Date(due.getTime()+3_601_000),"poison-payload")).toBe("retry");
    const third=await queue.claim("worker-a",new Date(due.getTime()+7_200_000),5);
    expect(await queue.fail(third!,new Date(due.getTime()+7_201_000),"poison-payload")).toBe("dead_letter");
    const replayId=await queue.replay(first!.queueId,accountId,"Operator inspected and approved replay.",new Date(due.getTime()+7_202_000));
    const replay=await queue.claim("worker-b",new Date(due.getTime()+7_203_000),5);
    expect(replay).toMatchObject({queueId:replayId,eventId:first!.eventId,originalEventId:first!.originalEventId,attempt:1});
    await queue.complete(replay!,new Date(due.getTime()+7_204_000));
    const history=await pool.query<{outcome:string}>(`SELECT outcome FROM queue_attempt_events WHERE queued_event_id=$1 ORDER BY occurred_at`,[first!.queueId]);
    expect(history.rows.map(row=>row.outcome)).toEqual(["claimed","visibility_timeout","claimed","retry","claimed","retry","claimed","dead_letter"]);
    const replayRecord=await pool.query<{original_event_id:string}>(`SELECT original_event_id FROM queue_replays WHERE replay_queue_event_id=$1`,[replayId]);
    expect(replayRecord.rows[0].original_event_id).toBe(first!.originalEventId);
  });
});
