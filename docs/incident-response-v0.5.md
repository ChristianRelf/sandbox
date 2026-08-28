# Incident response and recovery v0.5

Operational incidents use five forward-only states: `investigating`, `identified`, `monitoring`, `resolved`, and `reviewed`. Declaration metadata and every timeline event are immutable. A resolved incident becomes reviewed only after publication of a structured report containing impact, root cause, detection, response, recovery, lessons, and at least one owned corrective action with a due date and tracking reference.

Severity is recorded as `sev1` through `sev4`. The incident commander owns state changes; the communications lead marks customer-safe timeline updates as public; the operations lead records recovery actions; and the review owner publishes the final report. Database access for the incident command is privileged operational access and must use an individually attributable actor account.

Apply migrations, set `DATABASE_URL`, then use the control-plane incident command with JSON files kept outside the repository:

```powershell
npm.cmd run incident --workspace @sandbox/control-plane -- declare C:\secure\incident-declaration.json
npm.cmd run incident --workspace @sandbox/control-plane -- transition <incident-id> C:\secure\identified-update.json
npm.cmd run incident --workspace @sandbox/control-plane -- update <incident-id> C:\secure\customer-update.json
npm.cmd run incident --workspace @sandbox/control-plane -- review <incident-id> C:\secure\post-incident-report.json
npm.cmd run incident --workspace @sandbox/control-plane -- timeline <incident-id>
```

Each mutation file carries `actorAccountId`, `occurredAt`, and `correlationId`. Transition files additionally carry `status`, `message`, and `publicUpdate`; update files carry `message` and `publicUpdate`; review files carry `report`. A declaration contains `severity`, `title`, `owningTeam`, `customerImpact`, `actorAccountId`, `startedAt`, and `correlationId`. Never place secrets, raw workflow payloads, credentials, or personal data in incident messages.

## Recovery exercise

For queue recovery, claim a test event, stop the worker without acknowledgement, wait beyond visibility expiry, run reclaim, and verify that another worker receives the same queue/event identity at the next attempt. Complete it once and compare the append-only attempt timeline.

For capacity failure, exhaust the primary pool and verify that routing returns no runner with explicit capacity diagnostics. Activate only a pre-approved deployment and pool in the secondary region, preserving workflow revision, environment, permission snapshot, idempotency identity, and connection restrictions. Verify completion and then return traffic deliberately; region requirements must never be weakened implicitly.

During the exercise, declare an incident, publish customer-safe updates for detection, identified cause, monitoring, and resolution, then publish the post-incident report. Export the timeline and reconcile its sequence with queue attempt events, execution events, alerts, and status updates. The automated PostgreSQL gate exercises visibility-timeout reclaim and the immutable incident lifecycle; target-infrastructure capacity and regional exercises remain required before GA-015 can close.
