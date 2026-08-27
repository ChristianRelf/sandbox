CREATE TABLE workflow_schedules (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  deployment_id uuid NOT NULL REFERENCES workflow_deployments(id) ON DELETE CASCADE,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  schedule_type text NOT NULL CHECK(schedule_type IN ('interval','calendar','cron')),
  schedule_spec jsonb NOT NULL,
  time_zone text NOT NULL,
  dst_policy text NOT NULL CHECK(dst_policy IN ('skip','run_once','run_twice')),
  start_at timestamptz,
  end_at timestamptz,
  misfire_policy text NOT NULL CHECK(misfire_policy IN ('queue','skip','expire','fallback_pool')),
  misfire_grace_seconds integer NOT NULL CHECK(misfire_grace_seconds>=0),
  jitter_seconds integer NOT NULL CHECK(jitter_seconds BETWEEN 0 AND 86400),
  concurrency_policy text NOT NULL CHECK(concurrency_policy IN ('skip_new','queue_new','cancel_previous','bounded_parallel')),
  maximum_parallel integer NOT NULL CHECK(maximum_parallel BETWEEN 1 AND 1000),
  no_runner_policy jsonb NOT NULL,
  routing_requirements jsonb NOT NULL,
  encrypted_payload_reference text NOT NULL,
  paused_at timestamptz,
  next_run_at timestamptz,
  last_scheduled_at timestamptz,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK(end_at IS NULL OR start_at IS NULL OR end_at>start_at)
);
CREATE INDEX workflow_schedules_due_idx ON workflow_schedules(next_run_at) WHERE paused_at IS NULL AND next_run_at IS NOT NULL;
CREATE INDEX workflow_schedules_workspace_idx ON workflow_schedules(workspace_id,updated_at DESC);

CREATE TABLE queued_events (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  original_event_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_revision_id uuid NOT NULL REFERENCES workflow_revisions(id) ON DELETE RESTRICT,
  deployment_id uuid REFERENCES workflow_deployments(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  trigger_reference text,
  created_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  expires_at timestamptz,
  attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0),
  maximum_attempts integer NOT NULL CHECK(maximum_attempts BETWEEN 1 AND 100),
  idempotency_key text NOT NULL,
  routing_requirements jsonb NOT NULL,
  encrypted_payload_reference text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','claimed','retrying','completed','expired','dead_letter')),
  priority integer NOT NULL DEFAULT 0,
  claim_token_hash bytea,
  claimed_by text,
  visibility_expires_at timestamptz,
  failure_fingerprint text,
  repeated_failure_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  correlation_id uuid NOT NULL,
  UNIQUE(workspace_id,idempotency_key)
);
CREATE INDEX queued_events_claim_idx ON queued_events(priority DESC,available_at,created_at) WHERE status IN ('queued','retrying');
CREATE INDEX queued_events_visibility_idx ON queued_events(visibility_expires_at) WHERE status='claimed';
CREATE INDEX queued_events_workspace_idx ON queued_events(workspace_id,created_at DESC);

CREATE TABLE schedule_emissions (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES workflow_schedules(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  queued_event_id uuid REFERENCES queued_events(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK(outcome IN ('queued','skipped','expired')),
  reason text,
  emitted_at timestamptz NOT NULL,
  UNIQUE(schedule_id,scheduled_for)
);

CREATE TABLE queue_attempt_events (
  id uuid PRIMARY KEY,
  queued_event_id uuid NOT NULL REFERENCES queued_events(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('claimed','completed','retry','dead_letter','expired','visibility_timeout')),
  worker_id text,
  error_fingerprint text,
  detail jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL
);
CREATE INDEX queue_attempt_events_timeline_idx ON queue_attempt_events(queued_event_id,occurred_at);
CREATE TRIGGER queue_attempt_events_immutable BEFORE UPDATE OR DELETE ON queue_attempt_events FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();

CREATE TABLE queue_replays (
  id uuid PRIMARY KEY,
  original_queue_event_id uuid NOT NULL REFERENCES queued_events(id) ON DELETE RESTRICT,
  replay_queue_event_id uuid NOT NULL UNIQUE REFERENCES queued_events(id) ON DELETE RESTRICT,
  original_event_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES accounts(id),
  reason text NOT NULL,
  requested_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL
);
CREATE TRIGGER queue_replays_immutable BEFORE UPDATE OR DELETE ON queue_replays FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();

ALTER TABLE workflow_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE queued_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_emissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_attempt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_replays ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedules_workspace_member ON workflow_schedules USING(account_can_access_workspace(workspace_id));
CREATE POLICY queue_workspace_member ON queued_events USING(account_can_access_workspace(workspace_id));
CREATE POLICY emissions_workspace_member ON schedule_emissions USING(EXISTS(SELECT 1 FROM workflow_schedules schedule WHERE schedule.id=schedule_id AND account_can_access_workspace(schedule.workspace_id)));
CREATE POLICY queue_attempts_workspace_member ON queue_attempt_events USING(EXISTS(SELECT 1 FROM queued_events event WHERE event.id=queued_event_id AND account_can_access_workspace(event.workspace_id)));
CREATE POLICY queue_replays_workspace_member ON queue_replays USING(EXISTS(SELECT 1 FROM queued_events event WHERE event.id=original_queue_event_id AND account_can_access_workspace(event.workspace_id)));
