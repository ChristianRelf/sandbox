import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  checkRunnerCompatibility,
  executionCheckpointSchema,
  executionRecoverySchema,
  executionTransitionSchema,
  runnerIdentitySchema,
  runnerRequirementsSchema,
  type ExecutionCheckpoint,
  type ExecutionLease,
  type ExecutionRecovery,
  type ExecutionTransition,
  type RunnerIdentity,
  type RunnerRequirements
} from "@sandbox/contracts";
import { decideLeaseLossRecovery, validateExecutionTransition, type ExecutionProjection, type InterruptedNode } from "./execution_state.js";
import { DomainError } from "./types.js";

export interface QueuedExecutionInput {
  executionId: string;
  workspaceId: string;
  environmentId: string;
  deploymentId: string;
  workflowId: string;
  workflowRevisionId: string;
  triggerType: string;
  triggerReference: string | null;
  queueEventId: string | null;
  idempotencyKey: string;
  permissionSnapshotId: string;
  pluginVersions: unknown[];
  connectionReferences: unknown[];
  requirements: RunnerRequirements;
  encryptedPayloadReference: string;
  correlationId: string;
  queuedAt: Date;
  timeoutAt: Date;
}

interface ExecutionRow {
  id: string;
  status: ExecutionProjection["state"];
  state_version: number;
  assigned_runner_id: string | null;
  active_lease_id: string | null;
  outcome_certainty: "certain" | "uncertain";
  workspace_id: string;
  environment_id: string;
  workflow_revision_id: string;
  routing_requirements: unknown;
}

interface ExecutionEventRow {
  id: string; execution_id: string; from_state: ExecutionTransition["fromState"]; to_state: ExecutionTransition["toState"]; expected_version: number;
  actor_type: ExecutionTransition["actor"]["actorType"]; actor_id: string | null; runner_id: string | null; lease_id: string | null;
  reason: string; metadata: Record<string, unknown>; occurred_at: Date; correlation_id: string;
}

export class PostgresExecutionCoordinator {
  constructor(private readonly pool: Pool) {}

  async enqueue(input: QueuedExecutionInput): Promise<{ executionId: string; created: boolean }> {
    if (input.timeoutAt <= input.queuedAt) throw new DomainError("execution_timeout_invalid", "Execution timeout must be after queue time.");
    const requirements = runnerRequirementsSchema.parse(input.requirements);
    if (requirements.workspaceId !== input.workspaceId || requirements.environmentId !== input.environmentId) throw new DomainError("execution_routing_scope_invalid", "Routing requirements must match the execution workspace and environment.");
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO executions(id,workspace_id,environment_id,deployment_id,workflow_id,workflow_revision_id,trigger_type,trigger_reference,queue_event_id,idempotency_key,status,permission_snapshot_id,plugin_versions,connection_references,routing_requirements,encrypted_payload_reference,correlation_id,queued_at,timeout_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT(workspace_id,idempotency_key) DO NOTHING RETURNING id`,
      [input.executionId,input.workspaceId,input.environmentId,input.deploymentId,input.workflowId,input.workflowRevisionId,input.triggerType,input.triggerReference,input.queueEventId,input.idempotencyKey,input.permissionSnapshotId,JSON.stringify(input.pluginVersions),JSON.stringify(input.connectionReferences),JSON.stringify(requirements),input.encryptedPayloadReference,input.correlationId,input.queuedAt,input.timeoutAt]
    );
    if (result.rowCount) return { executionId: result.rows[0].id, created: true };
    const existing = await this.pool.query<{ id: string }>(`SELECT id FROM executions WHERE workspace_id=$1 AND idempotency_key=$2`, [input.workspaceId,input.idempotencyKey]);
    return { executionId: existing.rows[0].id, created: false };
  }

  async transition(candidate: unknown): Promise<ExecutionTransition> {
    const parsed = executionTransitionSchema.parse(candidate);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const duplicate = await client.query<ExecutionEventRow>(`SELECT id,execution_id,from_state,to_state,expected_version,actor_type,actor_id,runner_id,lease_id,reason,metadata,occurred_at,correlation_id FROM execution_events WHERE id=$1`, [parsed.transitionId]);
      if (duplicate.rowCount) {
        const existing = transitionFromRow(duplicate.rows[0]);
        if (JSON.stringify(existing) !== JSON.stringify(parsed)) throw new DomainError("execution_transition_id_conflict", "Transition ID already identifies different content.", 409);
        await client.query("COMMIT");
        return existing;
      }
      const current = await this.loadProjection(client, parsed.executionId);
      const event = validateExecutionTransition(current, parsed);
      await client.query(
        `INSERT INTO execution_events(id,execution_id,sequence,from_state,to_state,expected_version,actor_type,actor_id,runner_id,lease_id,reason,metadata,occurred_at,correlation_id)
         VALUES($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`,
        [event.transitionId,event.executionId,event.fromState,event.toState,event.expectedVersion,event.actor.actorType,event.actor.actorId,event.actor.runnerId,event.leaseId,event.reason,JSON.stringify(event.metadata),event.occurredAt,event.correlationId]
      );
      await client.query("COMMIT");
      return event;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async claim(identityInput: RunnerIdentity, now: Date, leaseSeconds = 30): Promise<ExecutionLease | null> {
    const identity = runnerIdentitySchema.parse(identityInput);
    if (identity.maintenanceState !== "active") return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const candidates = await client.query<ExecutionRow>(
        `SELECT execution.id,execution.status,execution.state_version,execution.assigned_runner_id,NULL::uuid active_lease_id,execution.outcome_certainty,execution.workspace_id,execution.environment_id,execution.workflow_revision_id,execution.routing_requirements
         FROM executions execution
         WHERE execution.status IN ('waiting_for_runner','retrying') AND execution.workspace_id=$1 AND execution.environment_id=$2 AND execution.timeout_at>$3
         ORDER BY execution.queued_at FOR UPDATE SKIP LOCKED LIMIT 25`, [identity.workspaceId, identity.environmentId, now]
      );
      const selected = candidates.rows.find(row => checkRunnerCompatibility(identity, runnerRequirementsSchema.parse(row.routing_requirements)).compatible);
      if (!selected) { await client.query("COMMIT"); return null; }
      const generationResult = await client.query<{ generation: number }>(`SELECT COALESCE(MAX(generation),0)+1 generation FROM execution_leases WHERE execution_id=$1`, [selected.id]);
      const generation = Number(generationResult.rows[0].generation);
      const token = randomBytes(32).toString("base64url");
      const issuedAt = now;
      const expiresAt = new Date(now.getTime() + Math.min(Math.max(leaseSeconds, 5), 300) * 1_000);
      const renewalAfter = new Date(now.getTime() + Math.floor((expiresAt.getTime()-now.getTime())/2));
      const leaseId = randomUUID();
      await client.query(`UPDATE executions SET assigned_runner_id=$2 WHERE id=$1`, [selected.id, identity.runnerId]);
      await client.query(`INSERT INTO execution_leases(id,execution_id,runner_id,generation,token_hash,issued_at,renewed_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7)`, [leaseId,selected.id,identity.runnerId,generation,hashToken(token),issuedAt,expiresAt]);
      await client.query(
        `INSERT INTO execution_events(id,execution_id,sequence,from_state,to_state,expected_version,actor_type,runner_id,lease_id,reason,metadata,occurred_at,correlation_id)
         SELECT $1,id,0,status,'claimed',state_version,'system',$2,$3,'Compatible runner claimed execution','{}',$4,correlation_id FROM executions WHERE id=$5`,
        [randomUUID(),identity.runnerId,leaseId,now,selected.id]
      );
      await client.query("COMMIT");
      return { leaseId, executionId: selected.id, runnerId: identity.runnerId, generation, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), renewalAfter: renewalAfter.toISOString(), leaseToken: token };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async renew(lease: ExecutionLease, now: Date, extensionSeconds: number): Promise<ExecutionLease> {
    const seconds = Math.min(Math.max(extensionSeconds, 5), 300);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ token_hash: Buffer; expires_at: Date; released_at: Date | null }>(`SELECT token_hash,expires_at,released_at FROM execution_leases WHERE id=$1 AND execution_id=$2 AND runner_id=$3 AND generation=$4 FOR UPDATE`, [lease.leaseId,lease.executionId,lease.runnerId,lease.generation]);
      if (!result.rowCount || result.rows[0].released_at || result.rows[0].expires_at <= now || !sameToken(result.rows[0].token_hash, lease.leaseToken)) throw new DomainError("execution_lease_invalid", "Lease is expired, released or invalid.", 409);
      const expiresAt = new Date(now.getTime()+seconds*1_000);
      const renewalAfter = new Date(now.getTime()+Math.floor(seconds*500));
      await client.query(`UPDATE execution_leases SET renewed_at=$2,expires_at=$3 WHERE id=$1`, [lease.leaseId,now,expiresAt]);
      await client.query("COMMIT");
      return { ...lease, expiresAt: expiresAt.toISOString(), renewalAfter: renewalAfter.toISOString() };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async checkpoint(input: ExecutionCheckpoint, leaseToken: string, now: Date): Promise<{ created: boolean }> {
    const checkpoint = executionCheckpointSchema.parse(input);
    const lease = await this.pool.query<{ token_hash: Buffer }>(
      `SELECT lease.token_hash FROM execution_leases lease JOIN executions execution ON execution.id=lease.execution_id
       WHERE lease.execution_id=$1 AND lease.runner_id=$2 AND lease.released_at IS NULL AND lease.expires_at>$3 AND execution.workflow_revision_id=$4`,
      [checkpoint.executionId,checkpoint.runnerId,now,checkpoint.workflowRevisionId]
    );
    if (!lease.rowCount || !sameToken(lease.rows[0].token_hash, leaseToken)) throw new DomainError("execution_lease_invalid", "A current execution lease is required for checkpointing.", 409);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO execution_checkpoints(id,execution_id,workflow_revision_id,node_id,node_version,attempt,status,input_hash,output_reference,side_effect_classification,idempotency_key,completed_at,runner_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(execution_id,node_id,attempt) DO NOTHING`,
        [checkpoint.checkpointId,checkpoint.executionId,checkpoint.workflowRevisionId,checkpoint.nodeId,checkpoint.nodeVersion,checkpoint.attempt,checkpoint.status,checkpoint.inputHash,checkpoint.outputReference,checkpoint.sideEffect,checkpoint.idempotencyKey,checkpoint.completedAt,checkpoint.runnerId]
      );
      if (!result.rowCount) {
        const existing = await client.query<{ id:string; workflow_revision_id:string; node_version:number; status:string; input_hash:string; output_reference:string|null; side_effect_classification:string; idempotency_key:string|null; completed_at:Date; runner_id:string }>(`SELECT id,workflow_revision_id,node_version,status,input_hash,output_reference,side_effect_classification,idempotency_key,completed_at,runner_id FROM execution_checkpoints WHERE execution_id=$1 AND node_id=$2 AND attempt=$3`,[checkpoint.executionId,checkpoint.nodeId,checkpoint.attempt]);
        const row=existing.rows[0];
        const matches=row.id===checkpoint.checkpointId && row.workflow_revision_id===checkpoint.workflowRevisionId && row.node_version===checkpoint.nodeVersion && row.status===checkpoint.status && row.input_hash===checkpoint.inputHash && row.output_reference===checkpoint.outputReference && row.side_effect_classification===checkpoint.sideEffect && row.idempotency_key===checkpoint.idempotencyKey && row.completed_at.toISOString()===checkpoint.completedAt && row.runner_id===checkpoint.runnerId;
        if (!matches) throw new DomainError("execution_checkpoint_conflict", "Checkpoint attempt already exists with different content.", 409);
      }
      await client.query(`UPDATE executions SET interrupted_node=NULL WHERE id=$1 AND interrupted_node->>'nodeId'=$2`,[checkpoint.executionId,checkpoint.nodeId]);
      await client.query("COMMIT");
      return { created: Boolean(result.rowCount) };
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async recordNodeStarted(executionId: string, runnerId: string, leaseId: string, leaseToken: string, node: InterruptedNode, now: Date): Promise<void> {
    const lease = await this.pool.query<{ token_hash: Buffer }>(`SELECT token_hash FROM execution_leases WHERE id=$1 AND execution_id=$2 AND runner_id=$3 AND released_at IS NULL AND expires_at>$4`,[leaseId,executionId,runnerId,now]);
    if (!lease.rowCount || !sameToken(lease.rows[0].token_hash,leaseToken)) throw new DomainError("execution_lease_invalid", "A current execution lease is required.",409);
    await this.pool.query(`UPDATE executions SET interrupted_node=$2,last_progress_at=$3 WHERE id=$1 AND assigned_runner_id=$4`,[executionId,JSON.stringify(node),now,runnerId]);
  }

  async recoverExpiredLeases(now: Date, limit = 100): Promise<Array<{ executionId:string; recovery:ExecutionRecovery }>> {
    const expired = await this.pool.query<{ execution_id:string; interrupted_node:InterruptedNode|null; correlation_id:string }>(
      `SELECT execution.id execution_id,execution.interrupted_node,execution.correlation_id FROM execution_leases lease JOIN executions execution ON execution.id=lease.execution_id
       WHERE lease.released_at IS NULL AND lease.expires_at<=$1 AND execution.status IN ('claimed','starting','running','waiting_for_approval','retrying','cancelling') ORDER BY lease.expires_at LIMIT $2`,[now,Math.min(Math.max(limit,1),1000)]
    );
    const recovered: Array<{ executionId:string; recovery:ExecutionRecovery }> = [];
    for(const item of expired.rows) {
      const checkpointResult=await this.pool.query<{ id:string; execution_id:string; workflow_revision_id:string; node_id:string; node_version:number; attempt:number; status:"completed"|"failed"; input_hash:string; output_reference:string|null; side_effect_classification:ExecutionCheckpoint["sideEffect"]; idempotency_key:string|null; completed_at:Date; runner_id:string }>(`SELECT id,execution_id,workflow_revision_id,node_id,node_version,attempt,status,input_hash,output_reference,side_effect_classification,idempotency_key,completed_at,runner_id FROM execution_checkpoints WHERE execution_id=$1 ORDER BY completed_at DESC LIMIT 1`,[item.execution_id]);
      const row=checkpointResult.rows[0];
      const checkpoint:ExecutionCheckpoint|null=row?{checkpointId:row.id,executionId:row.execution_id,workflowRevisionId:row.workflow_revision_id,nodeId:row.node_id,nodeVersion:row.node_version,attempt:row.attempt,status:row.status,inputHash:row.input_hash,outputReference:row.output_reference,sideEffect:row.side_effect_classification,idempotencyKey:row.idempotency_key,completedAt:row.completed_at.toISOString(),runnerId:row.runner_id}:null;
      const recovery=decideLeaseLossRecovery(checkpoint,item.interrupted_node);
      await this.markLeaseLost(item.execution_id,recovery,now,item.correlation_id);
      recovered.push({executionId:item.execution_id,recovery});
    }
    return recovered;
  }

  async markLeaseLost(executionId: string, recoveryInput: ExecutionRecovery, now: Date, correlationId: string): Promise<void> {
    const recovery = executionRecoverySchema.parse(recoveryInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.loadProjection(client, executionId);
      if (!current.activeLeaseId) { await client.query("COMMIT"); return; }
      await client.query(`UPDATE execution_leases SET released_at=$2,release_reason='expired' WHERE id=$1 AND released_at IS NULL`, [current.activeLeaseId,now]);
      await client.query(
        `INSERT INTO execution_events(id,execution_id,sequence,from_state,to_state,expected_version,actor_type,reason,metadata,occurred_at,correlation_id)
         VALUES($1,$2,0,$3,'lost',$4,'system',$5,$6,$7,$8)`,
        [randomUUID(),executionId,current.state,current.version,recovery.reason,JSON.stringify({ certainty: recovery.certainty, recoveryDisposition: recovery.disposition, recovery }),now,correlationId]
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async loadProjection(client: PoolClient, executionId: string): Promise<ExecutionProjection> {
    const result = await client.query<ExecutionRow>(
      `SELECT execution.id,execution.status,execution.state_version,execution.assigned_runner_id,lease.id active_lease_id,execution.outcome_certainty,execution.workspace_id,execution.environment_id,execution.workflow_revision_id,execution.routing_requirements
       FROM executions execution LEFT JOIN execution_leases lease ON lease.execution_id=execution.id AND lease.released_at IS NULL WHERE execution.id=$1 FOR UPDATE OF execution`, [executionId]
    );
    if (!result.rowCount) throw new DomainError("execution_not_found", "Execution was not found.", 404);
    const row = result.rows[0];
    return { executionId: row.id, state: row.status, version: row.state_version, runnerId: row.assigned_runner_id, activeLeaseId: row.active_lease_id, certainty: row.outcome_certainty };
  }
}

function hashToken(token: string): Buffer { return createHash("sha256").update(token).digest(); }
function sameToken(expected: Buffer, token: string): boolean { const actual=hashToken(token); return expected.length===actual.length && timingSafeEqual(expected,actual); }
function transitionFromRow(row:ExecutionEventRow):ExecutionTransition { return {transitionId:row.id,executionId:row.execution_id,fromState:row.from_state,toState:row.to_state,occurredAt:row.occurred_at.toISOString(),actor:{actorType:row.actor_type,actorId:row.actor_id,runnerId:row.runner_id},reason:row.reason,expectedVersion:row.expected_version,leaseId:row.lease_id,correlationId:row.correlation_id,metadata:row.metadata}; }
