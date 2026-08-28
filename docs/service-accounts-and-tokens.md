# Service accounts and access tokens

`v0.5.0` introduces non-interactive service principals and scoped personal access tokens without changing account-free local execution.

## Security model

- Token values use the identifiable `sbx_pat_…` or `sbx_sa_…` prefix and 256 bits of random secret material.
- The API returns a token value only from its creation response. Lists contain metadata and prefix only.
- PostgreSQL stores an HMAC-SHA-256 digest using the control-plane `ACCESS_TOKEN_PEPPER_BASE64`; it never stores the token value.
- Personal tokens expire within 90 days. Service-account credentials are additionally bounded by that account's 1–365 day expiry policy; current API defaults remain 30 days.
- Every credential has explicit scopes, organisation, one or more workspaces, and optional environment restrictions.
- Effective access is the intersection of credential scopes, credential resource restrictions, the principal role and the normal server-side permission check.
- Service accounts have a non-interactive principal record and no OIDC subject usable for login, password or browser session.
- At least one human owner is enforced by a deferred database constraint, including when owner rows are changed concurrently in a transaction.
- Revocation is immediate. Active service-account state is checked again on every token authentication.
- Authentication headers and token fields are redacted from control-plane logs.

The database RLS policies expose credential metadata only to the personal token owner, a service-account owner, or a principal with the relevant credential-management permission. Cross-tenant RLS tests use a non-bypass database role.

## Configuration

Generate a 32-byte or longer pepper and provide it as base64:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:ACCESS_TOKEN_PEPPER_BASE64 = [Convert]::ToBase64String($bytes)
```

Store the value in the production secret manager. Rotation requires an explicit credential migration or revocation plan; replacing it immediately invalidates existing tokens.

## API

Personal token operations:

```text
GET    /v1/personal-access-tokens
POST   /v1/personal-access-tokens
DELETE /v1/personal-access-tokens/{tokenId}
```

Service-account operations:

```text
GET    /v1/workspaces/{workspaceId}/service-accounts
POST   /v1/workspaces/{workspaceId}/service-accounts
POST   /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/tokens
DELETE /v1/workspaces/{workspaceId}/access-tokens/{tokenId}
POST   /v1/organisations/{organisationId}/service-accounts
```

Creation and revocation require `X-Sandbox-Request-Time` freshness. Service-account creation requires an interactive human and `service_accounts.manage` in every assigned workspace; credential issue/revocation requires `api_credentials.manage` in every workspace included by the token. The returned token is used as a normal bearer credential. Personal token management itself requires an interactive human session and cannot be performed using another access token.

Organisation service accounts take one to 100 unique workspace assignments. Each assignment selects an organisation role and optional environment restrictions. The control plane validates every workspace, role and environment in one transaction, creates the non-interactive principal membership in each workspace, and writes a workspace-local audit event. Workspace listings include both workspace-scoped accounts and organisation accounts assigned there.

Example personal token request:

```json
{
  "name": "GitHub Actions",
  "scopes": ["workflows.test", "deployments.manage"],
  "organisationId": "00000000-0000-4000-8000-000000000001",
  "workspaceIds": ["00000000-0000-4000-8000-000000000002"],
  "environmentIds": ["00000000-0000-4000-8000-000000000003"],
  "expiresInDays": 30
}
```

Do not print creation responses in CI logs. Capture the `credential.token` field directly into the CI secret store, then discard the response body.

## Current limitation

Organisation-wide assignment is implemented. Periodic access-review decisions, expiry notifications, signed client assertions and workload identity remain later items in the ordered v0.5 plan.
