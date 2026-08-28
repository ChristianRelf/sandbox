CREATE TABLE operational_incidents (
  id uuid PRIMARY KEY,
  severity text NOT NULL CHECK(severity IN ('sev1','sev2','sev3','sev4')),
  title text NOT NULL CHECK(length(title) BETWEEN 3 AND 200),
  owning_team text NOT NULL CHECK(length(owning_team) BETWEEN 2 AND 100),
  customer_impact text NOT NULL CHECK(length(customer_impact) BETWEEN 1 AND 2000),
  status text NOT NULL CHECK(status IN ('investigating','identified','monitoring','resolved','reviewed')),
  declared_by uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  resolved_at timestamptz,
  reviewed_at timestamptz,
  post_incident_report jsonb,
  correlation_id uuid NOT NULL,
  CHECK((status NOT IN ('resolved','reviewed') AND resolved_at IS NULL) OR (status IN ('resolved','reviewed') AND resolved_at IS NOT NULL)),
  CHECK((status<>'reviewed' AND reviewed_at IS NULL AND post_incident_report IS NULL) OR (status='reviewed' AND reviewed_at IS NOT NULL AND post_incident_report IS NOT NULL))
);

CREATE TABLE operational_incident_events (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES operational_incidents(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK(sequence>0),
  event_type text NOT NULL CHECK(event_type IN ('declared','update','status_changed','resolved','review_published')),
  status_snapshot text NOT NULL CHECK(status_snapshot IN ('investigating','identified','monitoring','resolved','reviewed')),
  message text NOT NULL CHECK(length(message) BETWEEN 1 AND 4000),
  public_update boolean NOT NULL DEFAULT false,
  actor_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  UNIQUE(incident_id,sequence)
);
CREATE INDEX operational_incidents_status_started_idx ON operational_incidents(status,started_at DESC);
CREATE INDEX operational_incident_events_timeline_idx ON operational_incident_events(incident_id,sequence);

CREATE FUNCTION enforce_operational_incident_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'operational_incidents_cannot_be_deleted'; END IF;
  IF OLD.status='reviewed' THEN RAISE EXCEPTION 'reviewed_incident_is_immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.severity<>OLD.severity OR NEW.title<>OLD.title OR NEW.owning_team<>OLD.owning_team OR NEW.customer_impact<>OLD.customer_impact OR NEW.declared_by<>OLD.declared_by OR NEW.started_at<>OLD.started_at OR NEW.correlation_id<>OLD.correlation_id THEN
    RAISE EXCEPTION 'incident_declaration_is_immutable';
  END IF;
  IF OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN RAISE EXCEPTION 'incident_resolution_is_immutable'; END IF;
  IF NOT (
    NEW.status=OLD.status OR
    (OLD.status='investigating' AND NEW.status IN ('identified','monitoring','resolved')) OR
    (OLD.status='identified' AND NEW.status IN ('monitoring','resolved')) OR
    (OLD.status='monitoring' AND NEW.status='resolved') OR
    (OLD.status='resolved' AND NEW.status='reviewed')
  ) THEN RAISE EXCEPTION 'incident_status_transition_invalid'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operational_incidents_lifecycle BEFORE UPDATE OR DELETE ON operational_incidents FOR EACH ROW EXECUTE FUNCTION enforce_operational_incident_lifecycle();
CREATE TRIGGER operational_incident_events_append_only BEFORE UPDATE OR DELETE ON operational_incident_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE FUNCTION app_is_incident_operator() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.system_role',true)='incident_operator'
$$;
ALTER TABLE operational_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_incident_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY operational_incidents_operator ON operational_incidents USING(app_is_incident_operator()) WITH CHECK(app_is_incident_operator());
CREATE POLICY operational_incident_events_operator ON operational_incident_events USING(app_is_incident_operator()) WITH CHECK(app_is_incident_operator());
