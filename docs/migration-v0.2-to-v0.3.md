# Migrating from v0.2 to v0.3

The upgrade does not require an account and does not move existing workflows into a team workspace.

## Local database

SQLite applies numbered migrations through schema version 7. v0.3 adds installed plugin versions, permission audits, exact package revocations, isolated plugin storage and runner-command idempotency receipts. Existing workflow, browser, connection, approval, schedule and execution tables remain in place.

Workflow definitions retain their independent schema version. Schema-1 workflows still migrate through the existing schema-2 path; stage-three plugin pins are optional, so v0.1/v0.2 built-in workflows load and execute without conversion.

Before production rollout, back up the application-data SQLite file. Migrations are forward-only. Removing a paired runner from the control plane does not delete this local database.

## Imports and exports

The `sandbox-workflow` envelope remains accepted. Stage-three exports may include exact plugin requirements and explicit ownership metadata, while older envelopes remain valid. Imported workflows receive a new ID, remain disabled and lose executable approvals. Plugin packages use their own signed immutable package format and are never treated as workflow exports.

## Accounts and sync

Sign-in is optional. Refresh tokens and device private keys are written to the OS credential store, not SQLite. Enabling sync creates encrypted cloud revisions; it does not upload credentials, browser data, local paths or detailed execution history.

## Plugins

Plugins install disabled. Workflows pin plugin ID, publisher, semantic version, integrity digest, node type and node version. Updating the installed catalogue does not mutate existing workflows. New permissions require explicit review; revocation blocks only the affected exact package/version and does not delete workflows or plugin data.

