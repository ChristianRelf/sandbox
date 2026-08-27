ALTER TABLE accounts ADD COLUMN account_kind text NOT NULL DEFAULT 'human' CHECK(account_kind IN ('human','service_account'));
ALTER TABLE workspaces ADD CONSTRAINT workspaces_id_organisation_unique UNIQUE(id,organisation_id);

CREATE TABLE service_accounts (
  id uuid PRIMARY KEY,
  principal_account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
  expiry_policy_days integer NOT NULL DEFAULT 90 CHECK(expiry_policy_days BETWEEN 1 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','revoked')),
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY(workspace_id,organisation_id) REFERENCES workspaces(id,organisation_id) ON DELETE CASCADE
);
CREATE INDEX service_accounts_organisation_status_idx ON service_accounts(organisation_id,status,name);

CREATE TABLE service_account_owners (
  service_account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES accounts(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(service_account_id,account_id)
);

CREATE TABLE service_account_role_assignments (
  service_account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  environment_ids uuid[] NOT NULL DEFAULT '{}',
  assigned_by uuid NOT NULL REFERENCES accounts(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(service_account_id,workspace_id)
);

CREATE TABLE access_tokens (
  id uuid PRIMARY KEY,
  token_kind text NOT NULL CHECK(token_kind IN ('personal','service_account')),
  token_prefix text NOT NULL UNIQUE CHECK(token_prefix ~ '^sbx_(pat|sa)_[a-zA-Z0-9_-]{12}$'),
  token_hash bytea NOT NULL UNIQUE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  owner_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  service_account_id uuid REFERENCES service_accounts(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  scopes text[] NOT NULL CHECK(cardinality(scopes)>0),
  workspace_restrictions uuid[] NOT NULL DEFAULT '{}',
  environment_restrictions uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  last_used_ip_metadata jsonb,
  revoked_at timestamptz,
  revocation_reason text,
  CHECK(expires_at>created_at),
  CHECK((token_kind='personal' AND owner_account_id IS NOT NULL AND service_account_id IS NULL) OR (token_kind='service_account' AND owner_account_id IS NULL AND service_account_id IS NOT NULL))
);
CREATE INDEX access_tokens_active_prefix_idx ON access_tokens(token_prefix,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX access_tokens_owner_idx ON access_tokens(owner_account_id,created_at DESC) WHERE token_kind='personal';
CREATE INDEX access_tokens_service_account_idx ON access_tokens(service_account_id,created_at DESC) WHERE token_kind='service_account';

CREATE FUNCTION require_service_account_owner_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status<>'revoked' AND NOT EXISTS(SELECT 1 FROM service_account_owners WHERE service_account_id=NEW.id) THEN
    RAISE EXCEPTION 'service_account_human_owner_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION require_service_account_owner_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid:=COALESCE(NEW.service_account_id,OLD.service_account_id);
BEGIN
  IF EXISTS(SELECT 1 FROM service_accounts WHERE id=target_id AND status<>'revoked') AND NOT EXISTS(SELECT 1 FROM service_account_owners WHERE service_account_id=target_id) THEN
    RAISE EXCEPTION 'service_account_human_owner_required';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE CONSTRAINT TRIGGER service_account_owner_on_create AFTER INSERT OR UPDATE OF status ON service_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_service_account_owner_row();
CREATE CONSTRAINT TRIGGER service_account_owner_on_change AFTER DELETE OR UPDATE ON service_account_owners DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_service_account_owner_change();

CREATE FUNCTION reject_access_token_secret_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_hash<>OLD.token_hash OR NEW.token_prefix<>OLD.token_prefix OR NEW.token_kind<>OLD.token_kind OR NEW.owner_account_id IS DISTINCT FROM OLD.owner_account_id OR NEW.service_account_id IS DISTINCT FROM OLD.service_account_id THEN
    RAISE EXCEPTION 'access_token_identity_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER access_token_secret_immutable BEFORE UPDATE ON access_tokens FOR EACH ROW EXECUTE FUNCTION reject_access_token_secret_mutation();

INSERT INTO role_permissions(role_id,permission)
SELECT id,permission FROM roles CROSS JOIN (VALUES('service_accounts.manage'),('api_credentials.manage')) AS added(permission)
WHERE role_key IN ('owner','administrator')
ON CONFLICT DO NOTHING;

ALTER TABLE service_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_account_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_account_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_tokens ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION account_has_workspace_permission(target uuid,required_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM workspace_memberships membership JOIN role_permissions permission ON permission.role_id=membership.role_id WHERE membership.workspace_id=target AND membership.account_id=app_account_id() AND permission.permission=required_permission)
$$;
CREATE POLICY service_accounts_credential_manager ON service_accounts USING(workspace_id IS NOT NULL AND account_has_workspace_permission(workspace_id,'service_accounts.manage'));
CREATE POLICY service_account_owners_credential_manager ON service_account_owners USING(EXISTS(SELECT 1 FROM service_accounts service WHERE service.id=service_account_id AND service.workspace_id IS NOT NULL AND account_has_workspace_permission(service.workspace_id,'service_accounts.manage')));
CREATE POLICY service_account_roles_credential_manager ON service_account_role_assignments USING(account_has_workspace_permission(workspace_id,'service_accounts.manage'));
CREATE POLICY access_tokens_owner_or_credential_manager ON access_tokens USING(
  owner_account_id=app_account_id()
  OR EXISTS(SELECT 1 FROM service_account_owners owner WHERE owner.service_account_id=service_account_id AND owner.account_id=app_account_id())
  OR EXISTS(SELECT 1 FROM unnest(workspace_restrictions) workspace_id WHERE account_has_workspace_permission(workspace_id,'api_credentials.manage'))
);
