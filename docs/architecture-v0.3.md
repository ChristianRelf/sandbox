# Sandbox v0.3 architecture

## System boundary

Sandbox remains a local workflow executor. The control plane coordinates identity, ownership, distribution, sync, commands, and summaries; it never runs workflow nodes.

```text
                                      CONTROL PLANE
  +------------------+       +---------------------+       +-------------------+
  | Next.js web app  |------>| TypeScript API     |------>| PostgreSQL        |
  | account/admin/   | HTTPS | authz + domain     |       | tenant data       |
  | marketplace UI  |       | services           |       | audit + metadata  |
  +------------------+       +----+----+----+------+       +-------------------+
                                  |    |    |
                         signed URL|    |    |durable command/event jobs
                                  v    |    v
                           Object store|  Queue/relay
                           immutable   |  idempotent + expiring
                           packages    |
                                       | authenticated WebSocket presence
                                       v
  +--------------------------------------------------------------------------------+
  |                              LOCAL DESKTOP RUNNER                              |
  | React editor -> narrow Tauri API -> Rust engine -> built-ins                   |
  |                                      |                                         |
  |                                      +-> verified plugin registry              |
  |                                          -> Wasmtime (no general WASI)          |
  |                                          -> capability broker                  |
  |                                             -> allowlisted HTTP/provider calls  |
  |                                             -> isolated plugin storage          |
  |                                                                                |
  | SQLite: local workflows, pins, metadata, command receipts, sync cache           |
  | OS vault: account refresh token, device private key, OAuth/provider secrets     |
  | Local disk: browser profiles, encrypted/signed plugin packages, detailed logs   |
  +--------------------------------------------------------------------------------+
```

When every eligible runner is offline, the API may retain an encrypted, expiring, idempotent command. The workflow is shown as waiting or expired. It does not execute in the control plane.

## Repository boundaries

```text
apps/web/                    thin Next.js control surface
packages/contracts/         versioned API/domain contracts
packages/plugin-sdk/        public SDK and `sandbox plugin` CLI
services/control-plane/     API, authorization, marketplace, runner and relay services
services/control-plane/db/  append-only PostgreSQL migrations
examples/plugins/           SDK examples built for the production sandbox
src/                        existing desktop React application
src-tauri/                  existing Tauri shell
src-tauri/engine/           existing local workflow engine
src-tauri/plugin-runtime/   manifest, package trust, sandbox and capability broker
browser-sidecar/            existing trusted managed-browser sidecar
```

The web app calls the API service. It does not import database, billing, runner-command, webhook-delivery, or authorization implementations.

## Ownership model

Every shareable resource carries an immutable ownership tuple:

```text
ownerType: personal | workspace | organisation | publisher
ownerId: UUID
```

Personal local workflows remain explicit `personal-local` resources until the user opts into sync or moves/copies them to a workspace. Ownership is never inferred from the most recent editor. Moving an object creates an audited operation and re-evaluates connections, plugins, runner compatibility, and governance.

## Authorization model

Role names are bundles of explicit permissions. API handlers ask the authorization service for a permission against a concrete resource and owner; they do not compare role-name strings.

```text
request
  -> verify session/JWT and freshness
  -> load organisation membership
  -> resolve resource owner
  -> evaluate explicit permission + governance policy
  -> transact domain mutation and append audit event
```

Tenant identifiers supplied by a client are selectors only. Every database query is constrained by the authorized owner/workspace resolved from membership. PostgreSQL row-level security is defence in depth, not the sole authorization mechanism.

## Desktop authentication

Authentication is optional. Sandbox offers Continue locally, Sign in, and Create account.

1. Desktop creates a PKCE verifier/challenge and high-entropy state.
2. Desktop binds an ephemeral loopback callback and opens the system browser.
3. The browser uses the control plane/identity provider for email verification, passkeys, MFA, and recovery.
4. Desktop validates state, exchanges the short-lived code, and validates issuer/audience/nonce.
5. Refresh token and device private key are stored in the OS credential store.
6. SQLite stores only non-secret account/session metadata.
7. Refresh-token rotation and server-side session revocation are required.

Closing or signing out of the account does not disable already-authorised local workflows. Cloud-only operations report that sign-in or connectivity is required.

## Workflow sync

Workflow graph payloads are encrypted separately from account authentication using a per-user/workspace sync key envelope. The service stores ciphertext plus limited metadata: workflow ID, revision ID, parent, schema version, hash, editor device, timestamps, plugin requirements, and sync state.

The initial design is service-readable envelope encryption unless and until keys are held exclusively by clients. Documentation must not call this end-to-end encryption. Secrets, browser data, raw paths, detailed logs, and screenshots remain local by default.

Conflicts are revision forks:

```text
                 revision A
                /          \
        local revision B   remote revision C
                \          /
                 explicit user choice
                 keep B | keep C | copy/merge draft
```

Neither branch is overwritten or automatically graph-merged.

## Plugin execution and trust

Workflow plugin nodes pin all of:

- plugin ID
- publisher ID
- plugin semantic version
- package integrity digest
- stable node type
- node version

The installed registry resolves the exact tuple. A newer package is only a candidate update. The current pin remains active until migration/compatibility approval updates a draft workflow revision.

Packages are deterministic archives with a canonical manifest/content digest and Ed25519 publisher signature. The desktop verifies trust, compatibility, integrity, revocation, entrypoints, and declared content before copying the immutable package into the local store. Installation never instantiates WebAssembly. Packages start disabled.

The runtime links only `sandbox_v1::host_call`; it does not link `wasmtime-wasi`. Files, processes, environment variables, sockets, database handles, raw credentials, browser directories, desktop IPC, and other plugin memories therefore have no ambient import. The broker re-authorizes each call against the immutable execution context.

## Runner protocol

Each paired runner owns an Ed25519 device key. The OS vault holds the private key and the server registers only its public key. Commands use canonical signed envelopes containing command ID, issuer, workspace, target runner, action, workflow revision, creation/expiry, and idempotency key.

The local runner verifies signature, target, clock window, command receipt, workflow approval, installed pins, connections, local permissions, environment, and compatibility. A unique idempotency constraint is written before execution. Server authorization cannot override a local denial.

## Outage behavior

- Local workflows, schedules, file triggers, browser automation, and already-authorised plugins continue without an account or network.
- Sync, purchases, remote commands, webhook relay, and new revocation metadata pause with explicit status.
- Signed marketplace metadata, publisher keys, entitlements, and revocations have bounded cache ages.
- Paid plugins use signed entitlement claims with a documented seven-day offline grace period by default.
- Emergency revocation cached by an online runner blocks new executions for the exact package only. Running instances are cancelled only for critical revocations and never cause workflow/plugin-data deletion.

## Service responsibilities

| Service | Owns | Does not own |
| --- | --- | --- |
| Identity adapter | browser auth, verification, passkeys/MFA/recovery, session lifecycle | workflows or execution |
| Authorisation | memberships, roles, explicit permissions, ownership checks, policies | UI visibility |
| Sync | encrypted revisions, conflicts, version history | credentials or automatic graph merges |
| Marketplace | listings, review objects, immutable versions, ratings eligibility, revocations | executing plugins |
| Billing | Stripe customer/Connect references, entitlements, refunds, signed offline claims | card data |
| Runner coordination | pairing, presence, compatibility, expiring commands, summaries | hosted execution |
| Webhook relay | signed endpoints, validation, encrypted bounded queues, delivery state | indefinite payload retention |
| Audit | append-only redacted security/business events | secret or full workflow payload storage |

## Release gates

The marketplace UI remains behind the following gates:

1. sandbox denial/resource tests pass;
2. tamper/signature/revocation tests pass;
3. free installation is disabled-first and version-pinned;
4. permission expansion is diffed and approval-gated;
5. tenant-isolation tests pass before team workflow sharing;
6. paid entitlements are added only after the free lifecycle is proven.
