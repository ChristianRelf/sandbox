# sndbox API policy for v0.5

The supported control-plane surface is `/v1`. The checked-in route contract is
`docs/api/openapi-v1.json`; `GET /v1/openapi.json` serves the same document from a
running control plane.

The public `@sandbox/api-client` package implements this transport contract for
browser and Node.js 20+ callers. It provides stable credential/service-account
types and accepts a caller-supplied parser for runtime validation of other resource
responses.

## Compatibility and deprecation

- Existing v1 fields and successful meanings remain backward compatible for the
  supported lifetime of v0.5. Additive response fields and new enum values may be
  introduced within v1, so clients must ignore unknown object fields and handle
  unknown enum values safely.
- A breaking request, response, authentication, or semantic change requires a new
  major path such as `/v2`.
- Deprecations are announced in release notes and response `Deprecation` and
  `Sunset` headers at least 180 days before removal. Security or legal emergencies
  may shorten that period and require a published incident notice.
- Preview endpoints must not use `/v1`; they use an explicit preview namespace and
  carry no stable compatibility promise.

## Correlation and errors

Every response includes `x-correlation-id`. A client may supply a safe 8–128
character value in the same header; otherwise the server generates a UUID. Error
responses use this stable envelope:

```json
{
  "error": { "code": "invalid_request", "message": "Human-readable summary", "details": [] },
  "correlationId": "request-id"
}
```

Clients branch on `error.code`, not `message`. Validation details are additive and
must not be parsed as a substitute for the published request contract.

## Idempotency

Clients should send `Idempotency-Key` on v1 `POST`, `PUT`, `PATCH`, and `DELETE`
requests. Keys contain 16–200 letters, digits, `.`, `_`, `:`, or `-` and are scoped
to a hash of the caller credential (or runner identity). Identical requests replay
the original status and JSON response with `idempotency-replayed: true`. Reusing a
key with a different method, URL, content type, or body returns
`idempotency_key_reused`; a concurrent duplicate returns
`idempotency_request_in_progress` with `retry-after`.

Production stores records for 24 hours in PostgreSQL. Response bodies are encrypted
with `API_IDEMPOTENCY_ENCRYPTION_KEY_BASE64`, which must decode to 32 bytes. This is
separate from token hashing and webhook encryption keys. Five-hundred responses are
not retained, allowing a safe retry.

`@sandbox/api-client` adds idempotency and freshness headers automatically. It
retries 429, 502, 503 and 504 responses at most twice by default and only retries a
mutation when it carries an idempotency key. The same key and correlation ID are
retained across attempts.

Generate a key in PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:API_IDEMPOTENCY_ENCRYPTION_KEY_BASE64 = [Convert]::ToBase64String($bytes)
```

## Rate limits

The default control-plane budget is 240 requests per IP per minute. Health checks
allow 60 per minute; invitation acceptance and runner pairing use narrower limits.
Responses expose `x-ratelimit-limit`, `x-ratelimit-remaining`, and
`x-ratelimit-reset`. A 429 response uses the standard error envelope and includes
`retry-after`. Clients must back off and must not rotate identities to evade limits.

## Contract drift gate

Regenerate the route contract after changing routes:

```powershell
npm.cmd run openapi:generate --workspace @sandbox/control-plane
npm.cmd run openapi:check --workspace @sandbox/control-plane
```

The complete control-plane test command runs the check. The current OpenAPI file
records every stable method/path plus common transport behavior. Every operation
has a named request and response schema; health, marketplace summaries, personal
credentials and service accounts additionally publish closed field-level schemas.
Compatibility tests reject unresolved operation references and the removed
`JsonValue` fallback.
