# Sandbox v0.6.0 development baseline

Sandbox is a local-first visual desktop automation platform. This checkout combines the v0.5 general-availability control plane, runners, public API, security and operational controls with independent marketing, account and documentation applications for the v0.6 public-product architecture.

## Public web development

```powershell
npm.cmd run marketing:dev  # http://localhost:3100
npm.cmd run web:dev        # account application
npm.cmd run docs:dev       # http://localhost:3200
```

See `docs/v0.6-public-architecture.md` and `docs/v0.6-launch-readiness.md` for routing, design, release, support, SEO, accessibility, deployment and migration details.

## Architecture

The current cross-component architecture and security boundaries are documented in
`docs/architecture-v0.5.md`.

```text
React + xyflow
  │ validated Tauri commands / runner events
  ▼
Tauri desktop shell ── tray + background services + OS dialogs/notifications
  │
  ▼
sandbox-engine (independent Rust crate)
  ├── versioned workflow/execution schemas
  ├── DAG validation and dependency ordering
  ├── safe reference/template resolver
  ├── permission enforcement and redaction
  ├── async node executor and cancellation
  ├── schedule calculation
  └── SQLite repository + numbered migrations
```

The React application never performs privileged workflow execution. `sandbox-engine` has no Tauri or web-view dependency and can move into a separately installed runner later. Host-only capabilities, such as native notifications, cross the `HostServices` trait.

## Development

Prerequisites: Node.js 20+, Rust stable, the Tauri 2 platform prerequisites, and WebView2 on Windows.

```powershell
npm.cmd install
npm.cmd run desktop:dev
```

The web-only preview (`npm.cmd run dev`) uses a local preview adapter so the interface can be inspected in a browser. Installed desktop builds always use the Rust command API and SQLite.

## Tests and builds

```powershell
npm.cmd run build
npm.cmd run test:rust
cargo check --manifest-path src-tauri/Cargo.toml
npm.cmd run desktop:build
```

Rust tests cover validation, cycles, ordering, true/false branches, failed dependency propagation, cancellation, timeouts, references, redaction, path permissions, schedule calculation, SQLite persistence, migrations, restart recovery, and the full manual-trigger-to-notification workflow.

## Data and security

- SQLite data is stored in the operating system application-data directory.
- Migrations are embedded from `src-tauri/engine/migrations` and applied by `PRAGMA user_version`.
- File access is restricted to approved roots; HTTP access is restricted to approved domains.
- Authorization, cookies, API keys, tokens, secrets, and passwords are redacted recursively.
- Node outputs are limited to 1 MB, logs to 8 KiB per line / 100 lines, and command stdout/stderr to 64 KiB each.
- Run Command uses an executable plus argument array, never a concatenated shell string. Editing a command revokes its automatic-execution approval.
- Closing the main window hides it. Tray Quit stops all local schedules and file watches.

## Stage-one limitations

- The runner lives in the Tauri process rather than a separately installed service, so full application quit stops automation.
- Schedule times are interpreted in UTC in this first runner implementation.
- File watchers are refreshed on a 30-second interval and watch one folder level.
- Run history retention is manual; automatic retention policies are deferred.
- Credential references are defined in the schema, but there is no credential vault or OAuth provider yet.
- Workflows are DAGs only; loops and arbitrary expression execution are intentionally unsupported.

## GA candidate documentation

- Current architecture and security boundaries: `docs/architecture-v0.5.md`
- Authoritative release blocker register: `docs/ga-blockers-v0.5.md`
- Stable API, idempotency, rate-limit and deprecation policy: `docs/api-policy-v0.5.md`
- Managed usage ingestion and invoice reconciliation: `docs/usage-metering-v0.5.md`
- Control-plane readiness, metrics and remaining production exercises: `docs/reliability-v0.5.md`
- Incident lifecycle, recovery exercise and post-incident evidence: `docs/incident-response-v0.5.md`
- Customer-approved support access and redacted diagnostics: `docs/support-access-v0.5.md`
- Privacy classification, export, deletion and enforceable retention: `docs/privacy-and-retention-v0.5.md`
- WCAG 2.2 AA review and non-dragging graph editor: `docs/accessibility-v0.5.md`
- Signed release artifacts, provenance and verification: `docs/release-integrity-v0.5.md`
- Desktop startup bundle measurements and regression budgets: `docs/frontend-performance-v0.5.md`
- Machine-readable v1 route contract: `docs/api/openapi-v1.json`
- Typed browser/Node control-plane client: `packages/api-client`
- Stage-five baseline audit: `docs/stage-five-audit.md`

## Historical stage-three documentation

- Architecture and service boundaries: `docs/architecture-v0.3.md`
- Plugin sandbox and threat model: `docs/plugin-sandbox.md`, `docs/plugin-threat-model.md`
- Public SDK and CLI: `docs/plugin-sdk.md`
- Marketplace review: `docs/marketplace-review.md`
- Baseline compatibility audit: `docs/stage-three-audit.md`
- v0.5 compatibility and support matrix: `docs/support-matrix-v0.5.md`
- Team permissions and publication: `docs/team-permissions.md`
- Runner pairing and command protocol: `docs/runner-protocol.md`
- Sync and conflict handling: `docs/sync-and-conflicts.md`
- v0.2 migration notes: `docs/migration-v0.2-to-v0.3.md`
- Operations and release commands: `docs/operations-v0.3.md`
- Security findings and open blockers: `docs/security-review-v0.3.md`, `docs/known-limitations-v0.3.md`
