import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedSession } from "./types.js";
import { DomainError } from "./types.js";

export type SupportAccessScope = "diagnostics.read";
export type SupportAccessStatus = "pending" | "approved" | "rejected" | "revoked" | "expired";

export interface SupportAccessRequest {
  id: string;
  workspaceId: string;
  requestedBy: string;
  reason: string;
  scopes: SupportAccessScope[];
  requestedAt: string;
  expiresAt: string;
  status: SupportAccessStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  rationale: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
}

export interface SupportDiagnostics {
  collectedAt: string;
  workspaceId: string;
  runners: Record<string, number>;
  executionsLast24Hours: Record<string, number>;
  queuedEvents: Record<string, number>;
  webhookDeliveries: Record<string, number>;
}

export interface SupportAccessAdministration {
  request(actor: AuthenticatedSession, workspaceId: string, reason: string, scopes: SupportAccessScope[], durationMinutes: number, correlationId: string): Promise<SupportAccessRequest>;
  workspaceId(requestId: string): Promise<string>;
  list(workspaceId: string): Promise<SupportAccessRequest[]>;
  decide(actor: AuthenticatedSession, requestId: string, decision: "approve" | "reject", rationale: string, correlationId: string): Promise<SupportAccessRequest>;
  revoke(actor: AuthenticatedSession, requestId: string, rationale: string, correlationId: string): Promise<SupportAccessRequest>;
  diagnostics(actor: AuthenticatedSession, requestId: string, correlationId: string): Promise<SupportDiagnostics>;
}

interface RequestRow {
  id: string; workspace_id: string; requested_by: string; reason: string; scopes: SupportAccessScope[]; requested_at: Date; requested_until: Date;
  status: Exclude<SupportAccessStatus, "expired">; decided_by: string | null; decided_at: Date | null; rationale: string | null; revoked_by: string | null; revoked_at: Date | null;
}

export class PostgresSupportAccess implements SupportAccessAdministration {
  constructor(private readonly pool: Pool) {}

  async request(actor: AuthenticatedSession, workspaceId: string, reason: string, scopes: SupportAccessScope[], durationMinutes: number, correlationId: string): Promise<SupportAccessRequest> {
    requireSupportOperator(actor);
    if (reason.trim().length < 10) throw new DomainError("support_reason_required", "A specific support reason is required.");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) throw new DomainError("support_duration_invalid", "Support access must last between 15 minutes and 8 hours.");
    if (!scopes.length || scopes.some(scope => scope !== "diagnostics.read")) throw new DomainError("support_scope_invalid", "Only approved support scopes may be requested.");
    return this.transaction(async client => {
      const requestedAt = new Date(), requestedUntil = new Date(requestedAt.getTime() + durationMinutes * 60_000), id = randomUUID();
      const result = await client.query<RequestRow>(`INSERT INTO support_access_requests(id,workspace_id,requested_by,reason,scopes,requested_at,requested_until,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [id, workspaceId, actor.accountId, reason.trim(), [...new Set(scopes)], requestedAt, requestedUntil, correlationId]);
      await event(client, id, "requested", actor.accountId, null, "Customer approval requested.", requestedAt, correlationId);
      return fromRow(result.rows[0], requestedAt);
    });
  }

  async workspaceId(requestId: string): Promise<string> {
    return this.transaction(async client => {
      const result = await client.query<{ workspace_id: string }>(`SELECT workspace_id FROM support_access_requests WHERE id=$1`, [requestId]);
      if (!result.rowCount) throw new DomainError("support_access_not_found", "Support access request was not found.", 404);
      return result.rows[0].workspace_id;
    });
  }

  async list(workspaceId: string): Promise<SupportAccessRequest[]> {
    return this.transaction(async client => (await client.query<RequestRow>(`SELECT * FROM support_access_requests WHERE workspace_id=$1 ORDER BY requested_at DESC,id DESC LIMIT 200`, [workspaceId])).rows.map(row => fromRow(row)));
  }

  async decide(actor: AuthenticatedSession, requestId: string, decision: "approve" | "reject", rationale: string, correlationId: string): Promise<SupportAccessRequest> {
    requireFreshHuman(actor);
    if (!rationale.trim()) throw new DomainError("support_decision_rationale_required", "A support-access decision requires a rationale.");
    return this.transaction(async client => {
      const current = await lockRequest(client, requestId);
      const now = new Date();
      if (current.status !== "pending" || current.requested_until <= now) throw new DomainError("support_access_unavailable", "Support access is no longer available for decision.", 409);
      if (current.requested_by === actor.accountId) throw new DomainError("support_self_approval_denied", "Support staff cannot approve their own access.", 403);
      const status = decision === "approve" ? "approved" : "rejected";
      const result = await client.query<RequestRow>(`UPDATE support_access_requests SET status=$2,decided_by=$3,decided_at=$4,rationale=$5 WHERE id=$1 RETURNING *`, [requestId, status, actor.accountId, now, rationale.trim()]);
      await event(client, requestId, status, actor.accountId, null, `Customer ${status} support access.`, now, correlationId);
      return fromRow(result.rows[0], now);
    });
  }

  async revoke(actor: AuthenticatedSession, requestId: string, rationale: string, correlationId: string): Promise<SupportAccessRequest> {
    if (!rationale.trim()) throw new DomainError("support_revocation_rationale_required", "A revocation rationale is required.");
    return this.transaction(async client => {
      const current = await lockRequest(client, requestId), now = new Date();
      if (current.status !== "approved") throw new DomainError("support_access_unavailable", "Only approved support access can be revoked.", 409);
      const result = await client.query<RequestRow>(`UPDATE support_access_requests SET status='revoked',revoked_by=$2,revoked_at=$3 WHERE id=$1 RETURNING *`, [requestId, actor.accountId, now]);
      await event(client, requestId, "revoked", actor.accountId, null, `Customer revoked access: ${rationale.trim()}`.slice(0, 500), now, correlationId);
      return fromRow(result.rows[0], now);
    });
  }

  async diagnostics(actor: AuthenticatedSession, requestId: string, correlationId: string): Promise<SupportDiagnostics> {
    requireSupportOperator(actor);
    return this.transaction(async client => {
      const grant = await lockRequest(client, requestId), now = new Date();
      if (grant.status !== "approved" || grant.requested_until <= now || grant.requested_by !== actor.accountId || !grant.scopes.includes("diagnostics.read")) throw new DomainError("support_access_denied", "An active customer-approved diagnostics grant is required.", 403);
      const runners = await groupedCounts(client, `SELECT status,count(*)::int count FROM runners WHERE workspace_id=$1 GROUP BY status`, grant.workspace_id);
      const executions = await groupedCounts(client, `SELECT status,count(*)::int count FROM executions WHERE workspace_id=$1 AND queued_at>=now()-interval '24 hours' GROUP BY status`, grant.workspace_id);
      const queue = await groupedCounts(client, `SELECT status,count(*)::int count FROM queued_events WHERE workspace_id=$1 GROUP BY status`, grant.workspace_id);
      const webhooks = await groupedCounts(client, `SELECT status,count(*)::int count FROM webhook_deliveries WHERE workspace_id=$1 GROUP BY status`, grant.workspace_id);
      const diagnostics = redactDiagnosticValue({ collectedAt: now.toISOString(), workspaceId: grant.workspace_id, runners, executionsLast24Hours: executions, queuedEvents: queue, webhookDeliveries: webhooks }) as SupportDiagnostics;
      await event(client, requestId, "diagnostics_accessed", actor.accountId, "diagnostics.read", "Redacted aggregate diagnostics collected.", now, correlationId);
      return diagnostics;
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); await client.query(`SELECT set_config('app.system_role','support_access_service',true)`); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}

export function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, /secret|token|password|credential|authorization|cookie|payload|email/i.test(key) ? "[REDACTED]" : redactDiagnosticValue(item)]));
}

async function lockRequest(client: PoolClient, requestId: string): Promise<RequestRow> { const result = await client.query<RequestRow>(`SELECT * FROM support_access_requests WHERE id=$1 FOR UPDATE`, [requestId]); if (!result.rowCount) throw new DomainError("support_access_not_found", "Support access request was not found.", 404); return result.rows[0]; }
async function event(client: PoolClient, requestId: string, eventType: string, actorId: string, scope: string | null, summary: string, at: Date, correlationId: string): Promise<void> { await client.query(`INSERT INTO support_access_events(id,request_id,sequence,event_type,actor_account_id,scope,resource_summary,occurred_at,correlation_id) VALUES($1,$2,(SELECT COALESCE(max(sequence),0)+1 FROM support_access_events WHERE request_id=$2),$3,$4,$5,$6,$7,$8)`, [randomUUID(), requestId, eventType, actorId, scope, summary, at, correlationId]); }
async function groupedCounts(client: PoolClient, query: string, workspaceId: string): Promise<Record<string, number>> { const result = await client.query<{ status: string; count: number }>(query, [workspaceId]); return Object.fromEntries(result.rows.map(row => [row.status, row.count])); }
function fromRow(row: RequestRow, now = new Date()): SupportAccessRequest { return { id: row.id, workspaceId: row.workspace_id, requestedBy: row.requested_by, reason: row.reason, scopes: row.scopes, requestedAt: row.requested_at.toISOString(), expiresAt: row.requested_until.toISOString(), status: row.status === "approved" && row.requested_until <= now ? "expired" : row.status, decidedBy: row.decided_by, decidedAt: row.decided_at?.toISOString() ?? null, rationale: row.rationale, revokedBy: row.revoked_by, revokedAt: row.revoked_at?.toISOString() ?? null }; }
function requireSupportOperator(actor: AuthenticatedSession): void { if ((actor.principalType ?? "user") !== "user" || !actor.platformPermissions.includes("support_access.manage")) throw new DomainError("support_operator_required", "A human support operator is required.", 403); }
function requireFreshHuman(actor: AuthenticatedSession): void { if ((actor.principalType ?? "user") !== "user" || !actor.authenticationMethods.some(method => ["passkey", "webauthn", "mfa"].includes(method)) || Math.abs(Date.now() - actor.issuedAt.getTime()) > 15 * 60_000) throw new DomainError("step_up_required", "A recent human step-up authentication is required.", 403); }
