CREATE TABLE cloud_browser_profiles (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_kind text NOT NULL DEFAULT 'cloud' CHECK(profile_kind='cloud'),
  name text NOT NULL,
  region text NOT NULL,
  encrypted_state_reference text NOT NULL,
  viewport jsonb NOT NULL,
  locale text NOT NULL,
  time_zone text NOT NULL,
  browser_permissions jsonb NOT NULL DEFAULT '[]',
  download_policy jsonb NOT NULL,
  proxy_reference text,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL,
  CHECK(expires_at>created_at)
);
CREATE INDEX cloud_browser_profiles_workspace_idx ON cloud_browser_profiles(workspace_id,created_at DESC);

CREATE TABLE cloud_browser_profile_imports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cloud_profile_id uuid NOT NULL REFERENCES cloud_browser_profiles(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK(source_type='explicit_local_export'),
  data_summary jsonb NOT NULL,
  security_warning_accepted boolean NOT NULL CHECK(security_warning_accepted),
  reauthentication_recommended boolean NOT NULL CHECK(reauthentication_recommended),
  contains_saved_passwords boolean NOT NULL DEFAULT false CHECK(NOT contains_saved_passwords),
  encrypted_archive_reference text NOT NULL,
  expires_at timestamptz NOT NULL,
  imported_by uuid NOT NULL REFERENCES accounts(id),
  imported_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL
);
CREATE TRIGGER cloud_browser_profile_imports_immutable BEFORE UPDATE OR DELETE ON cloud_browser_profile_imports FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();

ALTER TABLE cloud_browser_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_browser_profile_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY cloud_profiles_workspace_member ON cloud_browser_profiles USING(account_can_access_workspace(workspace_id));
CREATE POLICY cloud_profile_imports_workspace_member ON cloud_browser_profile_imports USING(account_can_access_workspace(workspace_id));
