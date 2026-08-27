# Stage-four preflight audit

Date: 2026-08-27  
Baseline: `d08a157` (`v0.3.0`)  
Target: `v0.4.0`

## Scope and repository state

The audit was completed before stage-four product code was added. The local checkout initially pointed at the v0.1 baseline while the fetched `origin/main` contained the completed v0.2 and v0.3 history. The tracked worktree was clean; only ignored browser and web build artifacts existed. The checkout was fast-forwarded to `d08a157` and stage-four work was placed on `feat/v0.4.0-always-on-runners`. No history was rewritten and no user changes were discarded.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Complete JavaScript/Rust suite | Pass | React 4/4, browser sidecar 5/5, Rust workspace 47/47, control plane 29/29 |
| Desktop frontend build | Pass | Vite production bundle generated; existing 635 kB chunk warning remains |
| Web build | Pass | Next.js production build generated all marketplace routes |
| Control-plane build | Pass | Contracts and control-plane TypeScript builds completed |
| Desktop application package | Pass | Release executable, NSIS installer and MSI installer generated |
| Packaged executable smoke test | Pass | Release executable remained alive for a five-second startup window |
| Disposable control-plane deployment | Pass | PostgreSQL 16 container, 11 migrations, built API startup, HTTP 200 health response |
| Migration repeatability | Pass | Second migration run applied nothing; 11 checksummed versions recorded |
| Local workflows without cloud | Pass | Local engine/persistence/manual-run tests pass with no account or control-plane service |
| Workflow sync and conflicts | Pass | Encrypted payload round-trip/tamper tests and conflict-fork tests preserve both revisions |
| Plugin sandbox isolation | Pass | Missing ambient filesystem/process/socket/environment imports plus memory, fuel, timeout, cancellation, broker and storage-isolation tests |
| Signed runner commands | Pass | Ed25519 canonical signing, mutation rejection, expiry, target and durable replay/idempotency checks |
| Tenant isolation | Pass | Authorization unit tests plus live PostgreSQL RLS checks for two accounts, workspaces and environments |
| Team permissions | Pass | Explicit permission checks reject cross-workspace permission carry-over and protect mutation routes |
| Marketplace entitlement handling | Pass | Signed offline entitlement claim and paid-install ownership/active-grace enforcement tests |
| Webhook queue and deduplication | Pass | Signature/replay/size/schema tests plus unique endpoint nonce/idempotency constraints and bounded delivery states |
| npm production dependency audit | Pass | Root workspaces and browser sidecar report zero known production vulnerabilities |
| Rust advisory audit | Blocked | `cargo-audit` is not installed on this host; CI must retain this release gate |

Generated baseline artifacts:

- `src-tauri/target/release/sandbox-app.exe`
- `src-tauri/target/release/bundle/nsis/Sandbox_0.3.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Sandbox_0.3.0_x64_en-US.msi`

The disposable PostgreSQL container and audit-only credentials were removed after verification.

## Existing boundaries retained

- Personal workflows, schedules, detailed logs, browser profiles and credentials remain local by default.
- The Rust engine remains independent of Tauri and is the only workflow-semantics implementation.
- Browser automation remains a trusted authenticated sidecar; marketplace plugins do not receive its protocol.
- Plugins execute in Wasmtime without general WASI and receive authority only through the capability broker.
- The control plane owns identity, tenant metadata, encrypted sync, marketplace, entitlements, runner coordination and webhook relay, but does not execute v0.3 workflow nodes.
- PostgreSQL repository operations set `app.account_id` transaction-locally; API authorization checks explicit permissions before repository access. RLS is defence in depth.
- Account tokens, runner private keys and provider secrets are not persisted in workflow JSON or ordinary SQLite metadata.

## Stage-four blockers discovered

1. Runner protocol v1 coordinates signed one-shot desktop commands but has no common registration/heartbeat/capability/lease/checkpoint/event model for hosted and self-hosted workloads.
2. Cloud-coordinated run summaries are mutable summaries, not an append-only execution state machine. There is no explicit uncertain-side-effect state or recovery decision.
3. There is no workflow deployment entity. Publishing and runner command creation are not yet separated by a validated deployment snapshot.
4. Environments currently allow only development and production; staging and target-specific mappings are absent.
5. The webhook relay has a durable PostgreSQL queue, but schedules and general execution events have no shared durable queue/dead-letter/replay abstraction.
6. The desktop background client is not wired through the full v0.3 pairing, heartbeat and command-delivery lifecycle.
7. There is no workload-isolation deployment configuration, hosted runner, managed browser worker, self-hosted runner packaging, ARM64 build or runner pool scheduler.
8. Central logs, artifacts, alerts, usage ledger, spending limits, regional routing and tested backups do not yet exist.
9. Production adapters are configuration-complete but cannot be integration-tested on this host without real OIDC, email, storage, scanner and Stripe test tenants.
10. Full webhook JSON Schema validation and cross-platform OS-vault integration remain prior-stage release gaps. Neither requires a rewrite of the engine or control plane.

## Decision

Stages one through three are a sound additive baseline. No previous subsystem needs replacement. Stage four should first extend the shared contracts and PostgreSQL model with a versioned runner protocol and durable execution state, then reuse the existing Rust engine inside isolated runner hosts. Hosted execution must remain opt-in and must never add account, deployment or billing requirements to personal local execution.

