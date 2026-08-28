CREATE TABLE workspace_data_retention (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_detail_days integer NOT NULL DEFAULT 90 CHECK(execution_detail_days BETWEEN 1 AND 3650),
  queue_event_days integer NOT NULL DEFAULT 30 CHECK(queue_event_days BETWEEN 1 AND 365),
  webhook_delivery_days integer NOT NULL DEFAULT 7 CHECK(webhook_delivery_days BETWEEN 1 AND 30),
  runner_command_days integer NOT NULL DEFAULT 30 CHECK(runner_command_days BETWEEN 1 AND 365),
  audit_event_days integer NOT NULL DEFAULT 2555 CHECK(audit_event_days BETWEEN 365 AND 3650),
  changed_by uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE privacy_deletion_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status='completed'),
  deletion_summary jsonb NOT NULL,
  correlation_id text NOT NULL CHECK(length(correlation_id) BETWEEN 8 AND 128)
);
CREATE UNIQUE INDEX privacy_deletion_requests_account_idx ON privacy_deletion_requests(account_id);

CREATE FUNCTION app_is_privacy_service() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.system_role',true) IN ('privacy_service','privacy_retention_worker')
$$;
ALTER TABLE workspace_data_retention ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_data_retention_service ON workspace_data_retention USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY privacy_deletion_requests_service ON privacy_deletion_requests USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY workspaces_privacy_service ON workspaces FOR SELECT USING(app_is_privacy_service());
CREATE POLICY runners_privacy_service ON runners FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY access_tokens_privacy_service ON access_tokens FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY synced_workflows_privacy_service ON synced_workflows FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY workflow_revisions_privacy_service ON workflow_revisions FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY executions_privacy_service ON executions FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY execution_events_privacy_service ON execution_events FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY execution_checkpoints_privacy_service ON execution_checkpoints FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY queued_events_privacy_service ON queued_events FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY queue_replays_privacy_service ON queue_replays FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY webhook_deliveries_privacy_service ON webhook_deliveries FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY runner_commands_privacy_service ON runner_commands FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY audit_events_privacy_service ON audit_events FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY support_access_requests_privacy_service ON support_access_requests FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY support_access_events_privacy_service ON support_access_events FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY operational_incidents_privacy_service ON operational_incidents FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY operational_incident_events_privacy_service ON operational_incident_events FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY service_account_access_reviews_privacy_service ON service_account_access_reviews FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());
CREATE POLICY service_accounts_privacy_service ON service_accounts FOR SELECT USING(app_is_privacy_service());
CREATE POLICY service_account_owners_privacy_service ON service_account_owners FOR ALL USING(app_is_privacy_service()) WITH CHECK(app_is_privacy_service());

CREATE OR REPLACE FUNCTION reject_execution_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.system_role',true)='privacy_retention_worker' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'execution history is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.system_role',true)='privacy_retention_worker' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION enforce_operational_incident_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.system_role',true)='privacy_retention_worker' THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'operational_incidents_cannot_be_deleted'; END IF;
  IF OLD.status='reviewed' THEN RAISE EXCEPTION 'reviewed_incident_is_immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.severity<>OLD.severity OR NEW.title<>OLD.title OR NEW.owning_team<>OLD.owning_team OR NEW.customer_impact<>OLD.customer_impact OR NEW.declared_by<>OLD.declared_by OR NEW.started_at<>OLD.started_at OR NEW.correlation_id<>OLD.correlation_id THEN RAISE EXCEPTION 'incident_declaration_is_immutable'; END IF;
  IF OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN RAISE EXCEPTION 'incident_resolution_is_immutable'; END IF;
  IF NOT (NEW.status=OLD.status OR (OLD.status='investigating' AND NEW.status IN ('identified','monitoring','resolved')) OR (OLD.status='identified' AND NEW.status IN ('monitoring','resolved')) OR (OLD.status='monitoring' AND NEW.status='resolved') OR (OLD.status='resolved' AND NEW.status='reviewed')) THEN RAISE EXCEPTION 'incident_status_transition_invalid'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_support_access_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.system_role',true)='privacy_retention_worker' THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'support_access_requests_cannot_be_deleted'; END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.requested_by<>OLD.requested_by OR NEW.reason<>OLD.reason OR NEW.scopes<>OLD.scopes OR NEW.requested_at<>OLD.requested_at OR NEW.requested_until<>OLD.requested_until OR NEW.correlation_id<>OLD.correlation_id THEN RAISE EXCEPTION 'support_access_request_is_immutable'; END IF;
  IF NOT ((OLD.status='pending' AND NEW.status IN ('approved','rejected')) OR (OLD.status='approved' AND NEW.status='revoked')) THEN RAISE EXCEPTION 'support_access_transition_invalid'; END IF;
  RETURN NEW;
END;
$$;
