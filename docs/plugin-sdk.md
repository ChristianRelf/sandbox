# sndbox plugin SDK and CLI

The public SDK is `@sandbox/plugin-sdk`. The CLI executable is `sandbox` and all plugin commands live under `sandbox plugin`.

## First plugin

Prerequisites are Node.js 20+, Rust stable, and the `wasm32-unknown-unknown` target.

```powershell
rustup target add wasm32-unknown-unknown
npm.cmd install
npm.cmd run build --workspace @sandbox/plugin-sdk
node packages/plugin-sdk/dist/cli.js plugin create my-plugin `
  --plugin-id com.example.my-plugin `
  --publisher-id com.example.publisher `
  --name "My Plugin"
node packages/plugin-sdk/dist/cli.js plugin dev my-plugin --once
node packages/plugin-sdk/dist/cli.js plugin validate my-plugin
```

`create` writes a typed manifest, Rust guest, JSON-ABI exports, icon, documentation, and release profile. `dev` compiles the same WebAssembly that production installs; it does not add WASI or weaken capability checks.

Generate a development signing key outside the plugin directory:

```powershell
node packages/plugin-sdk/dist/cli.js plugin keygen C:\secure\sandbox-keys --key-id development
node packages/plugin-sdk/dist/cli.js plugin sign my-plugin `
  --key C:\secure\sandbox-keys\development.private.pem `
  --key-id development
node packages/plugin-sdk/dist/cli.js plugin inspect my-plugin\dist\com.example.my-plugin-0.1.0.sandbox-plugin
```

Never put a private key in a plugin archive, repository, workflow export, or CI log. Marketplace publishers should use an encrypted CI secret or managed signing service and register only the public key.

## CLI

| Command | Purpose |
| --- | --- |
| `sandbox plugin create` | scaffold manifest, guest, docs, icon, and tests |
| `sandbox plugin dev` | compile and rebuild a Development-labelled package |
| `sandbox plugin validate` | validate manifest, schemas, capabilities, paths, and permission summary |
| `sandbox plugin test` | run guest tests |
| `sandbox plugin pack` | produce a reproducible unsigned development archive |
| `sandbox plugin sign` | hash, Ed25519-sign, and package without hand-built archives |
| `sandbox plugin keygen` | create a local Ed25519 test/development key pair |
| `sandbox plugin publish` | submit a verified immutable package to the API |
| `sandbox plugin inspect` | print identity, contents, integrity, permissions, and validation |
| `sandbox plugin docs` | generate host-consistent Markdown reference |

`publish` requires `SANDBOX_API_URL` and `SANDBOX_PUBLISH_TOKEN` or matching flags. The integrity digest is used as the request idempotency key. A submission creates a new review object; it does not overwrite an approved version.

## Manifest reference

The stage-three manifest version is `1` and uses camelCase JSON. Required top-level fields are:

- identity: `manifestVersion`, `pluginId`, `name`, `description`, `version`, `publisherId`;
- host compatibility: `minimumHostVersion`, optional `maximumHostVersion`;
- publisher links: `homepage`, `documentation`, `supportUrl`, `licence`, optional `privacyPolicy`;
- discovery: `categories`, `keywords`, `icon`;
- behavior: `nodes`, `credentials`, `capabilities`, `networkDomains`, `storageRequirements`, `migrations`, `entrypoints`;
- trust and commerce: `packageIntegrity`, `signature`, `pricing`.

Plugin and publisher IDs are lowercase reverse-domain identifiers. Versions are semantic versions. Publisher URLs use HTTPS. Executable entrypoints are safe relative `.wasm` paths. Distributed packages require `sha256:<hex>` integrity and an Ed25519 signature.

Each node declares stable `nodeType`, positive `nodeVersion`, display metadata, risk, JSON input/output/configuration schemas, credential requirements, capability keys, timeout, retry behavior, idempotency, documentation, migrations, and execution entrypoint. A workflow pin includes all of plugin ID/version/integrity and node type/version.

## Node lifecycle and type system

The editor renders configuration from JSON Schema using host components. Plugins cannot mount React components. At execution the host validates configuration/input, creates an immutable capability context, runs the exact pinned guest, validates output, redacts diagnostics, and records the exact versions.

Use SDK helpers:

```ts
import { defineNode, definePlugin, schema } from "@sandbox/plugin-sdk";

const currentWeather = defineNode({
  nodeType: "weather.current",
  nodeVersion: 1,
  displayName: "Current Weather",
  description: "Read current weather.",
  category: "Data",
  riskLevel: "low",
  inputSchema: schema.object({}),
  outputSchema: schema.object({ temperature: schema.number() }, { required: ["temperature"] }),
  configurationSchema: schema.object({ latitude: schema.number(), longitude: schema.number() }, { required: ["latitude", "longitude"] }),
  credentialRequirements: [],
  capabilities: ["workflow_input", "network"],
  timeoutMs: 15_000,
  retryBehavior: "safe",
  idempotencySupport: "read_only",
  documentation: "docs/current-weather.md",
  migrationHandlers: [],
  executionEntrypoint: "main"
});
```

Schemas must be bounded: constrain strings/arrays where practical and disallow unknown configuration properties. The host remains authoritative even if publisher tests accept invalid data.

## Host APIs

Guests export `memory`, `alloc(i32) -> i32`, and an execution function `(i32, i32) -> i64`. The SDK hides pointer packing. The only import is `sandbox_v1::host_call`, carrying typed JSON requests.

Available host operations are:

- `http_request`
- `credential_operation`
- `log`
- `storage_get`, `storage_put`, `storage_delete`
- `time`
- `random_identifier`
- `crypto_sha256`

A host operation is denied unless declared by the plugin, referenced by the node, approved for the installation/workspace, and allowed by current policy.

## Credential model

Manifests declare credential types, operations, and scopes. Workflows store a credential reference, not a secret. The execution context maps an approved friendly reference such as `company-gmail` to a host-owned vault ID. A request names the reference, credential type, operation, and typed input:

```json
{
  "operation": "credential_operation",
  "credentialReference": "company-gmail",
  "credentialType": "gmail",
  "action": "gmail.messages.list",
  "input": { "query": "is:unread" }
}
```

The provider adapter injects or refreshes credentials inside the host. OAuth tokens are never returned to guest memory. Secret-shaped provider responses are blocked.

## Network access

Network requests go through the host. Declare exact lowercase domains, methods, and whether subdomains/redirects are needed. Every redirect target is re-authorized. HTTPS, platform TLS validation, bounded timeouts, response limits, rate limits, cancellation, and sensitive-header rejection are mandatory. Do not request a broad domain when a provider-specific API domain is sufficient.

## Permission model

Permission descriptions and update differences are generated by the host from structured declarations. Publisher prose may explain intent but cannot replace the host summary. Adding a domain/method, credential operation, storage quota, external action, or file access is an expansion. The installed version stays active until a user/administrator approves it. Removing access does not require approval.

Developer plugins show a persistent Development badge, remain disabled in production workspaces, require normal approval, and are excluded from exports unless explicitly included.

## Storage

Temporary storage is scoped to execution. Persistent storage is scoped by publisher, plugin, owner/workspace, and usually major version. Keys are not paths. The manifest declares quotas and retention, with a stage-three maximum of 100 MB per class. Uninstall asks whether to retain temporarily, export, or delete; package removal alone does none of these.

## Cancellation and limits

The host can interrupt a guest using Wasmtime epoch interruption. Guest code should make bounded work, check host-operation results, and avoid large intermediate allocations. Default limits are 32 MB memory, 25 million fuel, 30 seconds, 1-MB input/output, and 2-MB host responses. A node may request a shorter timeout up to five minutes, but policy can impose a lower limit.

## Retries and idempotency

Use `retryBehavior: "safe"` only for reads or operations proven repeatable. External actions use `idempotency_required` and `idempotencySupport: "keyed"`. Send the execution/node idempotency key to the provider. Do not generate a new key on retry. The Internal Approval example refuses to create a request without one.

## Testing

`MockHost` records calls and lets unit tests register typed handlers. It rejects secret-shaped mock credential output to match production behavior. Tests should cover typed validation, provider errors, rate-limit diagnostics, cancellation, retry/idempotency, migrations, and absence of undeclared calls.

Repository integration tests compile both examples to `wasm32-unknown-unknown` and run them through `sandbox-plugin-runtime`, not a JavaScript substitute. Additional runtime tests deny filesystem/process/socket/environment/IPC imports and enforce memory, fuel, time, network, storage, signature, tamper, and revocation controls.

## Packaging and signing

Archives use deterministic stored ZIP entries with fixed timestamps, sorted paths, and no manually assembled files. The digest covers a canonical unsigned manifest plus every sorted package entry. The signed manifest records that digest and the signature. The Rust verifier example accepts packages produced and signed by the TypeScript SDK, providing a cross-language compatibility check in CI and release verification.

Only declared `.wasm` entrypoints may be executable. Allowed non-executable content is constrained to documentation, schemas/migrations/locales/examples, and image assets. JavaScript, native libraries, executables, shell files, and undeclared WebAssembly are rejected.

## Versioning, migration, and deprecation

- Patch: compatible fixes with unchanged node contract/permissions.
- Minor: additive compatible nodes/features; existing workflow pins remain unchanged.
- Major: breaking behavior, storage isolation, or contract changes.

Never reuse a published version. Add a new node version for schema/behavior changes and declare an explicit migration handler. Migration receives old configuration and returns new configuration plus target node version. The host validates the result and applies it only to a draft/copy after approval. Active published workflows do not migrate in place.

Deprecation marks versions/nodes with replacement guidance and a support date. It does not revoke or silently update. Revocation is reserved for security/legal emergencies and is scoped to exact package integrity/version.

## Security expectations and review

Publishers must minimize capabilities/domains, document data handling, provide a privacy policy when required, inventory dependencies, reproduce builds where practical, test node behavior, redact diagnostics, and disclose external side effects. Publisher verification means identity/listing control was reviewed; it is not an endorsement or safety guarantee.

Review proceeds through Draft, Submitted, Automated review, Manual review, Changes requested, Approved/Rejected, Published, Suspended, or Removed. Each version has its own immutable review. Material permission expansion always receives a new capability/network review.

## Complete examples

- `examples/plugins/weather-data`: typed read-only host-mediated HTTP, configuration schema, provider error handling, and rate-limit diagnostics.
- `examples/plugins/internal-approval`: credential reference, external action, mandatory idempotency, high-risk permission, and node v1→v2 migration.
