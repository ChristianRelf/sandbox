# v0.3 security review findings

## Confirmed controls

- Wasmtime is linked without general WASI; ambient filesystem, process, environment and socket imports are absent.
- Runtime tests enforce memory, fuel, timeout and cancellation limits.
- Plugin packages use deterministic content hashing and Ed25519 publisher signatures; tampering and exact-version revocation block execution.
- Host-mediated HTTP rechecks method, destination and redirect targets and never exposes raw credential material.
- Plugin storage is isolated by publisher/plugin/owner/workspace/major version and quota.
- Workspace API routes authenticate identity, check explicit permissions and constrain resource ownership; PostgreSQL RLS adds defence in depth for workspace-scoped tables.
- Runner commands and runner requests use separate Ed25519 trust paths, expiry and durable replay/idempotency records.
- Webhooks use unpredictable public IDs, raw-body HMAC validation, timestamps, nonces, rate limits, redaction, encrypted bounded retention and retry caps.
- Stripe webhook signatures are verified over raw bytes; card details remain with Stripe.
- Account tokens, runner private keys and provider secrets are excluded from SQLite and workflow JSON.
- Audit events are append-only and redact secret-shaped fields.

## Open release blockers

- PostgreSQL migrations and RLS policies require execution against a real disposable database; no database service was available in this workspace.
- The desktop background client is not yet wired to pairing/heartbeat/command/webhook-delivery APIs, so the protocol is tested but the multi-machine product lifecycle is not complete.
- Full JSON Schema validation for webhook payloads is not implemented; the relay currently enforces object type and required fields only.
- Publisher payouts/Stripe Connect onboarding and payout statements are not implemented.
- Web account/organisation/publisher/runner administration surfaces and corresponding screenshots are incomplete.
- v0.3 desktop installers were not regenerated after build artifacts were removed to recover disk space.

These blockers prevent declaring stage three complete even though the plugin sandbox, signing, SDK, free marketplace path and substantial control-plane security boundaries are implemented.

