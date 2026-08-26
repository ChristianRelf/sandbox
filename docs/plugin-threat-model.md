# Plugin threat model

## Protected assets

- local files and approved folder labels
- processes, shell, environment variables, and desktop IPC
- provider credentials and account refresh tokens
- browser cookies, profiles, downloads, and screenshots
- workflow definitions, execution inputs/outputs, and history
- plugin and workspace storage belonging to other tenants
- publisher trust keys, package pins, approvals, entitlements, and revocations
- runner device identity and signed command receipts

## Adversaries

1. A deliberately malicious plugin publisher.
2. A legitimate publisher whose signing key or build pipeline is compromised.
3. A package modified between publication, download, and installation.
4. A plugin attempting denial of service through CPU, memory, output, storage, network, or host-call abuse.
5. A plugin attempting to confuse users through misleading permission prose or verification claims.
6. A workspace member trying to cross tenant, role, connection, environment, or runner boundaries.
7. A compromised control plane sending an invalid or over-broad runner command.

## Trust boundaries

The host, built-in engine, trusted browser sidecar, OS vault, and verified control-plane protocol are inside the trusted computing base. Plugin WebAssembly and all plugin-provided schemas, documentation, icons, configuration, inputs, outputs, and migrations are untrusted.

Publisher verification proves reviewed identity/control of a listing. It is not a safety guarantee or endorsement.

## Primary controls

| Threat | Control |
| --- | --- |
| Undeclared machine access | no general WASI; import allowlist contains only `sandbox_v1::host_call` |
| Arbitrary UI code | schema-rendered configuration using host components; no plugin React |
| Package tampering | canonical SHA-256 digest plus Ed25519 signature verified locally |
| Extra executable content | declared `.wasm` entrypoints only; other executable/native/script files rejected |
| Publisher compromise | rotatable keys, immutable versions, exact revocation, security notices |
| Permission smuggling | host-generated permission text and structural permission diff |
| Silent behavior update | workflow pins exact plugin/package/node versions |
| CPU/memory denial | Wasmtime fuel, epoch interruption, memory/instance/table limits, node timeout |
| Host-call amplification | request/response limits, 120/minute default, host-call buffer limits |
| Network escape | HTTPS only, method/domain/subdomain rules, redirect re-authorization, TLS validation |
| Secret theft | credential operations by reference; sensitive headers rejected; token-shaped broker output blocked |
| Cross-plugin data access | storage key includes publisher, plugin, owner/workspace, and optional major version |
| Cross-tenant access | explicit owner tuple, server authorization, constrained queries, isolation tests |
| Remote-command forgery/replay | device signatures, expiry, target binding, unique idempotency receipt, local authorization |

## Residual risks

- Wasmtime and its compiler remain in the trusted computing base and require prompt security updates.
- A plugin can exfiltrate data that the user legitimately supplied if network permission covers the destination. Permission review and narrow domains reduce but cannot eliminate this risk.
- A provider operation can cause real external side effects. High-risk operations require explicit capability and workflow approval plus idempotency support.
- Schema-driven interfaces can still contain misleading labels in publisher-authored descriptions. Capability summaries remain host-authored and visually distinct.
- A malicious plugin can produce incorrect output without violating the sandbox. Verification does not certify business correctness.

## Emergency response

Revocation is scoped by package integrity or exact plugin version. Online runners refresh signed revocation metadata, warn affected owners, block new executions, preserve workflows/configuration/data, and offer a pinned safe rollback where available. The service never remotely deletes local plugin data or workflows. Critical running-instance cancellation must be explicit in the signed notice and is logged locally and centrally.
