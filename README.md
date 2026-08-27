# Sandbox v0.3.0

Sandbox is a local-first visual desktop automation platform. v0.3 adds a capability-controlled WebAssembly plugin ecosystem, signed packages and exact workflow pins, optional encrypted sync, marketplace and publisher services, team workspaces, governed workflow publication, shared-connection deployment, and signed coordination of multiple local runners. Workflow execution remains local and existing personal workflows continue without an account or network connection.

## Architecture

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

## Stage-three documentation

- Architecture and service boundaries: `docs/architecture-v0.3.md`
- Plugin sandbox and threat model: `docs/plugin-sandbox.md`, `docs/plugin-threat-model.md`
- Public SDK and CLI: `docs/plugin-sdk.md`
- Marketplace review: `docs/marketplace-review.md`
- Baseline compatibility audit: `docs/stage-three-audit.md`
