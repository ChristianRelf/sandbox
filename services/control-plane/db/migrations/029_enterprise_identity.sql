CREATE TABLE organisation_sso_connections (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  connection_type text NOT NULL CHECK(connection_type IN ('oidc','saml')),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  issuer_url text NOT NULL CHECK(issuer_url LIKE 'https://%'),
  client_identifier text NOT NULL CHECK(length(client_identifier) BETWEEN 1 AND 500),
  verified_domains text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organisation_id, display_name)
);

CREATE TABLE organisation_scim_tokens (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  prefix text NOT NULL UNIQUE,
  token_hash bytea NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK(expires_at > created_at)
);

CREATE TABLE scim_managed_users (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  role_key text NOT NULL,
  workspace_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organisation_id, external_id),
  UNIQUE(organisation_id, account_id)
);

CREATE INDEX organisation_scim_tokens_active_idx ON organisation_scim_tokens(prefix,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX scim_managed_users_lookup_idx ON scim_managed_users(organisation_id,user_name);

ALTER TABLE organisation_sso_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_managed_users ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION app_scim_organisation_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.scim_organisation_id', true), '')::uuid
$$;
CREATE POLICY organisation_sso_member ON organisation_sso_connections USING(account_can_access_organisation(organisation_id));
CREATE POLICY scim_managed_users_member ON scim_managed_users USING(account_can_access_organisation(organisation_id) OR organisation_id=app_scim_organisation_id()) WITH CHECK(account_can_access_organisation(organisation_id) OR organisation_id=app_scim_organisation_id());
