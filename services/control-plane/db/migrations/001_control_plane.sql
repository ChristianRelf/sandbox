CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE owner_type AS ENUM ('personal', 'workspace', 'organisation', 'publisher');
CREATE TYPE membership_status AS ENUM ('active', 'suspended', 'removed');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');
CREATE TYPE review_status AS ENUM ('draft', 'submitted', 'automated_review', 'manual_review', 'changes_requested', 'approved', 'rejected', 'published', 'suspended', 'removed');
CREATE TYPE command_status AS ENUM ('queued', 'delivered', 'accepted', 'rejected', 'completed', 'expired', 'rerouted');
CREATE TYPE runner_status AS ENUM ('online', 'offline', 'paused', 'draining', 'maintenance', 'revoked');
CREATE TYPE workflow_publish_status AS ENUM ('draft', 'approval_requested', 'approved', 'rejected', 'published', 'rolled_back');

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_subject text UNIQUE NOT NULL,
  primary_email text UNIQUE NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE account_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  identity_session_id text UNIQUE NOT NULL,
  device_name text NOT NULL,
  device_public_key bytea,
  ip_metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX account_sessions_account_active_idx ON account_sessions(account_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type owner_type NOT NULL DEFAULT 'organisation' CHECK (owner_type = 'organisation'),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  billing_customer_ref text,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  owner_type owner_type NOT NULL DEFAULT 'workspace' CHECK (owner_type = 'workspace'),
  name text NOT NULL,
  slug text NOT NULL,
  retention_policy jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(organisation_id, slug)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  display_name text NOT NULL,
  built_in boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organisation_id, role_key)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY(role_id, permission)
);

CREATE TABLE memberships (
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id),
  status membership_status NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY(organisation_id, account_id)
);
CREATE INDEX memberships_account_active_idx ON memberships(account_id, organisation_id) WHERE status = 'active';

CREATE TABLE workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id, account_id)
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id),
  token_hash bytea UNIQUE NOT NULL,
  status invite_status NOT NULL DEFAULT 'pending',
  invited_by uuid NOT NULL REFERENCES accounts(id),
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES accounts(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_pending_idx ON invitations(organisation_id, email, expires_at) WHERE status = 'pending';

CREATE TABLE invitation_workspaces (
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY(invitation_id, workspace_id)
);

CREATE TABLE environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_key text NOT NULL CHECK (environment_key IN ('development', 'production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, environment_key)
);

CREATE TABLE protected_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name text NOT NULL,
  value_type text NOT NULL,
  is_secret boolean NOT NULL,
  value_ciphertext bytea,
  non_secret_value jsonb,
  description text NOT NULL DEFAULT '',
  allowed_workflow_ids uuid[] NOT NULL DEFAULT '{}',
  changed_by uuid NOT NULL REFERENCES accounts(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((is_secret AND value_ciphertext IS NOT NULL AND non_secret_value IS NULL) OR (NOT is_secret AND value_ciphertext IS NULL)),
  UNIQUE(environment_id, name)
);

CREATE TABLE synced_workflows (
  id uuid PRIMARY KEY,
  owner_type owner_type NOT NULL,
  owner_id uuid NOT NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  folder_id uuid,
  current_published_revision_id uuid,
  current_draft_revision_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type = 'workspace' AND workspace_id = owner_id) OR (owner_type <> 'workspace' AND workspace_id IS NULL))
);
CREATE INDEX synced_workflows_owner_idx ON synced_workflows(owner_type, owner_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE workflow_revisions (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE CASCADE,
  parent_revision_id uuid REFERENCES workflow_revisions(id),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  encrypted_payload bytea NOT NULL,
  payload_key_envelope bytea NOT NULL,
  searchable_metadata jsonb NOT NULL DEFAULT '{}',
  plugin_requirements jsonb NOT NULL DEFAULT '[]',
  permission_requirements jsonb NOT NULL DEFAULT '[]',
  runner_policy jsonb NOT NULL DEFAULT '{}',
  editor_device_id uuid NOT NULL,
  updated_by uuid NOT NULL REFERENCES accounts(id),
  updated_at timestamptz NOT NULL,
  publish_status workflow_publish_status NOT NULL DEFAULT 'draft',
  change_summary text NOT NULL DEFAULT '',
  UNIQUE(workflow_id, content_hash, parent_revision_id)
);
CREATE INDEX workflow_revisions_history_idx ON workflow_revisions(workflow_id, updated_at DESC);
ALTER TABLE synced_workflows ADD CONSTRAINT synced_workflows_published_fk FOREIGN KEY(current_published_revision_id) REFERENCES workflow_revisions(id);
ALTER TABLE synced_workflows ADD CONSTRAINT synced_workflows_draft_fk FOREIGN KEY(current_draft_revision_id) REFERENCES workflow_revisions(id);

CREATE TABLE workflow_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_by uuid NOT NULL REFERENCES accounts(id),
  resolved_by uuid REFERENCES accounts(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX workflow_approvals_pending_idx ON workflow_approvals(workspace_id, created_at) WHERE status = 'pending';

CREATE TABLE publishers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type owner_type NOT NULL CHECK (owner_type IN ('personal', 'organisation', 'publisher')),
  owner_id uuid NOT NULL,
  public_name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT '',
  logo_object_key text,
  website text,
  support_contact text NOT NULL,
  legal_entity_ref text,
  payout_account_ref text,
  payout_status text NOT NULL DEFAULT 'not_started',
  verification_status text NOT NULL DEFAULT 'unverified',
  security_contact text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE publisher_members (
  publisher_id uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY(publisher_id, account_id, permission)
);

CREATE TABLE publisher_signing_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  algorithm text NOT NULL CHECK (algorithm = 'ed25519'),
  public_key bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(publisher_id, key_id)
);

CREATE TABLE publisher_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'reviewing', 'verified', 'rejected', 'revoked', 'appealed')),
  domain text,
  identity_provider_ref text,
  decision_reason text,
  submitted_at timestamptz,
  decided_at timestamptz,
  reverify_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugins (
  id text PRIMARY KEY,
  publisher_id uuid NOT NULL REFERENCES publishers(id),
  visibility text NOT NULL CHECK (visibility IN ('public', 'organisation', 'selected_workspaces')),
  owner_type owner_type NOT NULL,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id text NOT NULL REFERENCES plugins(id),
  version text NOT NULL,
  manifest_version integer NOT NULL,
  manifest jsonb NOT NULL,
  package_integrity text NOT NULL UNIQUE,
  package_object_key text NOT NULL UNIQUE,
  package_size bigint NOT NULL CHECK (package_size BETWEEN 1 AND 33554432),
  publisher_key_id text NOT NULL,
  minimum_host_version text NOT NULL,
  maximum_host_version text,
  capabilities jsonb NOT NULL,
  network_domains jsonb NOT NULL,
  dependency_inventory jsonb NOT NULL DEFAULT '[]',
  reproducibility jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason text,
  UNIQUE(plugin_id, version)
);
CREATE INDEX plugin_versions_compatibility_idx ON plugin_versions(plugin_id, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE plugin_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_version_id uuid NOT NULL UNIQUE REFERENCES plugin_versions(id),
  status review_status NOT NULL DEFAULT 'draft',
  automated_results jsonb NOT NULL DEFAULT '{}',
  capability_review jsonb,
  network_review jsonb,
  licence_review jsonb,
  privacy_review jsonb,
  behavior_results jsonb,
  rejection_reasons jsonb NOT NULL DEFAULT '[]',
  assigned_reviewer uuid REFERENCES accounts(id),
  submitted_at timestamptz,
  decided_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plugin_reviews_queue_idx ON plugin_reviews(status, submitted_at) WHERE status IN ('submitted', 'automated_review', 'manual_review', 'changes_requested');

CREATE TABLE plugin_listings (
  plugin_id text PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
  current_version_id uuid NOT NULL REFERENCES plugin_versions(id),
  categories text[] NOT NULL,
  keywords text[] NOT NULL,
  pricing jsonb NOT NULL,
  licence text NOT NULL,
  documentation_url text NOT NULL,
  privacy_policy_url text,
  support_url text NOT NULL,
  screenshots jsonb NOT NULL DEFAULT '[]',
  security_notices jsonb NOT NULL DEFAULT '[]',
  install_count bigint NOT NULL DEFAULT 0,
  rating_average numeric(3,2),
  rating_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  removed_at timestamptz
);
CREATE INDEX plugin_listings_search_idx ON plugin_listings USING gin ((categories || keywords));
CREATE INDEX plugin_listings_recent_idx ON plugin_listings(updated_at DESC) WHERE suspended_at IS NULL AND removed_at IS NULL;
CREATE INDEX plugin_listings_installs_idx ON plugin_listings(install_count DESC) WHERE suspended_at IS NULL AND removed_at IS NULL;
CREATE INDEX plugin_listings_rating_idx ON plugin_listings(rating_average DESC NULLS LAST) WHERE suspended_at IS NULL AND removed_at IS NULL;

CREATE TABLE plugin_visibility_workspaces (
  plugin_id text NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY(plugin_id, workspace_id)
);

CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type owner_type NOT NULL,
  owner_id uuid NOT NULL,
  plugin_id text NOT NULL REFERENCES plugins(id),
  plan_id text NOT NULL,
  purchase_source text NOT NULL,
  starts_at timestamptz NOT NULL,
  renews_at timestamptz,
  status text NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'expired', 'refunded', 'revoked')),
  seat_allowance integer,
  offline_grace_until timestamptz NOT NULL,
  refund_state text NOT NULL DEFAULT 'none',
  stripe_customer_ref text,
  stripe_subscription_ref text,
  stripe_payment_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entitlements_owner_plugin_idx ON entitlements(owner_type, owner_id, plugin_id, status);

CREATE TABLE plugin_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type owner_type NOT NULL,
  owner_id uuid NOT NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  plugin_version_id uuid NOT NULL REFERENCES plugin_versions(id),
  enabled boolean NOT NULL DEFAULT false,
  approved_permissions jsonb NOT NULL DEFAULT '[]',
  installed_by uuid NOT NULL REFERENCES accounts(id),
  installed_at timestamptz NOT NULL DEFAULT now(),
  entitlement_id uuid REFERENCES entitlements(id),
  UNIQUE(owner_type, owner_id, plugin_version_id)
);

CREATE TABLE plugin_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id text NOT NULL REFERENCES plugins(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  installation_id uuid NOT NULL REFERENCES plugin_installations(id),
  version_used text NOT NULL,
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review text NOT NULL DEFAULT '',
  developer_response text,
  moderation_status text NOT NULL DEFAULT 'visible',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plugin_id, account_id)
);

CREATE TABLE shared_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  provider text NOT NULL,
  display_name text NOT NULL,
  account_identity text,
  granted_scopes text[] NOT NULL,
  permitted_workflow_ids uuid[] NOT NULL DEFAULT '{}',
  permitted_role_ids uuid[] NOT NULL DEFAULT '{}',
  central_secret_ref text,
  health text NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approval_requirements jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX shared_connections_workspace_environment_idx ON shared_connections(workspace_id, environment_id);

CREATE TABLE runners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  operating_system text NOT NULL,
  architecture text NOT NULL,
  application_version text NOT NULL,
  protocol_version integer NOT NULL,
  plugin_runtime_version text NOT NULL,
  capabilities jsonb NOT NULL,
  safe_folder_labels jsonb NOT NULL DEFAULT '[]',
  browser_engine jsonb,
  installed_plugin_versions jsonb NOT NULL DEFAULT '[]',
  tags text[] NOT NULL DEFAULT '{}',
  status runner_status NOT NULL DEFAULT 'offline',
  current_workload integer NOT NULL DEFAULT 0,
  paired_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX runners_workspace_status_idx ON runners(workspace_id, status, last_seen_at DESC);

CREATE TABLE runner_device_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  algorithm text NOT NULL CHECK (algorithm = 'ed25519'),
  public_key bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(runner_id, key_id)
);

CREATE TABLE runner_pairing_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  challenge_hash bytea UNIQUE NOT NULL,
  device_public_key bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runner_commands (
  id uuid PRIMARY KEY,
  issuer_account_id uuid NOT NULL REFERENCES accounts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  action text NOT NULL,
  workflow_revision_id uuid REFERENCES workflow_revisions(id),
  payload_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  key_id text NOT NULL,
  signature bytea NOT NULL,
  status command_status NOT NULL DEFAULT 'queued',
  delivered_at timestamptz,
  completed_at timestamptz,
  result_summary jsonb,
  UNIQUE(target_runner_id, idempotency_key)
);
CREATE INDEX runner_commands_delivery_idx ON runner_commands(target_runner_id, status, expires_at) WHERE status IN ('queued', 'delivered');

CREATE TABLE run_summaries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES workflow_revisions(id),
  runner_id uuid NOT NULL REFERENCES runners(id),
  trigger text NOT NULL,
  status text NOT NULL,
  started_at timestamptz,
  duration_ms bigint,
  failed_node_id text,
  redacted_error_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_summaries_workspace_recent_idx ON run_summaries(workspace_id, created_at DESC);
CREATE INDEX run_summaries_workspace_status_idx ON run_summaries(workspace_id, status, created_at DESC);

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE CASCADE,
  signing_secret_hash bytea NOT NULL,
  allowed_methods text[] NOT NULL,
  schema jsonb,
  maximum_request_bytes integer NOT NULL,
  rate_limit_per_minute integer NOT NULL,
  retention_seconds integer NOT NULL,
  runner_policy jsonb NOT NULL,
  offline_expiry_seconds integer NOT NULL,
  redacted_fields text[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  disabled_at timestamptz
);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY,
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payload_ciphertext bytea NOT NULL,
  payload_hash text NOT NULL,
  request_nonce text NOT NULL,
  idempotency_key text NOT NULL,
  received_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'delivered', 'expired', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  delivered_runner_id uuid REFERENCES runners(id),
  UNIQUE(endpoint_id, request_nonce),
  UNIQUE(endpoint_id, idempotency_key)
);
CREATE INDEX webhook_deliveries_queue_idx ON webhook_deliveries(status, next_attempt_at, expires_at) WHERE status = 'queued';

CREATE TABLE governance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  policy_value jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES accounts(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, policy_key)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  actor_account_id uuid REFERENCES accounts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  before_summary jsonb,
  after_summary jsonb,
  source_device_id uuid,
  ip_metadata jsonb,
  correlation_id uuid NOT NULL
);
CREATE INDEX audit_events_workspace_time_idx ON audit_events(workspace_id, occurred_at DESC, id);
CREATE INDEX audit_events_correlation_idx ON audit_events(correlation_id);

CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE synced_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE runners ENABLE ROW LEVEL SECURITY;
ALTER TABLE runner_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.account_id', true), '')::uuid
$$;

CREATE FUNCTION account_can_access_workspace(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = target AND wm.account_id = app_account_id()
  )
$$;

CREATE POLICY workspace_member_select ON workspaces FOR SELECT USING (account_can_access_workspace(id));
CREATE POLICY workspace_creator_insert ON workspaces FOR INSERT WITH CHECK (created_by = app_account_id());
CREATE POLICY workspace_member_update ON workspaces FOR UPDATE USING (account_can_access_workspace(id)) WITH CHECK (account_can_access_workspace(id));
CREATE POLICY workflow_member_all ON synced_workflows USING (workspace_id IS NULL OR account_can_access_workspace(workspace_id));
CREATE POLICY revision_member_all ON workflow_revisions USING (EXISTS (SELECT 1 FROM synced_workflows w WHERE w.id = workflow_id AND (w.workspace_id IS NULL OR account_can_access_workspace(w.workspace_id))));
CREATE POLICY runner_member_all ON runners USING (workspace_id IS NULL OR account_can_access_workspace(workspace_id));
CREATE POLICY command_member_all ON runner_commands USING (account_can_access_workspace(workspace_id));
CREATE POLICY summary_member_all ON run_summaries USING (account_can_access_workspace(workspace_id));
CREATE POLICY webhook_endpoint_member_all ON webhook_endpoints USING (account_can_access_workspace(workspace_id));
CREATE POLICY webhook_delivery_member_all ON webhook_deliveries USING (account_can_access_workspace(workspace_id));
CREATE POLICY audit_member_select ON audit_events FOR SELECT USING (account_can_access_workspace(workspace_id));
