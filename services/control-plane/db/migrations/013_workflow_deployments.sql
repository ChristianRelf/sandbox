ALTER TABLE environments DROP CONSTRAINT environments_environment_key_check;
ALTER TABLE environments ADD CONSTRAINT environments_environment_key_check CHECK (environment_key IN ('development','staging','production'));

CREATE TABLE workflow_revision_tests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE CASCADE,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE CASCADE,
  runner_id uuid REFERENCES runners(id) ON DELETE SET NULL,
  result text NOT NULL CHECK (result IN ('passed','failed','cancelled','timed_out')),
  exact_node_versions jsonb NOT NULL,
  exact_plugin_versions jsonb NOT NULL DEFAULT '[]',
  tested_at timestamptz NOT NULL,
  tested_by uuid NOT NULL REFERENCES accounts(id),
  correlation_id uuid NOT NULL
);
CREATE INDEX workflow_revision_tests_passed_idx ON workflow_revision_tests(workflow_revision_id,tested_at DESC) WHERE result='passed';

CREATE TABLE workflow_permission_snapshots (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE CASCADE,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL,
  network_targets jsonb NOT NULL DEFAULT '[]',
  data_egress_summary jsonb NOT NULL DEFAULT '[]',
  approved_by uuid NOT NULL REFERENCES accounts(id),
  approved_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
  revoked_at timestamptz,
  UNIQUE(workflow_revision_id,content_hash)
);

CREATE TABLE workflow_deployments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE RESTRICT,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK(target_type IN ('this_computer','paired_desktop','managed_cloud_runner','managed_browser_worker','self_hosted_server','nas_or_raspberry_pi','runner_pool')),
  target_runner_id uuid REFERENCES runners(id) ON DELETE SET NULL,
  runner_pool_id uuid,
  region text NOT NULL,
  status text NOT NULL CHECK(status IN ('draft','validating','awaiting_approval','deploying','active','degraded','paused','failed','superseded','rolled_back')),
  status_version integer NOT NULL DEFAULT 0,
  required_connection_ids uuid[] NOT NULL DEFAULT '{}',
  required_plugins jsonb NOT NULL DEFAULT '[]',
  required_capabilities jsonb NOT NULL DEFAULT '[]',
  protected_variable_names text[] NOT NULL DEFAULT '{}',
  connection_mappings jsonb NOT NULL DEFAULT '{}',
  protected_variable_mappings jsonb NOT NULL DEFAULT '{}',
  permission_snapshot_id uuid NOT NULL REFERENCES workflow_permission_snapshots(id) ON DELETE RESTRICT,
  validation_result jsonb NOT NULL,
  usage_estimate jsonb NOT NULL,
  retention_policy jsonb NOT NULL,
  concurrency_policy jsonb NOT NULL,
  supersedes_deployment_id uuid REFERENCES workflow_deployments(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL
);
CREATE INDEX workflow_deployments_workspace_status_idx ON workflow_deployments(workspace_id,status,updated_at DESC);
CREATE INDEX workflow_deployments_active_idx ON workflow_deployments(workflow_id,environment_id) WHERE status IN ('active','degraded','paused');

CREATE TABLE deployment_events (
  id uuid PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES workflow_deployments(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  expected_version integer NOT NULL,
  actor_id uuid REFERENCES accounts(id),
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  UNIQUE(deployment_id,sequence)
);

CREATE FUNCTION deployment_transition_allowed(previous text,next text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE previous
  WHEN 'draft' THEN next='validating'
  WHEN 'validating' THEN next=ANY(ARRAY['awaiting_approval','deploying','failed'])
  WHEN 'awaiting_approval' THEN next=ANY(ARRAY['deploying','failed'])
  WHEN 'deploying' THEN next=ANY(ARRAY['active','failed'])
  WHEN 'active' THEN next=ANY(ARRAY['degraded','paused','superseded','rolled_back'])
  WHEN 'degraded' THEN next=ANY(ARRAY['active','paused','failed','superseded','rolled_back'])
  WHEN 'paused' THEN next=ANY(ARRAY['active','superseded','rolled_back'])
  WHEN 'failed' THEN next=ANY(ARRAY['validating','superseded'])
  ELSE false END
$$;
CREATE FUNCTION apply_deployment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_deployment workflow_deployments%ROWTYPE;
BEGIN
 SELECT * INTO current_deployment FROM workflow_deployments WHERE id=NEW.deployment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'deployment_not_found'; END IF;
 IF current_deployment.status_version<>NEW.expected_version OR current_deployment.status<>NEW.from_status THEN RAISE EXCEPTION 'deployment_transition_conflict'; END IF;
 IF NOT deployment_transition_allowed(NEW.from_status,NEW.to_status) THEN RAISE EXCEPTION 'deployment_transition_invalid'; END IF;
 NEW.sequence:=current_deployment.status_version+1;
 UPDATE workflow_deployments SET status=NEW.to_status,status_version=status_version+1,updated_at=NEW.occurred_at,activated_at=CASE WHEN NEW.to_status='active' THEN COALESCE(activated_at,NEW.occurred_at) ELSE activated_at END WHERE id=NEW.deployment_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER deployment_events_apply BEFORE INSERT ON deployment_events FOR EACH ROW EXECUTE FUNCTION apply_deployment_transition();
CREATE TRIGGER deployment_events_immutable BEFORE UPDATE OR DELETE ON deployment_events FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();

CREATE TABLE environment_promotions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE RESTRICT,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  source_environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  target_environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  source_deployment_id uuid REFERENCES workflow_deployments(id) ON DELETE SET NULL,
  target_deployment_id uuid REFERENCES workflow_deployments(id) ON DELETE SET NULL,
  connection_mappings jsonb NOT NULL,
  protected_variable_mappings jsonb NOT NULL,
  comparison jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('draft','awaiting_approval','approved','completed','failed')),
  requested_by uuid NOT NULL REFERENCES accounts(id),
  approved_by uuid REFERENCES accounts(id),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  correlation_id uuid NOT NULL,
  CHECK(source_environment_id<>target_environment_id)
);

ALTER TABLE workflow_revision_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_permission_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE environment_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY revision_tests_workspace_member ON workflow_revision_tests USING(account_can_access_workspace(workspace_id));
CREATE POLICY permission_snapshots_workspace_member ON workflow_permission_snapshots USING(account_can_access_workspace(workspace_id));
CREATE POLICY deployments_workspace_member ON workflow_deployments USING(account_can_access_workspace(workspace_id));
CREATE POLICY deployment_events_workspace_member ON deployment_events USING(EXISTS(SELECT 1 FROM workflow_deployments deployment WHERE deployment.id=deployment_id AND account_can_access_workspace(deployment.workspace_id)));
CREATE POLICY promotions_workspace_member ON environment_promotions USING(account_can_access_workspace(workspace_id));
