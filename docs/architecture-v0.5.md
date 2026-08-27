# Sandbox v0.5 architecture

Status: GA candidate under active development. The blocker register, not this diagram, determines release readiness.

```text
  Local-first desktop                         Organisation control plane
  +-------------------------+                 +----------------------------------+
  | React workflow editor   |   optional      | OIDC session / scoped token      |
  | Tauri command boundary  |<--------------->| principal + authorisation        |
  | SQLite + Rust engine    | encrypted sync  | API + audit + policy             |
  | local scheduler/tray    |                 | PostgreSQL RLS                    |
  | OS credential vault     |                 +----------+------------+----------+
  +------------+------------+                            |            |
               | local execution                         | leases     | events
               v                                         v            v
  +-------------------------+                 +----------------+ +----------------+
  | Managed Chromium       |                 | hosted runner  | | scheduler /    |
  | authenticated sidecar  |                 | same Rust      | | durable queue  |
  +-------------------------+                 | engine         | +----------------+
                                              +-------+--------+
                                                      |
                           +--------------------------+-------------------------+
                           |                          |                         |
                           v                          v                         v
                 +------------------+       +------------------+      +------------------+
                 | managed browser  |       | self-hosted      |      | immutable usage  |
                 | worker           |       | agent            |      | ledger + reconcile|
                 +------------------+       +------------------+      +------------------+
```

## Identity and authorisation path

```text
OIDC JWT ----------------------+ 
                              +--> authenticated principal
sbx_pat / sbx_sa token --------+       |
  prefix lookup                        +--> credential scope/restrictions
  HMAC verification                    +--> principal role permissions
  expiry/revocation                    +--> workspace RBAC
                                      +--> resource/environment policy
                                      +--> PostgreSQL RLS
                                      +--> runner-boundary policy (required gate)
```

Local personal workflows bypass organisation identity because they do not use organisation resources. A service account is represented by a non-interactive principal account so existing workspace RLS can evaluate its assigned role without impersonating a human owner. Human ownership is a governance relationship, not execution identity.

## Current v0.5 persistence additions

- `usage_events` is immutable, payload-bound by idempotency hash and limited to billable managed targets.
- `usage_reconciliations` is append-only and records expected, actual and discrepant quantities.
- `service_accounts` references a non-interactive principal and requires at least one human owner.
- `service_account_role_assignments` bounds workspaces, roles and environments.
- `access_tokens` stores prefix, HMAC digest, scope, restrictions, expiry, last use and revocation metadata; plaintext is never persisted.
- `api_idempotency_records` binds caller, key and canonical request hash, and stores the replay response encrypted for 24 hours.

## Security boundaries

1. The web view never executes privileged nodes directly.
2. Local execution stays in the independent Rust engine and remains account-free.
3. Organisation API checks are server-side; UI visibility is not an access control.
4. Credential scope and restrictions narrow RBAC and never expand it.
5. Service-account tokens cannot create personal tokens or obtain interactive sessions.
6. Runner commands and events require device authentication. Environment and permission enforcement at the execution boundary remains a GA blocker until every runner class applies the consolidated policy.
7. Meter input accepts only managed billable deployment types. Local execution cannot enter hosted-runner or managed-browser billing meters.
8. Plugin Wasm remains outside browser, process, filesystem, socket and environment authority except through the existing capability broker.

## Unfinished joins

The self-hosted agent currently heartbeats but does not execute command payloads. Trusted orchestrator producers are not yet wired to the usage ledger. The v1 API now has transport-level compatibility, idempotency and OpenAPI route contracts, but complete resource schemas remain unfinished. SSO/SCIM and event export follow later in the ordered v0.5 plan. These are blockers or planned foundations, not placeholder product claims.
