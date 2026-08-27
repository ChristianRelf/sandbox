# Stage-four threat-model update

## Assets and trust boundaries

Stage four introduces customer code execution, browser sessions, centrally coordinated side effects, cloud secrets, artifacts and billable usage. The principal trust boundaries are desktop-to-control-plane, control-plane-to-runner, runner-to-isolated workload, browser-to-network, plugin-to-capability broker, connector-to-private service, and metering-to-billing.

Every hosted action must be attributable to workspace, workflow revision, trigger, deployment, permission snapshot, runner, plugin versions, connection references and usage records.

## Primary threats and required controls

| Threat | Required control and verification gate |
| --- | --- |
| Cross-tenant execution or data access | Workspace identity on every queue/event/lease/artifact/usage row; API authorization plus RLS; isolated workload identity; adversarial tenant tests |
| Duplicate external side effects | At-least-once wording, idempotency keys, lease fencing, durable checkpoints, bounded retry policy and explicit uncertain outcome |
| Runner impersonation/replay | Per-device Ed25519 identity, short-lived pairing, signed canonical requests, nonce/freshness store, key rotation and revocation |
| Compromised runner image | Signed images/binaries, digest-pinned deployment, SBOM and vulnerability scan, least-privilege workload identity and update channels |
| Container escape/resource abuse | Short-lived per-execution isolation, non-root user, read-only base, seccomp/capability drop, CPU/memory/time/storage quotas and no privileged containers |
| Metadata/control-plane SSRF | DNS/IP validation before and after redirects, private/link-local/metadata deny rules, network segmentation and explicit connector routing |
| Browser profile leakage | Workspace-owned encrypted cloud profiles, per-execution context, no cross-customer reuse, explicit import, expiry and worker destruction |
| Malicious downloads | size/type limits, quarantine scan, content-disposition hardening, expiring artifact URLs and no execution in browser workers |
| Secret exfiltration | envelope encryption, workflow/environment/resource scope, operation-specific grants, audited access, redaction and no indiscriminate environment injection |
| Plugin privilege inheritance | Existing no-WASI sandbox plus immutable per-execution capability policy; runner network access is never inherited automatically |
| Queue poisoning/replay | Schema/version validation, visibility timeouts, bounded exponential retry with jitter, poison detection, dead letter and audited administrative replay |
| Cost exhaustion | tenant quotas, queue/concurrency limits, immutable metering, warning/hard limits and local execution exclusion |
| Connector lateral movement | outbound-only mTLS, exact hostname/IP/CIDR/port/protocol grants, service advertisement, key rotation, audit and revocation |
| Log/artifact disclosure | pre-upload redaction, least-sensitive default, separate artifacts, size/retention limits and tenant-scoped signed URLs |
| Supply-chain compromise | lockfiles, signature verification, dependency/container scans, SBOMs, publisher trust, exact plugin/runtime versions and central vulnerability process |
| Destructive remote update | supported version ranges, drain/maintenance windows, explicit channels and documented emergency-only override |

## Recovery safety

A missing heartbeat proves only loss of communication. It does not prove that the last HTTP request, email, payment, deletion or other side effect failed. Recovery therefore examines the last immutable checkpoint and node retry declaration. Safe/idempotent work may resume with the same idempotency key; unsafe or unknown work enters operator review. The interface must say resumed, restarted, abandoned or resolved and must never call this exactly once.

## Release gates

- Hosted runner launch is blocked until tenant, resource and network isolation tests pass.
- Managed browser launch is blocked until context/profile isolation, metadata/private-network blocking, download scanning and destruction tests pass.
- Automatic lease recovery is blocked until unsafe-side-effect ambiguity tests pass.
- Billing enforcement is blocked until immutable usage deduplication and local-execution exclusion pass.
- Regional residency claims are blocked until control, execution, secret, artifact, log and third-party flows are all mapped.
- Backup claims are blocked until an encrypted backup is restored and application-level integrity checks pass.

