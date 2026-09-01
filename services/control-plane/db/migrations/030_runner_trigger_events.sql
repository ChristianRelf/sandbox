CREATE TABLE runner_trigger_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deployment_id uuid NOT NULL REFERENCES workflow_deployments(id) ON DELETE CASCADE,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE RESTRICT,
  node_id text NOT NULL CHECK(length(node_id) BETWEEN 1 AND 200),
  plugin_id text NOT NULL CHECK(length(plugin_id) BETWEEN 3 AND 200),
  plugin_version text NOT NULL CHECK(length(plugin_version) BETWEEN 1 AND 50),
  dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 500),
  payload jsonb NOT NULL,
  provider_checkpoint jsonb,
  occurred_at timestamptz NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deployment_id,node_id,dedupe_key)
);
CREATE INDEX runner_trigger_events_delivery_idx ON runner_trigger_events(workspace_id,persisted_at,id);
CREATE INDEX runner_trigger_events_deployment_idx ON runner_trigger_events(deployment_id,node_id,occurred_at);

ALTER TABLE runner_trigger_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY runner_trigger_events_workspace_member ON runner_trigger_events
  USING(account_can_access_workspace(workspace_id));

