# sndbox v0.5 architecture

Status: GA candidate under active development. The blocker register, not this diagram, determines release readiness.

```text
  Local-first desktop                         Organisation control plane
  +-------------------------+                 +----------------------------------+
  | React workflow editor   |   optional      | OIDC session / scoped token      |
  | Tauri command boundary  |<--------------->| principal + authorisation        |
  | SQLite + Rust engine    | encrypted sync  | API + audit + policy             |
  | local scheduler/tray    |                 | PostgreSQL RLS                    |
  | OS credential vault     |                 +----------+------------+----------+
  | loopback site servers   |                            |            |
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
- `runner_commands.authorization_context` persists the signed principal, required permission, environment and credential restrictions used at command issuance. Legacy queued commands are expired by migration rather than delivered without this context, and credential revocation expires its queued, delivered, or accepted commands.
- `@sandbox/api-client` implements the stable v1 transport contract with bounded idempotent retries and optional runtime response validation.

## Security boundaries

1. The web view never executes privileged nodes directly.
2. Local execution stays in the independent Rust engine and remains account-free.
3. Organisation API checks are server-side; UI visibility is not an access control.
4. Credential scope and restrictions narrow RBAC and never expand it.
5. Service-account tokens cannot create personal tokens or obtain interactive sessions.
6. Runner commands and events require device authentication. Desktop and self-hosted agents verify the signed action-to-permission mapping, immutable environment identity, credential scopes/restrictions and service-account role again before accepting work. Managed orchestrator enforcement and the remaining resource/action audit still gate GA-011.
7. Meter input accepts only managed billable deployment types. Local execution cannot enter hosted-runner or managed-browser billing meters. Managed workers sign payload-bound usage events with independently configured HMAC producer keys; the control plane enforces a five-minute freshness window and verifies the execution, deployment, workspace and environment relationship before inserting them.
8. Invoice inputs include only usage whose latest immutable reconciliation is `matched`. A discrepancy removes the execution from invoice aggregation until a later reconciliation resolves it, and every aggregate carries a digest of its event and reconciliation evidence.
9. Plugin Wasm remains outside browser, process, filesystem, socket and environment authority except through the existing capability broker.
10. AI provider keys stay in the OS credential vault. The host sends prompts and the relevant graph or code context to the selected OpenAI, Anthropic, or OpenAI-compatible endpoint; remote compatible endpoints require HTTPS, while HTTP is limited to loopback hosts.
11. Code source mode is data-only. Python and JavaScript run mode crosses the same revision-bound command-execution gate as Run Command, invokes an explicit interpreter without shell concatenation, bounds output, supports cancellation/timeouts, and removes its temporary script.
12. Web Builder binds generated sites only to `127.0.0.1`. A workflow/node key owns each server, so rerunning it aborts and replaces the prior listener; application shutdown drops the local engine and its listeners.

## Unfinished joins

The self-hosted agent polls and executes signed command payloads, but the packaged Linux lifecycle still needs an end-to-end control-plane exercise. Hosted and managed-browser processes now report signed usage into the ledger, while invoice export remains gated on matched reconciliation; production producer-key rollout and invoice-system reconciliation still need operational evidence. SSO/SCIM and event export follow later in the ordered v0.5 plan. These are blockers or planned foundations, not placeholder product claims.
