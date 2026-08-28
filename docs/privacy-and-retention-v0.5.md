# Privacy, export, deletion and retention v0.5

The production control plane uses typed PostgreSQL retention policy, not deployment JSON metadata. A daily worker applies bounded batches per workspace. Administrators with `policies.manage` can read or update these periods through `/v1/workspaces/{workspaceId}/privacy-retention`:

| Data | Class | Default | Allowed | Enforcement |
| --- | --- | ---: | ---: | --- |
| Execution events, checkpoints and payload references | Customer content | 90 days | 1–3650 days | Delete event/checkpoint detail and cryptographically inaccessible payload references; retain the outcome summary. |
| Queue events and attempt history | Customer content | 30 days | 1–365 days | Delete terminal events, replay evidence and attempts after the period. |
| Encrypted webhook deliveries | Customer content | 7 days | 1–30 days | Delete at endpoint expiry or the workspace limit, whichever comes first. |
| Completed runner commands | Security-sensitive customer content | 30 days | 1–365 days | Delete terminal command payloads and results. |
| Workspace audit events | Security record | 2555 days | 365–3650 days | Delete only through the privacy worker after the configured minimum. |

Billing usage and invoice reconciliation are financial records and are excluded from customer-configurable purge. Incident, support-access, access-review and deletion receipts are security/compliance evidence governed by the documented platform schedule. Active records, active executions, queued work and unresolved incidents are never removed by the retention worker.

The in-code `DATA_CLASSIFICATION` registry maps account identity, authentication material, workflow content, execution detail, webhook payloads, operational evidence and billing records to their handling schedule. Secret values, token hashes, encrypted protected variables and raw webhook payloads are never included in account export.

`GET /v1/account/export` returns a versioned export containing account metadata, organisation/workspace memberships, sessions without device keys or IP metadata, invitation history, credential metadata without hashes or plaintext, personal workflow metadata without encrypted content, and audit events attributable to the account.

`DELETE /v1/account` requires a fresh interactive passkey/MFA request and refuses deletion while the account owns an organisation or is the sole human owner of an active service account. It immediately removes sessions, memberships and transferable service-account ownership, revokes credentials and runners, pseudonymizes identity/email/display name, rewrites invitation email, and cryptographically erases personal workflow ciphertext/key envelopes while retaining non-personal referential evidence. A durable receipt records only the account identifier, completion time, correlation ID and aggregate deletion counts. The deleted identity subject and still-unexpired identity-provider tokens are rejected on every subsequent request.

`PRIVACY_RETENTION_SWEEP_INTERVAL_MS` controls the worker interval and cannot be below 60 seconds. Production should use the daily default, monitor the `privacy-retention` readiness probe, and alert on sweep failure. Object-storage, worker temporary-disk and backup expiry remain infrastructure controls and must use limits no longer than their corresponding database class.
