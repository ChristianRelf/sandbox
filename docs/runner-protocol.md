# Runner pairing and command protocol

Workflow execution remains local. The control plane coordinates signed commands and summaries; it never evaluates workflow nodes.

## Pairing

1. The desktop creates an Ed25519 device key pair and keeps the private key in the operating-system credential store.
2. It sends the public SPKI key and non-sensitive compatibility metadata to create a ten-minute pairing challenge.
3. The desktop signs the exact challenge and the user selects a permitted workspace and runner name.
4. The server verifies possession, consumes the challenge once, registers the public key, and returns a revocable runner identity.

Raw local paths are not registered. Runners report safe folder labels, OS/architecture, application and protocol versions, browser availability, exact installed plugin versions, tags, status, last-seen time and workload.

## Device-authenticated requests

Runner requests contain `x-sandbox-runner-id`, `x-sandbox-key-id`, `x-sandbox-request-time`, `x-sandbox-request-nonce` and `x-sandbox-signature`. The signature covers a canonical object containing runner/key IDs, time, nonce, HTTP method, complete request path and body. Requests outside five minutes are rejected. Nonces are stored uniquely and expire after ten minutes, preventing replay.

Device keys can be rotated through a request authenticated by the current key. Successful rotation revokes older keys. Runner revocation also revokes keys and expires queued commands without deleting local data.

## Commands

The control plane signs canonical Ed25519 command envelopes containing command ID, issuer, workspace, target runner, action, exact workflow revision, payload, creation/expiry, idempotency key and signing-key ID. A command is queued only if:

- the issuer has the required explicit workspace permission;
- remote execution governance permits it;
- the runner belongs to the workspace and accepts new work;
- the exact workflow revision is approved/published;
- every required plugin version and integrity digest exists on the runner.

Offline runners retain a visible queued command until its expiry. Delivery changes its state to `delivered`; the runner then reports accepted, rejected or completed. The desktop verifier independently checks the signature, target/workspace, time window, local action policy and exact approved revision. SQLite atomically claims `(runnerId, idempotencyKey)` before execution, so reconnect delivery cannot run twice.

## Administration and presence

Administrators can rename, pause, drain, place into maintenance, resume to offline, move, or revoke runners. A move requires `runners.manage` in both workspaces and zero current workload. Heartbeats are device-signed; an absent heartbeat is displayed as offline/last seen, never as idle.

Central run records are summaries only: workflow/revision, runner, trigger, status, start, duration, failed node and redacted error. Detailed inputs, outputs, screenshots and logs stay local by default.

