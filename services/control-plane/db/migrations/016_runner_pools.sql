CREATE TABLE runner_pools (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  strategy text NOT NULL CHECK(strategy IN ('least_loaded','round_robin','priority_failover')),
  region text,
  required_tags text[] NOT NULL DEFAULT '{}',
  maximum_concurrency integer NOT NULL CHECK(maximum_concurrency > 0 AND maximum_concurrency <= 10000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','draining')),
  routing_cursor bigint NOT NULL DEFAULT 0 CHECK(routing_cursor >= 0),
  created_by uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, environment_id, name),
  UNIQUE(id, workspace_id, environment_id)
);

CREATE TABLE runner_pool_members (
  pool_id uuid NOT NULL REFERENCES runner_pools(id) ON DELETE CASCADE,
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 100 CHECK(priority BETWEEN 0 AND 10000),
  enabled boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(pool_id, runner_id)
);

CREATE INDEX runner_pool_members_runner_idx ON runner_pool_members(runner_id, pool_id) WHERE enabled;
CREATE INDEX runner_pools_routing_idx ON runner_pools(workspace_id, environment_id, status);
ALTER TABLE executions ADD CONSTRAINT executions_runner_pool_fk
  FOREIGN KEY(runner_pool_id, workspace_id, environment_id) REFERENCES runner_pools(id, workspace_id, environment_id) ON DELETE NO ACTION;
ALTER TABLE workflow_deployments ADD CONSTRAINT workflow_deployments_runner_pool_fk
  FOREIGN KEY(runner_pool_id, workspace_id, environment_id) REFERENCES runner_pools(id, workspace_id, environment_id) ON DELETE NO ACTION;

ALTER TABLE runner_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE runner_pool_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY runner_pools_workspace_member ON runner_pools USING(account_can_access_workspace(workspace_id));
CREATE POLICY runner_pool_members_workspace_member ON runner_pool_members USING(
  EXISTS(SELECT 1 FROM runner_pools pool WHERE pool.id=pool_id AND account_can_access_workspace(pool.workspace_id))
);
