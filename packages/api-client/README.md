# @sandbox/api-client

Typed browser and Node.js 20+ client for the stable Sandbox control-plane `/v1`
transport contract.

```ts
import { SandboxApiClient } from "@sandbox/api-client";

const api = new SandboxApiClient({
  baseUrl: "https://api.sandbox.example",
  accessToken: () => process.env.SANDBOX_ACCESS_TOKEN ?? null
});

const result = await api.listPersonalAccessTokens();
console.log(result.data.items, result.correlationId);
```

Mutations automatically receive an idempotency key, correlation ID, request
freshness timestamp, and bounded retries for 429/502/503/504 responses. Retries
reuse the logical request identity. Bearer credentials are never included in
thrown errors, redirects outside the configured origin cannot be requested, and
fetch credentials are omitted.

Convenience methods provide stable types for personal access tokens and service
accounts. Use `request({ parse })` with a Zod parser or equivalent for routes whose
resource schema has not yet been promoted in the v0.5 OpenAPI contract.
