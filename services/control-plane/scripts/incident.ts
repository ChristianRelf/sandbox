import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PostgresOperationalIncidents, type IncidentStatus, type PostIncidentReport } from "../src/incidents.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const [command, incidentId, inputPath] = process.argv.slice(2);
if (!command) throw new Error("Usage: npm run incident --workspace @sandbox/control-plane -- <declare|update|transition|review|timeline> [incident-id] [input.json]");
const pool = new Pool({ connectionString, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined, max: 1 });
const incidents = new PostgresOperationalIncidents(pool);

try {
  const input = inputPath ? JSON.parse(await readFile(inputPath, "utf8")) as Record<string, unknown> : {};
  let result: unknown;
  if (command === "declare") {
    const declarationPath = incidentId;
    if (!declarationPath) throw new Error("declare requires an input JSON path");
    const declaration = JSON.parse(await readFile(declarationPath, "utf8")) as Record<string, string>;
    result = await incidents.declare({ severity: declaration.severity as "sev1" | "sev2" | "sev3" | "sev4", title: declaration.title, owningTeam: declaration.owningTeam, customerImpact: declaration.customerImpact, actorAccountId: declaration.actorAccountId, startedAt: new Date(declaration.startedAt), correlationId: declaration.correlationId });
  } else if (command === "timeline") {
    if (!incidentId) throw new Error("timeline requires an incident ID");
    result = await incidents.timeline(incidentId);
  } else {
    if (!incidentId || !inputPath) throw new Error(`${command} requires an incident ID and input JSON path`);
    const actorAccountId = String(input.actorAccountId);
    const occurredAt = new Date(String(input.occurredAt));
    const correlationId = String(input.correlationId);
    if (command === "update") result = await incidents.appendUpdate(incidentId, actorAccountId, String(input.message), Boolean(input.publicUpdate), occurredAt, correlationId);
    else if (command === "transition") result = await incidents.transition(incidentId, actorAccountId, String(input.status) as Exclude<IncidentStatus, "reviewed">, String(input.message), Boolean(input.publicUpdate), occurredAt, correlationId);
    else if (command === "review") result = await incidents.publishReview(incidentId, actorAccountId, input.report as PostIncidentReport, occurredAt, correlationId);
    else throw new Error(`Unknown incident command '${command}'.`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await pool.end();
}
