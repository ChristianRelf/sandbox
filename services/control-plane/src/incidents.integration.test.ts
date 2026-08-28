import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresOperationalIncidents, type PostIncidentReport } from "./incidents.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

integration("durable operational incident evidence", () => {
  const pool = new Pool({ connectionString, max: 4 });
  const incidents = new PostgresOperationalIncidents(pool);
  const actorAccountId = randomUUID();
  const correlationId = randomUUID();
  const startedAt = new Date("2026-08-28T09:00:00.000Z");

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name) VALUES($1,$2,$3,true,'Incident operator')`,
      [actorAccountId, `incident-${actorAccountId}`, `${actorAccountId}@example.invalid`]
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("persists an immutable timeline through resolution and post-incident review", async () => {
    const declared = await incidents.declare({ severity: "sev2", title: "Primary runner capacity exhausted", owningTeam: "Runtime SRE", customerImpact: "Production workflows are waiting for capacity.", actorAccountId, startedAt, correlationId });
    await incidents.transition(declared.id, actorAccountId, "identified", "The primary pool was drained during maintenance.", true, new Date("2026-08-28T09:05:00.000Z"), correlationId);
    await incidents.transition(declared.id, actorAccountId, "monitoring", "Approved secondary-region capacity is processing the retained queue.", true, new Date("2026-08-28T09:15:00.000Z"), correlationId);
    await incidents.transition(declared.id, actorAccountId, "resolved", "Queue depth and wait time returned to objective.", true, new Date("2026-08-28T09:30:00.000Z"), correlationId);
    const report: PostIncidentReport = {
      summary: "Regional runner capacity was unavailable for thirty minutes.",
      impact: "Production workflows waited without duplicate execution.",
      rootCause: "Maintenance drained the primary pool without sufficient regional headroom.",
      detection: "Waiting-for-runner and capacity signals alerted the on-call operator.",
      response: "The incident commander enabled the pre-approved secondary pool.",
      recovery: "Visibility-timeout reclaim retained event identity and secondary-region runners drained the queue.",
      lessons: ["Maintenance approval must include measured secondary-region headroom."],
      correctiveActions: [{ action: "Gate maintenance on regional capacity.", owner: "Runtime SRE", dueAt: "2026-09-04T12:00:00.000Z", trackingReference: "OPS-142" }]
    };
    const reviewed = await incidents.publishReview(declared.id, actorAccountId, report, new Date("2026-08-29T12:00:00.000Z"), correlationId);
    expect(reviewed).toMatchObject({ status: "reviewed", postIncidentReport: report });
    const timeline = await incidents.timeline(declared.id);
    expect(timeline.map(event => [event.sequence, event.eventType, event.statusSnapshot])).toEqual([
      [1, "declared", "investigating"],
      [2, "status_changed", "identified"],
      [3, "status_changed", "monitoring"],
      [4, "resolved", "resolved"],
      [5, "review_published", "reviewed"]
    ]);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.system_role','incident_operator',true)`);
      await expect(client.query(`UPDATE operational_incident_events SET message='rewritten' WHERE incident_id=$1 AND sequence=1`, [declared.id])).rejects.toThrow(/append-only/);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.system_role','incident_operator',true)`);
      await expect(client.query(`UPDATE operational_incidents SET title='rewritten' WHERE id=$1`, [declared.id])).rejects.toThrow(/reviewed_incident_is_immutable/);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
