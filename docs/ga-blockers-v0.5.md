# v0.5.0 GA blocker register

This is the authoritative blocker register for the first GA candidate. `Open` and `Blocked externally` items prevent a GA declaration according to the release criteria below. A passing component test is not substituted for an end-to-end operational exercise.

Severity definitions:

- **Critical**: security, isolation, data-loss, billing-integrity or claimed core execution behaviour that is absent or unsafe. Blocks all GA candidates.
- **High**: required GA administration, recovery, compatibility or operability control is absent. Blocks stable production release.
- **Medium**: material supportability or quality gap that may be accepted only as a documented, owned limitation.

| ID | Severity | Owner | Required release | Status | Blocker / acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| GA-001 | Critical | Execution | v0.5.0 | In progress | The self-hosted agent polls with bounded concurrency, verifies signed target/expiry and exact approved revision content hashes, atomically claims durable SQLite receipts, executes through the shared engine, reports accepted/completed/rejected state, safely replays completion and rejects restart-interrupted work. Exercise the full control-plane-to-agent lifecycle on supported Linux packages before closure. |
| GA-002 | Critical | Billing | v0.5.0 | In progress | Immutable usage records, race-safe payload-bound idempotency, local-target exclusion, redaction and execution reconciliation are implemented. Hosted and managed-browser runtimes submit freshness-checked HMAC events, and invoice inputs admit only the latest matched reconciliation with evidence digests. Rotate production producer keys and reconcile a real invoice period before closure. |
| GA-003 | Critical | Security | v0.5.0 | Open | Resolve all external penetration-test criticals and attach retest evidence. No external report is available. |
| GA-004 | Critical | Security | v0.5.0 | Open | Complete adversarial tenant-isolation review across control plane, runners, artifacts, browser profiles, queues and every v0.5 table. |
| GA-005 | Critical | Reliability | v0.5.0 | Blocked externally | Restore the latest encrypted production backup into an isolated environment and reconcile application-level counts/hashes. Fresh staging schema restore passed, but is insufficient. |
| GA-006 | High | Release engineering | v0.5.0 | Closed | Product, desktop, web, service, SDK, sidecar and runner metadata align on 0.5.0. The published support matrix defines API, runner-protocol, host, plugin, database and mixed-version boundaries and is enforced by the default test suite. |
| GA-007 | High | Release engineering | v0.5.0 | In progress | The default complete suite discovers scheduler, browser-worker, hosted-runner and agent tests. CI now provisions PostgreSQL 16, applies migrations, supplies `TEST_DATABASE_URL`, installs Chromium and runs every Node and Rust suite; attach a successful protected-branch run before closure. |
| GA-008 | High | Security | v0.5.0 | In progress | Rust advisory scans report no known vulnerabilities; the desktop graph has 18 maintenance/unsound/yanked warnings requiring disposition. SBOM, container and provenance scans remain. |
| GA-009 | High | Execution | v0.5.0 | Open | Exercise hosted orchestration with real leases, short-lived workload identity, network policy, cgroup limits, artifact namespace and concurrent cross-tenant workloads. |
| GA-010 | High | Browser | v0.5.0 | Open | Exercise DNS rebinding/redirect policy, download scanner, encrypted profile store and worker destruction in the target orchestrator. |
| GA-011 | High | Platform security | v0.5.0 | In progress | Command issuance now resolves an immutable workspace environment and signs principal, action-to-permission mapping, credential scopes/restrictions and service-account role permissions. Desktop and self-hosted agents fail closed on any boundary mismatch, and migration expires legacy commands lacking context. Complete the resource/action audit and apply equivalent policy at managed orchestrator boundaries before closure. |
| GA-012 | High | Identity | v0.5.0 | In progress | Workspace and organisation service principals now include explicit multi-workspace assignments, bounded tokens, immediate revocation, human ownership, expiry notifications, workspace-bound replay-protected Ed25519 client assertions, and 90-day access reviews with immutable snapshots. Overdue reviews suspend the principal and revoke credentials; retain/revoke decisions require a fresh human authorized in every assigned workspace. Run the migration and overdue/decision integration case in PostgreSQL CI before closure. |
| GA-013 | High | API | v0.5.0 | Closed | Compatibility/deprecation and rate-limit policies, structured transport errors, correlation IDs, encrypted 24-hour PostgreSQL idempotency replay, live OpenAPI with named per-operation request/response schemas, checked-in drift gate and typed SDK compatibility tests are implemented. |
| GA-014 | High | Reliability | v0.5.0 | In progress | Separate liveness/readiness routes, bounded Prometheus request/readiness metrics, PostgreSQL and recurring-task probes, authenticated scraping and failure/recovery API tests are implemented. Configure and exercise production alert delivery, a scheduled end-to-end synthetic workflow, and incident/status communication before closure. |
| GA-015 | High | Reliability | v0.5.0 | In progress | Visibility-timeout queue reclaim, capacity exhaustion diagnostics, explicit secondary-region selection, an append-only incident timeline, forward-only lifecycle and mandatory structured post-incident reports are implemented and covered by unit/PostgreSQL gates. Execute the capacity and regional recovery scenario in target infrastructure and reconcile its status/alert evidence before closure. |
| GA-016 | High | Support | v0.5.0 | Open | Implement customer-approved, scoped, expiring support access plus redacted diagnostics. No production support-access path exists. |
| GA-017 | High | Privacy | v0.5.0 | Open | Implement enforceable retention/export/deletion controls and data-classification mapping; current JSON retention metadata is not an enforcement system. |
| GA-018 | High | Accessibility | v0.5.0 | Open | Complete WCAG 2.2 AA review and provide a keyboard/screen-reader alternative to drag-only graph editing. |
| GA-019 | High | Release engineering | v0.5.0 | Open | Produce signed desktop, agent and container artifacts with provenance. Existing local packages and audit images are unsigned. |
| GA-020 | Medium | Frontend | v0.5.0 | Open | Split the oversized desktop bundle or document measured startup impact; current production build emits the existing chunk warning. |
| GA-021 | Medium | Marketplace | v0.5.0 | Open | Replace object-store/scanner/payout gaps or document them as unavailable; validate full webhook JSON Schema. |
| GA-022 | Medium | Documentation | v0.5.0 | Open | Publish versioned support matrix, limitations, administration/API/CLI/GitOps/security/runbook documentation with tested commands. |

## Closed evidence

| ID | Closed | Evidence |
| --- | --- | --- |
| GA-C01 | 2026-08-28 | The audited PostgreSQL migration set applies once and is checksum-idempotent; later numbered migrations remain covered by the same protected CI gate. |
| GA-C02 | 2026-08-27 | Control-plane and scheduler database integration suites pass against clean PostgreSQL 16. |
| GA-C03 | 2026-08-27 | Fresh staging logical backup restores into an isolated database with matching schema inventory. Production-backup evidence remains GA-005. |
| GA-C04 | 2026-08-27 | npm production advisory audit reports zero known vulnerabilities. |
| GA-C05 | 2026-08-28 | API contract tests prove structured transport errors, correlation propagation, rate-limit responses, exact idempotent replay and mutation rejection; PostgreSQL integration confirms replay bodies are encrypted at rest. |
| GA-C06 | 2026-08-28 | The public API client executes a privileged typed credential mutation against the real Fastify server, supplies freshness/correlation/idempotency headers, and replays without repeating the side effect. |
| GA-C07 | 2026-08-28 | Every published v1 operation resolves to a named request/response schema; compatibility tests reject unresolved references and the former `JsonValue` fallback. |
| GA-C08 | 2026-08-28 | The versioned support matrix is published and its release, runtime and protocol claims are checked against package, crate, desktop and source metadata by the default test suite. |
| GA-C09 | 2026-08-28 | Control-plane tests prove readiness dependency failure/recovery without error leakage, stale recurring-task detection, bounded request metrics, and authenticated metrics access. |
