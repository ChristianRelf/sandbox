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

export interface InvoiceUsageInput {
  workspaceId: string;
  meter: UsageMeter;
  unit: UsageUnit;
  quantity: number;
  executionCount: number;
  evidenceDigest: string;
}

export interface WorkspaceUsageSummary {
  workspaceId: string;
  periodStartedAt: string;
  periodEndedAt: string;
  reconciliation: "matched";
  meters: Array<{ meter:UsageMeter; unit:UsageUnit; quantity:number }>;
  daily: Array<{ date:string; quantities:Record<UsageMeter,number> }>;
}

export class PostgresUsageLedger {
  constructor(private readonly pool: Pool) {}

  async record(input: UsageEventInput): Promise<{ eventId:string; created:boolean }> {
    validateUsage(input);
    return this.transaction(async client => {
      const deployment = await client.query<{ target_type:string; workspace_id:string; environment_id:string; execution_deployment_id:string; execution_environment_id:string }>(
        `SELECT d.target_type,d.workspace_id,d.environment_id,e.deployment_id AS execution_deployment_id,e.environment_id AS execution_environment_id
           FROM workflow_deployments d
           JOIN executions e ON e.id=$2 AND e.workspace_id=d.workspace_id
          WHERE d.id=$1 FOR SHARE OF d,e`,
        [input.deploymentId,input.executionId]
      );
      if (!deployment.rowCount || deployment.rows[0].workspace_id !== input.workspaceId || deployment.rows[0].environment_id !== input.environmentId || deployment.rows[0].execution_deployment_id !== input.deploymentId || deployment.rows[0].execution_environment_id !== input.environmentId) {
        throw new DomainError("usage_deployment_scope_invalid", "Usage must reference the execution's deployment, workspace, and environment.", 403);
      }
      enforceBillableTarget(deployment.rows[0].target_type,input.meter);
      const requestHash = usageHash(input);
      const inserted=await client.query<{id:string}>(
        `INSERT INTO usage_events(id,workspace_id,environment_id,execution_id,deployment_id,meter,quantity,unit,source_event_id,idempotency_key,request_hash,period_started_at,period_ended_at,region,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT DO NOTHING RETURNING id`,
        [input.eventId,input.workspaceId,input.environmentId,input.executionId,input.deploymentId,input.meter,input.quantity,input.unit,input.sourceEventId,input.idempotencyKey,requestHash,input.periodStartedAt,input.periodEndedAt,input.region,redactMetadata(input.metadata ?? {})]
      );
      if (inserted.rowCount) return { eventId:inserted.rows[0].id,created:true };
      const existing = await client.query<{ id:string; request_hash:string; idempotency_key:string; source_event_id:string; meter:UsageMeter }>(
        `SELECT id,request_hash,idempotency_key,source_event_id,meter FROM usage_events WHERE workspace_id=$1 AND (idempotency_key=$2 OR (source_event_id=$3 AND meter=$4)) FOR SHARE`,
        [input.workspaceId,input.idempotencyKey,input.sourceEventId,input.meter]
      );
      if (!existing.rowCount || existing.rows[0].request_hash !== requestHash || existing.rows[0].idempotency_key !== input.idempotencyKey) throw new DomainError("usage_idempotency_conflict", "The usage idempotency key or source event was already used with a different payload.", 409);
      return { eventId:existing.rows[0].id,created:false };
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
      for (const row of totals.rows) actual[row.meter]=parseSafeQuantity(row.quantity);
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

  async invoiceInputs(periodStartedAt:string,periodEndedAt:string):Promise<InvoiceUsageInput[]> {
    const started=new Date(periodStartedAt),ended=new Date(periodEndedAt);
    if (!Number.isFinite(started.getTime()) || !Number.isFinite(ended.getTime()) || ended <= started) throw new DomainError("invoice_period_invalid", "The invoice period is invalid.");
    const result=await this.pool.query<{ workspace_id:string; meter:UsageMeter; unit:UsageUnit; quantity:string; execution_count:string; event_ids:string[]; reconciliation_ids:string[] }>(
      `WITH latest_reconciliation AS (
         SELECT DISTINCT ON (execution_id) id,execution_id,status
           FROM usage_reconciliations
          ORDER BY execution_id,reconciliation_version DESC
       )
       SELECT u.workspace_id,u.meter,u.unit,sum(u.quantity)::text AS quantity,
              count(DISTINCT u.execution_id)::text AS execution_count,
              array_agg(u.id::text ORDER BY u.id::text) AS event_ids,
              array_agg(DISTINCT r.id::text ORDER BY r.id::text) AS reconciliation_ids
         FROM usage_events u
         JOIN latest_reconciliation r ON r.execution_id=u.execution_id AND r.status='matched'
        WHERE u.period_ended_at > $1 AND u.period_ended_at <= $2
        GROUP BY u.workspace_id,u.meter,u.unit
        ORDER BY u.workspace_id,u.meter,u.unit`,
      [periodStartedAt,periodEndedAt]
    );
    return result.rows.map(row=>({
      workspaceId:row.workspace_id,meter:row.meter,unit:row.unit,quantity:parseSafeQuantity(row.quantity),executionCount:parseSafeQuantity(row.execution_count),
      evidenceDigest:`sha256:${createHash("sha256").update(JSON.stringify({eventIds:row.event_ids,reconciliationIds:row.reconciliation_ids})).digest("hex")}`
    }));
  }

  async workspaceSummary(workspaceId:string,days:number,periodEndedAt=new Date()):Promise<WorkspaceUsageSummary> {
    if (!Number.isSafeInteger(days) || days<1 || days>90) throw new DomainError("usage_period_invalid", "Usage history must cover between 1 and 90 days.");
    if (!Number.isFinite(periodEndedAt.getTime())) throw new DomainError("usage_period_invalid", "The usage period is invalid.");
    const periodStartedAt=new Date(Date.UTC(periodEndedAt.getUTCFullYear(),periodEndedAt.getUTCMonth(),periodEndedAt.getUTCDate()-(days-1)));
    const result=await this.pool.query<{ day:string;meter:UsageMeter;unit:UsageUnit;quantity:string }>(
      `WITH latest_reconciliation AS (
         SELECT DISTINCT ON (execution_id) execution_id,status
           FROM usage_reconciliations
          WHERE workspace_id=$1
          ORDER BY execution_id,reconciliation_version DESC
       )
       SELECT (u.period_ended_at AT TIME ZONE 'UTC')::date::text AS day,u.meter,u.unit,sum(u.quantity)::text AS quantity
         FROM usage_events u
         JOIN latest_reconciliation r ON r.execution_id=u.execution_id AND r.status='matched'
        WHERE u.workspace_id=$1 AND u.period_ended_at>$2 AND u.period_ended_at<=$3
        GROUP BY day,u.meter,u.unit
        ORDER BY day,u.meter,u.unit`,
      [workspaceId,periodStartedAt.toISOString(),periodEndedAt.toISOString()]
    );
    const zeroQuantities=():Record<UsageMeter,number>=>({hosted_runner_seconds:0,managed_browser_seconds:0,network_egress_bytes:0,artifact_storage_byte_seconds:0});
    const points=new Map<string,Record<UsageMeter,number>>();
    for(let index=0;index<days;index+=1){
      const date=new Date(periodStartedAt);date.setUTCDate(date.getUTCDate()+index);
      points.set(date.toISOString().slice(0,10),zeroQuantities());
    }
    const totals=zeroQuantities();
    for(const row of result.rows){
      const quantity=parseSafeQuantity(row.quantity),point=points.get(row.day);
      if(!point||meterUnits[row.meter]!==row.unit)throw new DomainError("usage_aggregation_invalid","Stored usage could not be aggregated safely.",500);
      point[row.meter]=quantity;
      const total=totals[row.meter]+quantity;
      if(!Number.isSafeInteger(total))throw new DomainError("usage_quantity_overflow","Aggregated usage exceeds the supported safe integer range.",500);
      totals[row.meter]=total;
    }
    return{
      workspaceId,periodStartedAt:periodStartedAt.toISOString(),periodEndedAt:periodEndedAt.toISOString(),reconciliation:"matched",
      meters:usageMeters.map(meter=>({meter,unit:meterUnits[meter],quantity:totals[meter]})),
      daily:[...points.entries()].map(([date,quantities])=>({date,quantities}))
    };
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
  const {eventId:_eventId,...payload}=input;
  const canonical=JSON.stringify(Object.fromEntries(Object.entries({...payload,metadata:redactMetadata(input.metadata ?? {})}).sort(([left],[right])=>left.localeCompare(right))));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function redactMetadata(metadata:Record<string,unknown>):Record<string,unknown> {
  const secret=/authorization|cookie|credential|password|secret|token|key/i;
  return Object.fromEntries(Object.entries(metadata).map(([key,value])=>[key,secret.test(key)?"[REDACTED]":value]));
}

function parseSafeQuantity(value:string):number {
  const quantity=Number(value);
  if (!Number.isSafeInteger(quantity) || quantity<0) throw new DomainError("usage_quantity_overflow","Aggregated usage exceeds the supported safe integer range.",500);
  return quantity;
}
