# sndbox v0.4 architecture update

## Architectural direction

Stage four adds an execution plane beside the existing local-first desktop and control plane. It does not move the editor, personal workflow store or local runner into the cloud.

```text
                         optional control-plane connection
  +------------------+  publish encrypted revision / deployment metadata
  | Desktop app      |-----------------------------------------------+
  | editor + local   |                                               |
  | Rust engine      |<-- local execution remains account-free       v
  +--------+---------+                                  +-------------------------+
           | same workflow spec                         | Control plane           |
           | and engine semantics                       | authz + deployments     |
           |                                            | durable state + queue   |
           |                                            | routing + usage ledger  |
           |                                            +-----+-------------+-----+
           |                                                  | leases      |
           |                                                  | signed work |
           v                                                  v             v
  +------------------+                               +----------------+  +----------------+
  | Paired desktop / |                               | Hosted runner  |  | Browser worker |
  | server / ARM64 / |                               | short-lived    |  | isolated       |
  | NAS agent        |                               | workload       |  | Chromium       |
  +------------------+                               +----------------+  +----------------+
           ^                                                  ^             ^
           +---------------- versioned runner protocol -------+-------------+
```

## Non-negotiable boundaries

1. Workflow semantics live in the versioned Rust workflow engine. Runner types expose capability differences; they do not reinterpret graphs.
2. Every deployment names an execution target, environment, region, revision, permission snapshot, connection mapping and exact plugin set.
3. Queue delivery is at least once. Leases reduce normal duplicate claiming but do not prove an external side effect did not occur after a partition.
4. Completed state is append-only. A runner proposes events; the control plane validates transitions and terminal-state rules.
5. Personal-local workflows and runs never enter hosted usage metering.
6. Hosted workloads receive workspace-scoped, execution-scoped, time-limited authority and no ambient control-plane or metadata-network access.
7. Cloud browser profiles are separate resources. Local profiles are never uploaded implicitly and saved passwords are never imported.

## Stage-four service boundaries

| Component | Responsibility | Explicit exclusion |
| --- | --- | --- |
| Control plane API | deployments, runner identities, pools, routing policy, state transitions, approvals, customer views | node execution |
| Scheduler | durable schedule evaluation, misfires, jitter, backfill and unique event emission | web-process timers |
| Control worker | queue claiming, compatibility routing, lease/recovery decisions, dead-letter administration | running customer code |
| Hosted runner | non-browser workflow nodes inside a short-lived constrained workload | shell, local files, UI automation |
| Browser worker | isolated Chromium context, network policy, download scan and artifact production | profile sharing or plugin CDP access |
| Usage meter | immutable idempotent resource records and reconciliation | invoices from mutable run summaries |
| Self-hosted agent | paired execution on approved customer infrastructure with strict configuration | permanent account credentials |
| Private connector | outbound authenticated advertisement of approved services | general-purpose VPN |

## Durable execution invariants

- `execution_events` is the append-only source of transition history; `executions` is its transactionally updated projection.
- `(execution_id, transition_id)` is unique, making retries idempotent.
- only a valid unexpired lease holder can report runner-owned progress;
- terminal executions cannot be reopened by a runner;
- checkpoints are immutable per execution/node/attempt and record side-effect classification and idempotency evidence;
- lease loss after an unsafe or unknown side effect produces an explicit uncertain recovery decision and blocks automatic replay;
- queue replay retains the original event identity and creates a separate replay record.

## Local-first data flow

Publishing creates an immutable revision; deployment is a later, separately authorized operation. Pre-deployment validation uses only declared metadata and explicitly mapped resources. Secrets are never copied during environment promotion. The selected runner receives an encrypted package reference and short-lived resource grants, not the desktop's local files, browser profile or credential vault.

