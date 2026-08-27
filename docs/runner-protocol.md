# Runner protocol v2

Protocol v2 is shared by desktop, hosted, managed-browser, self-hosted Linux, NAS and Raspberry Pi runners. It carries coordination only; workflow semantics remain in the versioned Rust engine.

## Identity

Every runner registers a unique runner ID and Ed25519 device/workload key, runner type, protocol/engine/plugin-runtime versions, OS and architecture, workspace and environment assignment, region, tags, concurrency limit, maintenance state, node capabilities, exact plugins and connection availability. Registration uses a short-lived pairing token and requires fingerprint confirmation for self-hosted devices. Permanent account credentials are never placed in pairing commands.

The supported protocol is currently exactly version 2. Messages with another version or unknown fields fail strict schema validation. Engine and plugin-runtime compatibility are exact at this stage; supported version ranges may be introduced only with conformance tests.

## Authentication

Device requests retain the v1 canonical request signature covering runner/key IDs, time, nonce, method, full path and body. The server rejects stale times, reused nonces, revoked keys and signatures over mutated bodies. Workload identities use the same canonical request semantics with shorter credential lifetimes.

Control-plane work commands remain signed independently of runner requests. A compromised runner device key cannot mint a control-plane command.

## Message families

| Message | Purpose |
| --- | --- |
| `registration` | identity, key, fingerprint, versions, placement and update channel |
| `heartbeat` | health, capacity, maintenance, capabilities, plugins, connections and bounded resource use |
| `work_claim` / `work_claim_result` | capability-matched assignments and short leases |
| `lease_renewal` | authenticated bounded extension of the current lease generation |
| `cancellation_ack` | cancelled, already terminal, not running or unable to confirm |
| `progress` | ordered node lifecycle, redacted logs, output metadata and artifact grants |
| `drain_status` | active executions and expected drain completion |
| `update_status` | selected channel, current/target version and update lifecycle |

Progress metadata is redacted before upload. Artifacts use separate size-bounded, expiring upload grants. A runner never sends raw connection material as availability metadata.

## Compatibility

Dispatch evaluates every declared requirement:

- protocol, engine and plugin-runtime versions;
- runner type and architecture;
- workspace, environment and optional region;
- every required tag;
- active maintenance state and concurrency;
- every node type and node version;
- exact plugin ID, version and package integrity;
- every environment-scoped connection in available state.

Online status alone never makes a runner compatible. The same compatibility function is used for pre-deployment validation and work claiming.

## Work claiming and leases

The dispatcher selects compatible waiting work under a database row lock with `SKIP LOCKED`. It creates one active lease per execution, assigns a monotonically increasing generation and returns an opaque 256-bit token. Only the token hash is stored. A lease is short, renewable and bounded to five minutes per extension.

Runner-owned transitions and checkpoints require the current runner, lease ID and an unexpired matching token. Duplicate claim attempts cannot create a second active lease. Revocation or drain prevents new claims but does not erase local data.

## At-least-once semantics

Leases prevent normal concurrent claims; they do not provide exactly-once external effects. After lease loss, the control plane records `lost`, examines the last checkpoint and interrupted node, and either resumes safe work or blocks for review. Reused work preserves its original idempotency key when supported.

