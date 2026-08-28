# v0.5.0 GA baseline audit

Date: 2026-08-27  
Baseline: `a5ccc8f` (merged `v0.4.0`)  
Audit branch: `feat/v0.5.0-general-availability`

## Decision

The repository is a useful v0.4 engineering baseline, but it is **not a GA-ready v0.4 release and must not be represented as one**. Local execution, plugin isolation, durable execution state, scheduling primitives, managed-browser isolation primitives and runner identity are real. Several stage-four claims are not yet joined into a production-operable system: the self-hosted agent only pairs and sends heartbeats, usage metering is absent, production backup provenance is unavailable, and production adapters have not been exercised together.

Stage-five work may proceed only on blocker remediation and the ordered foundations (authorisation, non-human identity and API contracts). Enterprise identity and optional administration surfaces remain behind those gates.

## Repository and release integrity

- The tracked worktree was clean at audit start.
- Local `main` initially reported the stage-three merge, then resolved to the already-fetched `origin/main` stage-four merge `a5ccc8f`; no history was rewritten.
- No `AGENTS.md` repository instructions are present.
- Most root, desktop, control-plane, web, contracts and plugin packages still declare `0.3.0`; only the new scheduler, browser worker, hosted runner and server agent declare `0.4.0`. This prevents an honest v0.4 compatibility statement.
- The root `test:all` script omitted stage-four scheduler, browser-worker, hosted-runner and self-hosted-agent suites. The audit branch corrects this test-discovery gap.

## Verification evidence

| Area | Result | Evidence and limitation |
| --- | --- | --- |
| Desktop React tests | Pass | 4/4 |
| Browser sidecar tests | Pass | 5/5, including authenticated protocol and managed-browser action flow |
| Desktop Rust workspace | Pass | 47/47 across application, engine, plugin runtime and example plugins |
| Contracts and plugin SDK | Pass | 4/4 and 4/4 |
| Control plane | Pass | 44/44 with PostgreSQL integration enabled |
| Scheduler | Pass | 5/5 with PostgreSQL integration enabled; duplicate claim, dead letter and replay covered |
| Managed browser worker | Pass | 17/17, including separate contexts and destruction |
| Hosted runner | Pass | 3/3; same engine executes a safe workflow and fail-closed capability checks pass |
| Self-hosted agent | Partial | 3/3 configuration/identity/signing tests pass; the service does not poll or execute commands |
| Frontend and web production builds | Pass | Vite and Next.js builds complete; the existing approximately 635 kB frontend chunk warning remains |
| TypeScript service builds | Pass | Contracts, control plane, scheduler, browser worker and plugin SDK compile |
| Rust runner release builds | Pass | Hosted runner and server agent compile in release mode |
| PostgreSQL migrations | Pass | 16/16 applied; a second run applies nothing and preserves checksums |
| Backup format restore | Pass with limitation | A fresh staging logical backup restored into an isolated database with 16 migration records, 64 public tables and 45 public functions. This is not evidence for the latest production backup. |
| npm production advisory audit | Pass | Zero known production vulnerabilities reported |
| Rust advisory audit | Pass with warnings | No known vulnerabilities in desktop, hosted-runner or agent lockfiles. The desktop graph reports 18 maintenance/unsound/yanked warnings requiring release disposition. |

Build and container results are recorded in the GA blocker register when a host or infrastructure dependency prevents completion.

## Required stage-one-to-four demonstrations

| Demonstration | Result | Finding |
| --- | --- | --- |
| Local workflow | Pass | Rust vertical-slice and recovery tests execute without an account or control plane |
| Hosted workflow | Pass at component level | The hosted runner imports and executes the production engine; orchestration/infrastructure isolation is not exercised end to end |
| Browser workflow | Pass at component level | Sidecar and managed-worker lifecycle tests execute real Chromium contexts |
| Self-hosted workflow | Fail | `sandbox-runner run` sends heartbeats only; it never polls `/v1/runner/commands` or invokes the workflow engine |
| Marketplace isolation | Pass at component level | No-WASI, broker permission, quota, owner isolation, signing, tamper and revocation tests pass |
| Workflow permission enforcement | Partial | API route checks exist, but permission vocabulary is inconsistent and there is no service-account/token/environment restriction layer yet |
| Tenant isolation | Pass for covered schema | Live PostgreSQL RLS and application checks pass; every new v0.5 table still requires adversarial tests |
| Runner lease recovery | Pass at state-machine level | Lease loss and unsafe-side-effect review decisions are tested; regional orchestrator recovery is not exercised |
| Metered usage reconciliation | Fail | No immutable hosted-usage ledger or reconciliation job exists despite the architecture document naming one |
| Latest backup restore | Blocked | No production backup location, manifest, encryption key procedure or provenance is available in this checkout |

## Security, support and operational review

The repository contains useful v0.3/v0.4 threat models, but no current external penetration-test report, finding tracker, support-issue register, on-call system, incident exercise, status-page integration or production access review. Production dependencies for OIDC, email, object storage, scanning and Stripe are configuration-complete adapters but were not available to this audit. The application health route does not verify dependency readiness.

No critical placeholder UI was found by the source scan. `src/previewApi.ts` intentionally simulates browser-only UI preview and is excluded from installed desktop execution. The material simulated or incomplete production behaviours are recorded as blockers rather than presented as features.

## Audit environment cleanup

The PostgreSQL audit container is disposable and contains audit-only credentials. Remove it after evidence collection. Audit-only container images must not be published or treated as signed release artifacts.
