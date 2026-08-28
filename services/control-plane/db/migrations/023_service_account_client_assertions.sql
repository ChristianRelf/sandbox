ALTER TABLE access_tokens ADD COLUMN expiry_notification_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE service_account_assertion_keys (
  service_account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_id text NOT NULL CHECK(key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  algorithm text NOT NULL DEFAULT 'EdDSA' CHECK(algorithm='EdDSA'),
  public_key_der bytea NOT NULL CHECK(octet_length(public_key_der) BETWEEN 32 AND 1024),
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason text,
  PRIMARY KEY(service_account_id,workspace_id,key_id),
  FOREIGN KEY(service_account_id,workspace_id) REFERENCES service_account_role_assignments(service_account_id,workspace_id) ON DELETE CASCADE
);

CREATE TABLE service_account_assertion_replays (
  service_account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  key_id text NOT NULL,
  assertion_id text NOT NULL CHECK(length(assertion_id) BETWEEN 16 AND 200),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(service_account_id,workspace_id,key_id,assertion_id),
  FOREIGN KEY(service_account_id,workspace_id,key_id) REFERENCES service_account_assertion_keys(service_account_id,workspace_id,key_id) ON DELETE CASCADE
);
CREATE INDEX service_account_assertion_replays_expiry_idx ON service_account_assertion_replays(expires_at);

ALTER TABLE access_tokens
  ADD COLUMN assertion_workspace_id uuid,
  ADD COLUMN assertion_key_id text,
  ADD CONSTRAINT access_tokens_assertion_key_fk FOREIGN KEY(service_account_id,assertion_workspace_id,assertion_key_id)
    REFERENCES service_account_assertion_keys(service_account_id,workspace_id,key_id) ON DELETE RESTRICT,
  ADD CONSTRAINT access_tokens_assertion_key_pair CHECK((assertion_workspace_id IS NULL)=(assertion_key_id IS NULL)),
  ADD CONSTRAINT access_tokens_assertion_service_only CHECK(assertion_key_id IS NULL OR (token_kind='service_account' AND service_account_id IS NOT NULL));

ALTER TABLE service_account_assertion_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_account_assertion_replays ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app_is_service_assertion_verifier() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.system_role',true)='service_assertion_verifier'
$$;
CREATE POLICY service_account_assertion_keys_manager ON service_account_assertion_keys
  USING(account_has_workspace_permission(workspace_id,'api_credentials.manage'))
  WITH CHECK(account_has_workspace_permission(workspace_id,'api_credentials.manage'));
CREATE POLICY service_account_assertion_keys_verifier ON service_account_assertion_keys FOR SELECT USING(app_is_service_assertion_verifier());
CREATE POLICY service_account_assertion_replays_verifier ON service_account_assertion_replays
  USING(app_is_service_assertion_verifier()) WITH CHECK(app_is_service_assertion_verifier());
CREATE POLICY service_accounts_api_credential_manager ON service_accounts FOR SELECT USING(EXISTS(
  SELECT 1 FROM service_account_role_assignments assignment
  WHERE assignment.service_account_id=service_accounts.id AND account_has_workspace_permission(assignment.workspace_id,'api_credentials.manage')
));
CREATE POLICY service_account_roles_api_credential_manager ON service_account_role_assignments FOR SELECT
  USING(account_has_workspace_permission(workspace_id,'api_credentials.manage'));
CREATE POLICY service_accounts_assertion_verifier ON service_accounts FOR SELECT USING(app_is_service_assertion_verifier());
CREATE POLICY service_account_roles_assertion_verifier ON service_account_role_assignments FOR SELECT USING(app_is_service_assertion_verifier());
CREATE POLICY access_tokens_assertion_verifier ON access_tokens
  USING(app_is_service_assertion_verifier()) WITH CHECK(app_is_service_assertion_verifier());
