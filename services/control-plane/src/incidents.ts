import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved" | "reviewed";
export type IncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4";

export interface IncidentRecord {
  id: string;
  severity: IncidentSeverity;
  title: string;
  owningTeam: string;
  customerImpact: string;
  status: IncidentStatus;
  declaredBy: string;
  startedAt: string;
  resolvedAt: string | null;
  reviewedAt: string | null;
  postIncidentReport: PostIncidentReport | null;
  correlationId: string;
}

export interface IncidentEvent {
  id: string;
  incidentId: string;
  sequence: number;
  eventType: "declared" | "update" | "status_changed" | "resolved" | "review_published";
  statusSnapshot: IncidentStatus;
  message: string;
  publicUpdate: boolean;
  actorAccountId: string;
  occurredAt: string;
  correlationId: string;
}

const correctiveActionSchema = z.object({
  action: z.string().trim().min(1).max(1_000),
  owner: z.string().trim().min(1).max(200),
  dueAt: z.string().datetime(),
  trackingReference: z.string().trim().min(1).max(500)
}).strict();

export const postIncidentReportSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  impact: z.string().trim().min(1).max(4_000),
  rootCause: z.string().trim().min(1).max(4_000),
  detection: z.string().trim().min(1).max(4_000),
  response: z.string().trim().min(1).max(4_000),
  recovery: z.string().trim().min(1).max(4_000),
  lessons: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
  correctiveActions: z.array(correctiveActionSchema).min(1).max(100)
}).strict();
export type PostIncidentReport = z.infer<typeof postIncidentReportSchema>;

const transitions: Record<IncidentStatus, ReadonlySet<IncidentStatus>> = {
  investigating: new Set(["identified", "monitoring", "resolved"]),
  identified: new Set(["monitoring", "resolved"]),
  monitoring: new Set(["resolved"]),
  resolved: new Set(["reviewed"]),
  reviewed: new Set()
};

export function validateIncidentTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!transitions[from].has(to)) throw new Error(`Incident cannot transition from ${from} to ${to}.`);
}

interface IncidentRow {
  id: string; severity: IncidentSeverity; title: string; owning_team: string; customer_impact: string; status: IncidentStatus;
  declared_by: string; started_at: Date; resolved_at: Date | null; reviewed_at: Date | null; post_incident_report: PostIncidentReport | null; correlation_id: string;
}

interface EventRow {
  id: string; incident_id: string; sequence: number; event_type: IncidentEvent["eventType"]; status_snapshot: IncidentStatus;
  message: string; public_update: boolean; actor_account_id: string; occurred_at: Date; correlation_id: string;
}

export class PostgresOperationalIncidents {
  constructor(private readonly pool: Pool) {}

  async declare(input: { severity: IncidentSeverity; title: string; owningTeam: string; customerImpact: string; actorAccountId: string; startedAt: Date; correlationId: string }): Promise<IncidentRecord> {
    if (input.title.trim().length < 3 || input.owningTeam.trim().length < 2 || !input.customerImpact.trim()) throw new Error("Incident declaration is incomplete.");
    return this.transaction(async client => {
      const id = randomUUID();
      const result = await client.query<IncidentRow>(
        `INSERT INTO operational_incidents(id,severity,title,owning_team,customer_impact,status,declared_by,started_at,correlation_id)
         VALUES($1,$2,$3,$4,$5,'investigating',$6,$7,$8) RETURNING *`,
        [id, input.severity, input.title.trim(), input.owningTeam.trim(), input.customerImpact.trim(), input.actorAccountId, input.startedAt, input.correlationId]
      );
      await this.appendEvent(client, id, "declared", "investigating", input.customerImpact.trim(), true, input.actorAccountId, input.startedAt, input.correlationId);
      return incidentRecord(result.rows[0]);
    });
  }

  async appendUpdate(incidentId: string, actorAccountId: string, message: string, publicUpdate: boolean, occurredAt: Date, correlationId: string): Promise<IncidentEvent> {
    if (!message.trim()) throw new Error("Incident update message is required.");
    return this.transaction(async client => {
      const incident = await this.lockIncident(client, incidentId);
      if (incident.status === "reviewed") throw new Error("Reviewed incidents are immutable.");
      return this.appendEvent(client, incidentId, "update", incident.status, message.trim(), publicUpdate, actorAccountId, occurredAt, correlationId);
    });
  }

  async transition(incidentId: string, actorAccountId: string, toStatus: Exclude<IncidentStatus, "reviewed">, message: string, publicUpdate: boolean, occurredAt: Date, correlationId: string): Promise<IncidentRecord> {
    if (!message.trim()) throw new Error("Incident transition message is required.");
    return this.transaction(async client => {
      const current = await this.lockIncident(client, incidentId);
      validateIncidentTransition(current.status, toStatus);
      const result = await client.query<IncidentRow>(
        `UPDATE operational_incidents SET status=$2,resolved_at=CASE WHEN $2='resolved' THEN $3 ELSE resolved_at END WHERE id=$1 RETURNING *`,
        [incidentId, toStatus, occurredAt]
      );
      await this.appendEvent(client, incidentId, toStatus === "resolved" ? "resolved" : "status_changed", toStatus, message.trim(), publicUpdate, actorAccountId, occurredAt, correlationId);
      return incidentRecord(result.rows[0]);
    });
  }

  async publishReview(incidentId: string, actorAccountId: string, reportInput: PostIncidentReport, occurredAt: Date, correlationId: string): Promise<IncidentRecord> {
    const report = postIncidentReportSchema.parse(reportInput);
    return this.transaction(async client => {
      const current = await this.lockIncident(client, incidentId);
      validateIncidentTransition(current.status, "reviewed");
      const result = await client.query<IncidentRow>(
        `UPDATE operational_incidents SET status='reviewed',reviewed_at=$2,post_incident_report=$3 WHERE id=$1 RETURNING *`,
        [incidentId, occurredAt, JSON.stringify(report)]
      );
      await this.appendEvent(client, incidentId, "review_published", "reviewed", report.summary, true, actorAccountId, occurredAt, correlationId);
      return incidentRecord(result.rows[0]);
    });
  }

  async timeline(incidentId: string): Promise<IncidentEvent[]> {
    return this.transaction(async client => {
      await this.lockIncident(client, incidentId);
      const result = await client.query<EventRow>(`SELECT * FROM operational_incident_events WHERE incident_id=$1 ORDER BY sequence`, [incidentId]);
      return result.rows.map(incidentEvent);
    });
  }

  private async lockIncident(client: PoolClient, incidentId: string): Promise<IncidentRow> {
    const result = await client.query<IncidentRow>(`SELECT * FROM operational_incidents WHERE id=$1 FOR UPDATE`, [incidentId]);
    if (!result.rowCount) throw new Error("Incident not found.");
    return result.rows[0];
  }

  private async appendEvent(client: PoolClient, incidentId: string, eventType: IncidentEvent["eventType"], status: IncidentStatus, message: string, publicUpdate: boolean, actorAccountId: string, occurredAt: Date, correlationId: string): Promise<IncidentEvent> {
    const result = await client.query<EventRow>(
      `INSERT INTO operational_incident_events(id,incident_id,sequence,event_type,status_snapshot,message,public_update,actor_account_id,occurred_at,correlation_id)
       VALUES($1,$2,(SELECT COALESCE(max(sequence),0)+1 FROM operational_incident_events WHERE incident_id=$2),$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [randomUUID(), incidentId, eventType, status, message, publicUpdate, actorAccountId, occurredAt, correlationId]
    );
    return incidentEvent(result.rows[0]);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.system_role','incident_operator',true)`);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function incidentRecord(row: IncidentRow): IncidentRecord {
  return { id: row.id, severity: row.severity, title: row.title, owningTeam: row.owning_team, customerImpact: row.customer_impact, status: row.status, declaredBy: row.declared_by, startedAt: row.started_at.toISOString(), resolvedAt: row.resolved_at?.toISOString() ?? null, reviewedAt: row.reviewed_at?.toISOString() ?? null, postIncidentReport: row.post_incident_report, correlationId: row.correlation_id };
}

function incidentEvent(row: EventRow): IncidentEvent {
  return { id: row.id, incidentId: row.incident_id, sequence: row.sequence, eventType: row.event_type, statusSnapshot: row.status_snapshot, message: row.message, publicUpdate: row.public_update, actorAccountId: row.actor_account_id, occurredAt: row.occurred_at.toISOString(), correlationId: row.correlation_id };
}
