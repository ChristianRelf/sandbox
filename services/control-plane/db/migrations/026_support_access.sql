CREATE TABLE support_access_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 2000),
  scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 10 AND scopes <@ ARRAY['diagnostics.read']::text[]),
  requested_at timestamptz NOT NULL,
  requested_until timestamptz NOT NULL CHECK(requested_until>requested_at AND requested_until<=requested_at+interval '8 hours'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
  decided_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  rationale text,
  revoked_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  correlation_id text NOT NULL CHECK(length(correlation_id) BETWEEN 8 AND 128),
  CHECK(requested_by IS DISTINCT FROM decided_by),
  CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL AND rationale IS NULL AND revoked_by IS NULL AND revoked_at IS NULL) OR
        (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(rationale) BETWEEN 1 AND 2000 AND revoked_by IS NULL AND revoked_at IS NULL) OR
        (status='revoked' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX support_access_workspace_time_idx ON support_access_requests(workspace_id,requested_at DESC);
CREATE INDEX support_access_active_idx ON support_access_requests(requested_by,requested_until) WHERE status='approved';

CREATE TABLE support_access_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES support_access_requests(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK(sequence>0),
  event_type text NOT NULL CHECK(event_type IN ('requested','approved','rejected','revoked','diagnostics_accessed')),
  actor_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  scope text,
  resource_summary text NOT NULL CHECK(length(resource_summary) BETWEEN 1 AND 500),
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL CHECK(length(correlation_id) BETWEEN 8 AND 128),
  UNIQUE(request_id,sequence)
);
CREATE INDEX support_access_events_request_time_idx ON support_access_events(request_id,occurred_at,id);

CREATE FUNCTION enforce_support_access_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'support_access_requests_cannot_be_deleted'; END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.requested_by<>OLD.requested_by OR NEW.reason<>OLD.reason OR NEW.scopes<>OLD.scopes OR NEW.requested_at<>OLD.requested_at OR NEW.requested_until<>OLD.requested_until OR NEW.correlation_id<>OLD.correlation_id THEN RAISE EXCEPTION 'support_access_request_is_immutable'; END IF;
  IF NOT ((OLD.status='pending' AND NEW.status IN ('approved','rejected')) OR (OLD.status='approved' AND NEW.status='revoked')) THEN RAISE EXCEPTION 'support_access_transition_invalid'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_access_request_lifecycle BEFORE UPDATE OR DELETE ON support_access_requests FOR EACH ROW EXECUTE FUNCTION enforce_support_access_lifecycle();
CREATE TRIGGER support_access_events_append_only BEFORE UPDATE OR DELETE ON support_access_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE FUNCTION app_is_support_access_service() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.system_role',true)='support_access_service'
$$;
ALTER TABLE support_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_access_requests_service ON support_access_requests USING(app_is_support_access_service()) WITH CHECK(app_is_support_access_service());
CREATE POLICY support_access_events_service ON support_access_events USING(app_is_support_access_service()) WITH CHECK(app_is_support_access_service());
