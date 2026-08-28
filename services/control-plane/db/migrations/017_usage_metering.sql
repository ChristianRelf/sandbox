CREATE TYPE usage_meter AS ENUM (
  'hosted_runner_seconds',
  'managed_browser_seconds',
  'network_egress_bytes',
  'artifact_storage_byte_seconds'
);

ALTER TABLE environments ADD CONSTRAINT environments_id_workspace_unique UNIQUE(id,workspace_id);
ALTER TABLE executions ADD CONSTRAINT executions_id_workspace_unique UNIQUE(id,workspace_id);

CREATE TABLE usage_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  environment_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  deployment_id uuid NOT NULL REFERENCES workflow_deployments(id) ON DELETE RESTRICT,
  meter usage_meter NOT NULL,
  quantity bigint NOT NULL CHECK(quantity >= 0),
  unit text NOT NULL CHECK(unit IN ('seconds','bytes','byte_seconds')),
  source_event_id text NOT NULL CHECK(length(source_event_id) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 200),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[a-f0-9]{64}$'),
  period_started_at timestamptz NOT NULL,
  period_ended_at timestamptz NOT NULL,
  region text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(environment_id,workspace_id) REFERENCES environments(id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(execution_id,workspace_id) REFERENCES executions(id,workspace_id) ON DELETE RESTRICT,
  CHECK(period_ended_at >= period_started_at),
  UNIQUE(workspace_id,idempotency_key),
  UNIQUE(workspace_id,source_event_id,meter)
);
CREATE INDEX usage_events_execution_idx ON usage_events(execution_id,meter,recorded_at);
CREATE INDEX usage_events_workspace_period_idx ON usage_events(workspace_id,period_started_at,period_ended_at);

CREATE TABLE usage_reconciliations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  execution_id uuid NOT NULL,
  reconciliation_version integer NOT NULL CHECK(reconciliation_version > 0),
  expected_quantities jsonb NOT NULL,
  actual_quantities jsonb NOT NULL,
  discrepancies jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('matched','discrepancy')),
  correlation_id uuid NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(execution_id,workspace_id) REFERENCES executions(id,workspace_id) ON DELETE RESTRICT,
  UNIQUE(execution_id,reconciliation_version)
);
CREATE INDEX usage_reconciliations_discrepancy_idx ON usage_reconciliations(workspace_id,reconciled_at DESC) WHERE status='discrepancy';

CREATE TRIGGER usage_events_immutable BEFORE UPDATE OR DELETE ON usage_events FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();
CREATE TRIGGER usage_reconciliations_immutable BEFORE UPDATE OR DELETE ON usage_reconciliations FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_events_workspace_member ON usage_events FOR SELECT USING(account_can_access_workspace(workspace_id));
CREATE POLICY usage_reconciliations_workspace_member ON usage_reconciliations FOR SELECT USING(account_can_access_workspace(workspace_id));

