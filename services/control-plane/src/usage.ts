import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "./types.js";

export const usageMeters = ["hosted_runner_seconds", "managed_browser_seconds", "network_egress_bytes", "artifact_storage_byte_seconds"] as const;
export type UsageMeter = typeof usageMeters[number];
export type UsageUnit = "seconds" | "bytes" | "byte_seconds";

const meterUnits: Readonly<Record<UsageMeter,UsageUnit>> = {
  hosted_runner_seconds: "seconds",
  managed_browser_seconds: "seconds",
  network_egress_bytes: "bytes",
  artifact_storage_byte_seconds: "byte_seconds"
};

export interface UsageEventInput {
  eventId: string;
  workspaceId: string;
  environmentId: string;
  executionId: string;
  deploymentId: string;
  meter: UsageMeter;
  quantity: number;
  unit: UsageUnit;
  sourceEventId: string;
  idempotencyKey: string;
  periodStartedAt: string;
  periodEndedAt: string;
  region: string;
  metadata?: Record<string,unknown>;
}

export interface UsageReconciliation {
  reconciliationId: string;
  executionId: string;
  version: number;
  status: "matched" | "discrepancy";
  expected: Partial<Record<UsageMeter,number>>;
  actual: Partial<Record<UsageMeter,number>>;
  discrepancies: Partial<Record<UsageMeter,number>>;
}

export class PostgresUsageLedger {
  constructor(private readonly pool: Pool) {}

  async record(input: UsageEventInput): Promise<{ eventId:string; created:boolean }> {
    validateUsage(input);
    return this.transaction(async client => {
      const deployment = await client.query<{ target_type:string; workspace_id:string; environment_id:string }>(
        `SELECT target_type,workspace_id,environment_id FROM workflow_deployments WHERE id=$1 FOR SHARE`,
        [input.deploymentId]
      );
      if (!deployment.rowCount || deployment.rows[0].workspace_id !== input.workspaceId || deployment.rows[0].environment_id !== input.environmentId) {
        throw new DomainError("usage_deployment_scope_invalid", "Usage must reference a deployment in the same workspace and environment.", 403);
      }
      enforceBillableTarget(deployment.rows[0].target_type,input.meter);
      const requestHash = usageHash(input);
      const existing = await client.query<{ id:string; request_hash:string }>(
        `SELECT id,request_hash FROM usage_events WHERE workspace_id=$1 AND idempotency_key=$2`,
        [input.workspaceId,input.idempotencyKey]
      );
      if (existing.rowCount) {
        if (existing.rows[0].request_hash !== requestHash) throw new DomainError("usage_idempotency_conflict", "The usage idempotency key was already used with a different payload.", 409);
        return { eventId:existing.rows[0].id,created:false };
      }
      await client.query(
        `INSERT INTO usage_events(id,workspace_id,environment_id,execution_id,deployment_id,meter,quantity,unit,source_event_id,idempotency_key,request_hash,period_started_at,period_ended_at,region,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [input.eventId,input.workspaceId,input.environmentId,input.executionId,input.deploymentId,input.meter,input.quantity,input.unit,input.sourceEventId,input.idempotencyKey,requestHash,input.periodStartedAt,input.periodEndedAt,input.region,redactMetadata(input.metadata ?? {})]
      );
      return { eventId:input.eventId,created:true };
    });
  }

  async reconcile(executionId:string, expected:Partial<Record<UsageMeter,number>>, correlationId:string):Promise<UsageReconciliation> {
    for (const [meter,quantity] of Object.entries(expected)) {
      if (!usageMeters.includes(meter as UsageMeter) || !Number.isSafeInteger(quantity) || quantity! < 0) throw new DomainError("usage_reconciliation_invalid", "Expected usage quantities must be non-negative safe integers.");
    }
    return this.transaction(async client => {
      const execution = await client.query<{ workspace_id:string; status:string }>(`SELECT workspace_id,status FROM executions WHERE id=$1 FOR SHARE`,[executionId]);
      if (!execution.rowCount) throw new DomainError("execution_not_found", "Execution was not found.", 404);
      if (!['succeeded','failed','timed_out','skipped','cancelled','expired'].includes(execution.rows[0].status)) throw new DomainError("usage_reconciliation_too_early", "Usage can be reconciled only after execution reaches a terminal state.", 409);
      const totals = await client.query<{ meter:UsageMeter; quantity:string }>(`SELECT meter,sum(quantity)::text AS quantity FROM usage_events WHERE execution_id=$1 GROUP BY meter`,[executionId]);
      const actual:Partial<Record<UsageMeter,number>> = {};
      for (const row of totals.rows) actual[row.meter]=Number(row.quantity);
      const discrepancies:Partial<Record<UsageMeter,number>> = {};
      for (const meter of new Set([...Object.keys(expected),...Object.keys(actual)]) as Set<UsageMeter>) {
        const difference=(actual[meter] ?? 0)-(expected[meter] ?? 0);
        if (difference !== 0) discrepancies[meter]=difference;
      }
      const previous = await client.query<{ version:string }>(`SELECT COALESCE(max(reconciliation_version),0)::text AS version FROM usage_reconciliations WHERE execution_id=$1`,[executionId]);
      const version=Number(previous.rows[0].version)+1;
      const reconciliationId=randomUUID();
      const status=Object.keys(discrepancies).length ? "discrepancy" as const : "matched" as const;
      await client.query(
        `INSERT INTO usage_reconciliations(id,workspace_id,execution_id,reconciliation_version,expected_quantities,actual_quantities,discrepancies,status,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [reconciliationId,execution.rows[0].workspace_id,executionId,version,expected,actual,discrepancies,status,correlationId]
      );
      return { reconciliationId,executionId,version,status,expected,actual,discrepancies };
    });
  }

  private async transaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); const result=await operation(client); await client.query('COMMIT'); return result; }
    catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

function validateUsage(input:UsageEventInput):void {
  if (!usageMeters.includes(input.meter)) throw new DomainError("usage_meter_invalid", "Usage meter is unsupported.");
  if (meterUnits[input.meter] !== input.unit) throw new DomainError("usage_unit_invalid", `Meter '${input.meter}' requires unit '${meterUnits[input.meter]}'.`);
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) throw new DomainError("usage_quantity_invalid", "Usage quantity must be a non-negative safe integer.");
  const started=new Date(input.periodStartedAt),ended=new Date(input.periodEndedAt);
  if (!Number.isFinite(started.getTime()) || !Number.isFinite(ended.getTime()) || ended < started) throw new DomainError("usage_period_invalid", "Usage period is invalid.");
  if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) throw new DomainError("usage_idempotency_key_invalid", "Usage idempotency key must contain 16 to 200 characters.");
}

function enforceBillableTarget(target:string,meter:UsageMeter):void {
  if (meter === "hosted_runner_seconds" && target !== "managed_cloud_runner") throw new DomainError("local_usage_not_billable", "Hosted runner time can be recorded only for a managed cloud runner deployment.", 409);
  if (meter === "managed_browser_seconds" && target !== "managed_browser_worker") throw new DomainError("local_usage_not_billable", "Managed browser time can be recorded only for a managed browser deployment.", 409);
}

function usageHash(input:UsageEventInput):string {
  const canonical=JSON.stringify(Object.fromEntries(Object.entries({...input,metadata:redactMetadata(input.metadata ?? {})}).sort(([left],[right])=>left.localeCompare(right))));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function redactMetadata(metadata:Record<string,unknown>):Record<string,unknown> {
  const secret=/authorization|cookie|credential|password|secret|token|key/i;
  return Object.fromEntries(Object.entries(metadata).map(([key,value])=>[key,secret.test(key)?"[REDACTED]":value]));
}

