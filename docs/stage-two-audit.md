# Stage-two preflight audit

Date: 2026-08-26

## Verification performed

- `cargo test --workspace --no-fail-fast`: 16 engine tests passed.
- `npm.cmd run desktop:build`: frontend compilation, optimized Rust build, NSIS bundle, and MSI bundle passed.
- The packaged executable starts, creates/opens `sandbox.db`, and remains alive as the tray runner when the main window is hidden.
- Database migrations are numbered and embedded. Database schema version is 2; workflow JSON schema version is 1.
- Existing workflow JSON is read without mutation and node configuration is untyped JSON, so v0.1 nodes can remain executable while v0.2 node types are added.
- The React renderer uses a narrow Tauri command/event API. Privileged execution remains in Rust. The engine crate has no Tauri dependency.
- Schedule polling runs in the Tauri runner every 15 seconds. File watchers are rebuilt every 30 seconds. Both require enabled workflows and approved background execution.
- Crash recovery converts queued/running records into failed records with a specific restart diagnostic.

## Incomplete or simulated behavior found

- `src/previewApi.ts` simulates workflow execution only for browser-based UI QA. Installed builds always use Tauri commands and the Rust engine; no production execution path uses the preview adapter.
- The `test:rust` package script targets only the Tauri package, so it does not run the engine workspace tests.
- The persistence test uses an in-memory database and therefore does not prove reopen/restart persistence.
- Tray scheduling and file watching have no integration-level regression test even though the production code path is present.
- The cancellation map is keyed only by workflow ID. A skipped overlapping background run can replace and then remove the cancellation token for the still-active run.
- The current permission fingerprint invalidates only Run Command approval. Stage two needs version-bound approval invalidation for communication and expanded permissions.
- Data mapping is safe but path-oriented; the editor does not yet expose typed prior outputs.

## Blocking corrections before v0.2 architecture work

1. Make `test:rust` run the complete Cargo workspace.
2. Add a file-backed reopen test proving v0.1 workflows survive restart.
3. Add a deterministic scheduler tick test and fix cancellation ownership so overlapping triggers cannot orphan the active token.

No stage-one subsystem requires a rewrite. Browser automation can be added through a new host-service boundary and supervised sidecar while preserving Rust as the authoritative orchestrator.
