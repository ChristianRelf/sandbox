CREATE TABLE executions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  deployment_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES synced_workflows(id) ON DELETE RESTRICT,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  trigger_type text NOT NULL,
  trigger_reference text,
  queue_event_id uuid,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','waiting_for_runner','claimed','starting','running','waiting_for_approval','retrying','cancelling','succeeded','failed','timed_out','skipped','cancelled','lost','expired')),
  state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  outcome_certainty text NOT NULL DEFAULT 'certain' CHECK (outcome_certainty IN ('certain','uncertain')),
  recovery_disposition text CHECK (recovery_disposition IS NULL OR recovery_disposition IN ('resume','restart','review_required','abandon')),
  recovery_detail jsonb,
  assigned_runner_id uuid REFERENCES runners(id) ON DELETE SET NULL,
  runner_pool_id uuid,
  permission_snapshot_id uuid NOT NULL,
  plugin_versions jsonb NOT NULL DEFAULT '[]',
  connection_references jsonb NOT NULL DEFAULT '[]',
  routing_requirements jsonb NOT NULL,
  encrypted_payload_reference text NOT NULL,
  interrupted_node jsonb,
  correlation_id uuid NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  queued_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  timeout_at timestamptz NOT NULL,
  last_progress_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, idempotency_key)
);
CREATE INDEX executions_dispatch_idx ON executions(status, queued_at, timeout_at) WHERE status IN ('queued','waiting_for_runner','retrying','lost');
CREATE INDEX executions_workspace_recent_idx ON executions(workspace_id, created_at DESC);
CREATE INDEX executions_runner_active_idx ON executions(assigned_runner_id, status) WHERE status IN ('claimed','starting','running','waiting_for_approval','retrying','cancelling');

CREATE TABLE execution_leases (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE RESTRICT,
  generation integer NOT NULL CHECK (generation > 0),
  token_hash bytea NOT NULL,
  issued_at timestamptz NOT NULL,
  renewed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  CHECK (expires_at > issued_at),
  UNIQUE(execution_id, generation)
);
CREATE UNIQUE INDEX execution_leases_one_active_idx ON execution_leases(execution_id) WHERE released_at IS NULL;
CREATE INDEX execution_leases_expiry_idx ON execution_leases(expires_at) WHERE released_at IS NULL;

CREATE TABLE execution_events (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  from_state text NOT NULL,
  to_state text NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  actor_type text NOT NULL CHECK (actor_type IN ('system','account','runner')),
  actor_id uuid,
  runner_id uuid REFERENCES runners(id) ON DELETE SET NULL,
  lease_id uuid REFERENCES execution_leases(id) ON DELETE SET NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id, sequence)
);
CREATE INDEX execution_events_timeline_idx ON execution_events(execution_id, sequence);

CREATE TABLE execution_checkpoints (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  node_id text NOT NULL,
  node_version integer NOT NULL CHECK (node_version > 0),
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('completed','failed')),
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[a-f0-9]{64}$'),
  output_reference text,
  side_effect_classification text NOT NULL CHECK (side_effect_classification IN ('none','idempotent','safe_retry','unsafe','unknown')),
  idempotency_key text,
  completed_at timestamptz NOT NULL,
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id, node_id, attempt)
);
CREATE INDEX execution_checkpoints_resume_idx ON execution_checkpoints(execution_id, completed_at DESC);

CREATE FUNCTION execution_transition_allowed(previous text, next text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE previous
    WHEN 'queued' THEN next = ANY(ARRAY['waiting_for_runner','cancelling','skipped','cancelled','expired'])
    WHEN 'waiting_for_runner' THEN next = ANY(ARRAY['claimed','cancelling','skipped','cancelled','expired'])
    WHEN 'claimed' THEN next = ANY(ARRAY['starting','waiting_for_runner','cancelling','lost','expired'])
    WHEN 'starting' THEN next = ANY(ARRAY['running','waiting_for_approval','retrying','cancelling','failed','timed_out','lost'])
    WHEN 'running' THEN next = ANY(ARRAY['waiting_for_approval','retrying','cancelling','succeeded','failed','timed_out','lost'])
    WHEN 'waiting_for_approval' THEN next = ANY(ARRAY['running','retrying','cancelling','failed','cancelled','expired','lost'])
    WHEN 'retrying' THEN next = ANY(ARRAY['waiting_for_runner','claimed','starting','running','cancelling','failed','timed_out','lost','expired'])
    WHEN 'cancelling' THEN next = ANY(ARRAY['cancelled','failed','timed_out','lost'])
    WHEN 'lost' THEN next = ANY(ARRAY['waiting_for_runner','retrying','failed','cancelled','expired'])
    ELSE false
  END
$$;

CREATE FUNCTION apply_execution_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_execution executions%ROWTYPE;
  active_lease execution_leases%ROWTYPE;
BEGIN
  SELECT * INTO current_execution FROM executions WHERE id = NEW.execution_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'execution_not_found'; END IF;
  IF current_execution.state_version <> NEW.expected_version OR current_execution.status <> NEW.from_state THEN
    RAISE EXCEPTION 'execution_transition_conflict';
  END IF;
  IF NOT execution_transition_allowed(NEW.from_state, NEW.to_state) THEN
    RAISE EXCEPTION 'execution_transition_invalid: % -> %', NEW.from_state, NEW.to_state;
  END IF;
  IF NEW.actor_type = 'account' AND NEW.actor_id IS NULL THEN RAISE EXCEPTION 'execution_actor_required'; END IF;
  IF NEW.actor_type = 'runner' THEN
    IF NEW.runner_id IS NULL OR NEW.lease_id IS NULL OR current_execution.assigned_runner_id IS DISTINCT FROM NEW.runner_id THEN
      RAISE EXCEPTION 'execution_runner_or_lease_invalid';
    END IF;
    SELECT * INTO active_lease FROM execution_leases WHERE id=NEW.lease_id AND execution_id=NEW.execution_id AND runner_id=NEW.runner_id AND released_at IS NULL FOR UPDATE;
    IF NOT FOUND OR active_lease.expires_at <= NEW.occurred_at THEN RAISE EXCEPTION 'execution_lease_invalid_or_expired'; END IF;
    IF NEW.to_state = 'lost' THEN RAISE EXCEPTION 'execution_lost_system_only'; END IF;
  END IF;
  NEW.sequence := current_execution.state_version + 1;
  UPDATE executions SET
    status=NEW.to_state,
    state_version=state_version+1,
    outcome_certainty=CASE WHEN NEW.to_state='lost' AND COALESCE(NEW.metadata->>'certainty','uncertain')='uncertain' THEN 'uncertain' ELSE outcome_certainty END,
    recovery_disposition=COALESCE(NEW.metadata->>'recoveryDisposition', recovery_disposition),
    recovery_detail=CASE WHEN NEW.metadata ? 'recovery' THEN NEW.metadata->'recovery' ELSE recovery_detail END,
    started_at=CASE WHEN NEW.to_state IN ('starting','running') THEN COALESCE(started_at,NEW.occurred_at) ELSE started_at END,
    completed_at=CASE WHEN NEW.to_state IN ('succeeded','failed','timed_out','skipped','cancelled','expired') THEN NEW.occurred_at ELSE completed_at END,
    last_progress_at=NEW.occurred_at
  WHERE id=NEW.execution_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER execution_events_apply BEFORE INSERT ON execution_events FOR EACH ROW EXECUTE FUNCTION apply_execution_transition();

CREATE FUNCTION reject_execution_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'execution history is append-only';
END;
$$;
CREATE TRIGGER execution_events_immutable BEFORE UPDATE OR DELETE ON execution_events FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();
CREATE TRIGGER execution_checkpoints_immutable BEFORE UPDATE OR DELETE ON execution_checkpoints FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();

ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY executions_workspace_member ON executions USING (account_can_access_workspace(workspace_id));
CREATE POLICY execution_leases_workspace_member ON execution_leases USING (EXISTS(SELECT 1 FROM executions execution WHERE execution.id=execution_id AND account_can_access_workspace(execution.workspace_id)));
CREATE POLICY execution_events_workspace_member ON execution_events USING (EXISTS(SELECT 1 FROM executions execution WHERE execution.id=execution_id AND account_can_access_workspace(execution.workspace_id)));
CREATE POLICY execution_checkpoints_workspace_member ON execution_checkpoints USING (EXISTS(SELECT 1 FROM executions execution WHERE execution.id=execution_id AND account_can_access_workspace(execution.workspace_id)));
