# Known limitations and proposed v0.4 scope

## Stage-three limitations still open

- The web control surface currently provides public marketplace discovery/details only. Authenticated account, organisation, publisher, billing, runner, audit, webhook and approval pages remain to be built against the implemented APIs.
- Desktop screens exist for marketplace, installed plugins, account settings and local approvals, but workspace switching, team members, shared connections, runner management, audit/activity and private-plugin administration are not yet wired.
- Runner protocol verification and server coordination exist, but the desktop polling/presence client and pairing UI are incomplete.
- Stripe checkout and entitlement processing exist; Stripe Connect publisher onboarding, balances, country messaging, refunds administration and downloadable payout statements do not.
- Shared connections support explicit per-runner authorization labels. A centrally managed credential provider is not implemented.
- Webhook schema validation is a deliberately small safe subset, not complete JSON Schema.
- Publisher verification workflow data exists, but application/appeal/re-verification routes and UI are incomplete.
- Marketplace review reporting exists; moderator disposition routes/UI are incomplete.
- No production PostgreSQL, object storage, queue, email, OIDC or Stripe environment was available for a deployment demonstration.
- No new stage-three screenshots are available until the missing workspace/runner UI is functional.

## Recommended v0.4 scope

Stage four should begin only after the blockers above are closed and stage-three lifecycle demonstrations run against production-like services. Then add hosted execution as an explicit opt-in runner class, with isolated compute/browser workers, region and retention controls, usage metering, enterprise identity/SCIM, and operational tooling. Hosted workers must consume the same exact workflow revisions, plugin sandbox, capability broker, entitlements, approvals and audit protocol as local runners; they must not create a privileged plugin path.

