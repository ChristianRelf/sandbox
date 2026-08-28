# Customer-approved support access v0.5

Support access is disabled unless the control plane is configured with the PostgreSQL support-access service. It never grants shell, database, workflow payload, secret, browser-profile, connection, or runner-command access.

A human support operator with the platform permission `support_access.manage` may request only the `diagnostics.read` scope for one workspace, with a specific reason and a duration from 15 minutes to eight hours. The request remains unusable until a different, recently step-up-authenticated human with `members.manage` in that workspace approves it. The customer can reject or revoke access at any time. Expiry is checked again on every diagnostic read.

The diagnostics response contains only grouped counts for runner status, execution status over the previous 24 hours, queue status, and webhook-delivery status. Recursive output redaction removes fields whose names could carry secrets, tokens, passwords, credentials, authorization, cookies, payloads, or email addresses. The service does not offer a general query or log-download primitive.

Every request, decision, revocation, and diagnostic read is written to a sequenced append-only event table with the human actor, scope, bounded resource summary, time, and correlation ID. Request scope, reason, workspace, requester, and expiry cannot be changed after creation. Support staff cannot approve their own request.

API flow:

1. Support calls `POST /v1/platform/support-access-requests` with `workspaceId`, `reason`, `scopes: ["diagnostics.read"]`, and `durationMinutes`.
2. A workspace administrator reviews `GET /v1/workspaces/{workspaceId}/support-access-requests`.
3. The administrator calls `POST /v1/support-access-requests/{requestId}/decision` with `approve` or `reject` and a rationale.
4. The requesting support operator may call `GET /v1/platform/support-access-requests/{requestId}/diagnostics` while the approved grant is active.
5. The administrator may end it immediately with `POST /v1/support-access-requests/{requestId}/revoke`.

All mutating and diagnostics requests require `x-sandbox-request-time`. Approval additionally requires a passkey, WebAuthn, or MFA session issued within the previous 15 minutes. Production identity configuration must issue `support_access.manage` only to the dedicated support role and alert on every grant approval and diagnostic access.
