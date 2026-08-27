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
import { validateExecutionTransition, type ExecutionProjection } from "./execution_state.js";
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
    const result = await this.pool.query(
      `INSERT INTO execution_checkpoints(id,execution_id,workflow_revision_id,node_id,node_version,attempt,status,input_hash,output_reference,side_effect_classification,idempotency_key,completed_at,runner_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(execution_id,node_id,attempt) DO NOTHING`,
      [checkpoint.checkpointId,checkpoint.executionId,checkpoint.workflowRevisionId,checkpoint.nodeId,checkpoint.nodeVersion,checkpoint.attempt,checkpoint.status,checkpoint.inputHash,checkpoint.outputReference,checkpoint.sideEffect,checkpoint.idempotencyKey,checkpoint.completedAt,checkpoint.runnerId]
    );
    return { created: Boolean(result.rowCount) };
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
