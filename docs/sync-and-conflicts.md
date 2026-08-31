# Workflow sync and conflicts

Sync is optional and does not alter personal-local execution. Workflow content is encrypted separately from account authentication with AES-256-GCM and a separately carried key envelope. The service stores ciphertext plus limited searchable metadata. This implementation is service-readable envelope encryption and is deliberately not described as end-to-end encryption.

Synced revisions contain workflow ID, revision ID, parent revision, schema version, SHA-256 content hash, editor device, update time, sync state, exact plugin requirements, permission requirements and runner policy.

The service never syncs raw credentials, cookies, browser profiles, local files, command output, detailed logs or screenshots by default.

## Conflict handling

When an uploaded revision's parent is not the current draft, sndbox preserves the uploaded sibling and the existing draft. Neither is overwritten. The UI/client may select the local revision, select the remote revision, or import one as a new merged copy. Stage three does not automatically merge workflow graphs.

Revision IDs are immutable: reusing an ID with another content hash is rejected. Parent revisions must belong to the same workflow. Deleted workflow recovery remains a version-history operation rather than destructive graph mutation.

During a control-plane outage, local edits and executions continue. Sync retries use client backoff and preserve revision identity; marketplace, remote command and sync status must clearly report unavailable/waiting rather than blocking local workflows.

