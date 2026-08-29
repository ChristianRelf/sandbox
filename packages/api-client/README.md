# @sandbox/api-client

Typed browser and Node.js 20+ client for the stable Sandbox control-plane `/v1`
transport contract.

```ts
import { SandboxApiClient } from "@sandbox/api-client";

const api = new SandboxApiClient({
  baseUrl: "https://api.sndbox.app",
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

Convenience methods provide stable compile-time types for personal access tokens
and service accounts. Every published operation has a named v1 OpenAPI request
and response schema; use `request({ parse })` with a Zod parser or equivalent when
runtime response validation is also required.
