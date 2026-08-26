# Stage-three preflight audit

Date: 2026-08-26  
Baseline: `d2699b2` (`feat/v0.2.0-browser-automation`)  
Target: `v0.3.0`

## Baseline verification

The audit was run before stage-three product code was changed.

| Check | Result | Evidence |
| --- | --- | --- |
| React tests | Pass | 3/3 Vitest tests |
| React production build | Pass | TypeScript build and Vite production bundle |
| Rust workspace tests | Pass | 23/23 tests: 18 engine and 5 desktop-shell tests |
| Browser sidecar tests | Pass | 5/5 tests, including a managed Chromium fill/click/extract/diagnostic workflow |
| Desktop packaging | Pass | Release executable, NSIS installer, and MSI installer |
| Packaged executable startup | Pass | Release executable remained alive after five-second startup smoke test and was then stopped |
| npm production dependency audit | Pass | No known production vulnerabilities in the desktop or sidecar lockfiles |
| Rust dependency audit | Not available | `cargo-audit` is not installed; this is a release-pipeline gap |

Packaging outputs:

- `src-tauri/target/release/sandbox-app.exe`
- `src-tauri/target/release/bundle/nsis/Sandbox_0.2.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Sandbox_0.2.0_x64_en-US.msi`

The optimized frontend bundle is 612.08 kB before gzip (191.74 kB gzip), which triggers Vite's chunk-size warning. Stage three should lazy-load ecosystem screens so control-plane features do not slow the local editor.

## Repository state observed during the audit

The shared worktree was initially on the v0.2 feature branch with uncommitted completion work. During the audit another process committed that work as `d2699b2` and switched the worktree to the old `main`. The reflog preserved both operations. Stage-three work was therefore based explicitly on `d2699b2` in `feat/v0.3.0-plugin-ecosystem`; no history was rewritten and `main` was left unchanged.

## Existing architecture

```text
React + xyflow
  | narrow Tauri commands and runner events
  v
Tauri desktop shell
  |-- tray/background scheduling and file watches
  |-- OS credential vault
  |-- OAuth PKCE loopback flow
  |-- managed Playwright sidecar supervisor
  |-- Gmail/Discord/Slack trusted provider adapters
  v
sandbox-engine (independent Rust crate)
  |-- versioned workflow model and migrations
  |-- DAG validation/reference resolution
  |-- local permissions and approval invalidation
  |-- execution/cancellation/redaction
  `-- SQLite repository
```

The core separation remains suitable. The engine does not depend on Tauri, and privileged desktop functions cross a `HostServices` trait. The Playwright sidecar is a trusted, bundled subsystem authenticated with a per-launch token; it is not an extension runtime.

## Migrations and old-workflow compatibility

SQLite migrations are numbered SQL files embedded by the engine and applied in order using `PRAGMA user_version`:

1. Local workflows, executions, settings, and permission audit
2. Schedule state and crash-recovery marker
3. Browser profiles, connection metadata, approvals, browser diagnostics, recorder drafts, templates, Gmail state, and artifact retention
4. General integration polling state

The current database version is 4. Workflow JSON has a separate schema version, currently 2. `decode_workflow` migrates schema-1 workflows to schema 2, adds v0.2 permission defaults through Serde defaults, and writes migrated definitions back without changing workflow identity. The file-backed reopen test proves a v0.1 workflow can be saved, reopened, migrated, and executed. Existing workflows remain personal and local by default; stage three must not add an account or workspace foreign-key requirement to this table.

Migration limitations to correct:

- Migration execution is a hand-written sequence of `if version < n` blocks; stage three should retain numbered immutable SQL while adding an indexed migration registry and transactional application.
- There is no downgrade path, which is acceptable, but pre-migration backup/recovery is not explicit.
- Database schema version and workflow schema version are intentionally independent and must remain so.

## Import and export format

The v0.2 export is a maximum-2-MB JSON envelope with:

- `format: "sandbox-workflow"`
- export format version
- workflow schema version
- product version
- creation timestamp
- workflow definition
- required browser profiles, connections, and permission summary

Import rejects unknown formats, schema 0/future schemas, oversized files, and secret-like keys/values. Imported workflows receive a new ID, are renamed, disabled, and lose all executable approvals. Raw credentials, cookies, tokens, passwords, and webhook URLs are rejected. Required network domains are descriptive only and are not execution approval.

Stage-three compatibility rule: extend this envelope with optional exact plugin requirements and ownership metadata. Old envelopes must continue to import. Marketplace packages must use a separate signed package format; a workflow export is not executable plugin distribution.

## Browser and credential verification

- Browser automation passed the sidecar integration test using managed Chromium. The protocol rejects an incorrect token, negotiates versions, performs browser actions, and returns locator failure evidence.
- The release package includes the sidecar runtime and Chromium resources and the packaged executable starts successfully.
- On this Windows host, Cargo resolves `keyring` 4.1.6 to `windows-native-keyring-store`; secrets are serialized into a zeroizing buffer and metadata remains in SQLite.
- Vault tests cover identifier traversal/format rejection and the 64-KB bound before OS-store access.
- A destructive real-credential round trip is deliberately not part of the current automated suite. CI still needs platform-specific temporary-entry integration tests for Windows Credential Manager, macOS Keychain, and Linux Secret Service. Only Windows was executable in this audit environment.

## Approval invalidation

The persistence boundary, not the UI, compares canonical fingerprints whenever a workflow is saved:

- command executable/configuration changes revoke command execution and clear its approval revision;
- browser node type/configuration changes revoke browser automation;
- Gmail/Discord/Slack communication node type/configuration changes revoke external communication and clear its approval revision;
- new workflows containing these risky nodes start unapproved;
- imported workflows reset approvals.

The behavior is implemented in Rust and therefore cannot be bypassed by hiding or modifying controls. There are no focused regression tests for all three fingerprint families, which is a stage-three prerequisite because plugin permission expansion will reuse the same security boundary.

## Current extension points

Intended or usable seams are:

1. `WorkflowNode.type` is already a stable string and each node has a numeric version.
2. Node configuration and recorded outputs use structured JSON.
3. `HostServices` isolates trusted browser/provider/notification functions from the engine.
4. Engine events provide a stable diagnostics stream to the desktop.
5. SQLite uses append-only numbered migrations.
6. The editor node catalogue centralizes presentation metadata and default configuration.
7. Workflow imports already carry required resource summaries.
8. Connections store only metadata in SQLite and resolve secrets by opaque credential ID through the OS vault.
9. Browser profiles are referenced by ID rather than exposing profile contents to workflows.

None is yet a public plugin API.

## Architecture blockers and required narrow changes

### 1. Closed node dispatch

Validation, execution, and the React catalogue use hard-coded node lists/matches. Adding third-party node types directly to those lists would make every plugin a host release and would not provide version pinning.

Required change: introduce a plugin registry resolved by `(pluginId, pluginVersion, nodeType, nodeVersion)`. Keep built-in nodes on their current path. Unknown plugin nodes remain visible but non-executable with a repair diagnostic.

### 2. Trusted host boundary is too broad for plugins

`HostServices` exposes trusted application operations and provider adapters. Giving plugin code this trait would leak authority.

Required change: add a separate capability broker whose call context contains immutable plugin, publisher, owner/workspace, execution, approved-capability, network, credential-operation, quota, and cancellation data. The broker must reject requests independently of UI state.

### 3. No sandbox runtime

There is no WebAssembly runtime today. Unrestricted JavaScript or native-library loading is not an acceptable fallback.

Selected direction: Wasmtime core/component execution without linking general WASI. Wasmtime keeps WASI in a separate crate, so omitting it leaves filesystem, process, environment, and socket imports unavailable. Store resource limits, fuel, and epoch/async interruption provide enforceable memory, CPU, and timeout controls. Only explicitly linked host functions will exist. If an implementation test demonstrates ambient access or unenforced limits, plugin execution must remain disabled and the blocker documented.

### 4. No package trust root or publisher model

The application has no package signature, publisher key, immutable-version, or revocation store.

Required change: deterministic archive validation plus SHA-256 integrity and Ed25519 signatures, installed-package immutability, exact workflow pins, cached revocation metadata, and explicit update permission diffs. Trust decisions must be local and testable without the cloud.

### 5. No ownership/tenant model

All persisted resources are implicitly local. Adding nullable owner columns to existing tables would risk accidental inference and tenant bugs.

Required change: retain current tables as explicitly personal-local objects and add separate owner/workspace records and mappings. Every cloud/control-plane resource must carry an explicit owner type and ID. API authorization must evaluate permissions and resource ownership server-side.

### 6. No control-plane boundary

There is no web or service workspace. Next.js page handlers alone would conflate UI, authorization, marketplace, billing, runner, and webhook logic.

Required change: add a workspace with a thin Next.js control surface, a TypeScript API service, shared contracts, PostgreSQL migrations, object-storage/queue interfaces, and provider adapters. Local workflow execution remains exclusively in the desktop runner.

### 7. Test and release gaps

- No Rust advisory scanner is installed.
- Approval fingerprint families lack direct tests.
- Vault integration is not exercised against all supported platform stores.
- Tray/file-watch behavior is unit-tested at scheduling seams but not end-to-end.
- No tenant-isolation, package-tampering, revocation, or command-signature tests exist because those systems do not yet exist.

These are additive test gaps, not reasons to rewrite the engine, editor, or browser sidecar.

## Decision

No v0.1/v0.2 subsystem requires replacement. Stage three can proceed with additive crates/packages and narrow registry/broker seams. The security gate is the Wasmtime proof: plugin execution will only be enabled after tests demonstrate missing ambient filesystem/process/socket imports, resource limits, host-mediated network enforcement, signature verification, storage isolation, and version pinning.
