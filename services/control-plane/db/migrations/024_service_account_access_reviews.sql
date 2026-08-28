ALTER TABLE service_accounts
  ADD COLUMN access_review_interval_days integer NOT NULL DEFAULT 90 CHECK(access_review_interval_days BETWEEN 30 AND 365),
  ADD COLUMN next_access_review_at timestamptz,
  ADD COLUMN suspension_reason text CHECK(suspension_reason IS NULL OR suspension_reason='access_review_overdue');
UPDATE service_accounts SET next_access_review_at=created_at+interval '90 days' WHERE next_access_review_at IS NULL;
ALTER TABLE service_accounts ALTER COLUMN next_access_review_at SET NOT NULL;
ALTER TABLE service_accounts ALTER COLUMN next_access_review_at SET DEFAULT (now()+interval '90 days');
ALTER TABLE service_accounts ADD CONSTRAINT service_accounts_suspension_reason_status CHECK(suspension_reason IS NULL OR status='suspended');

CREATE TABLE service_account_access_reviews (
  id uuid PRIMARY KEY,
  service_account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL CHECK(due_at>opened_at),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','overdue','retained','revoked')),
  access_snapshot jsonb NOT NULL,
  decided_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  rationale text,
  CHECK((status IN ('pending','overdue') AND decided_by IS NULL AND decided_at IS NULL AND rationale IS NULL) OR (status IN ('retained','revoked') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(rationale) BETWEEN 1 AND 2000))
);
CREATE UNIQUE INDEX service_account_access_reviews_open_idx ON service_account_access_reviews(service_account_id) WHERE status IN ('pending','overdue');
CREATE INDEX service_account_access_reviews_due_idx ON service_account_access_reviews(due_at) WHERE status='pending';

CREATE FUNCTION enforce_access_review_evidence_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('retained','revoked') THEN RAISE EXCEPTION 'access_review_decision_is_immutable'; END IF;
  IF NEW.service_account_id<>OLD.service_account_id OR NEW.organisation_id<>OLD.organisation_id OR NEW.opened_at<>OLD.opened_at OR NEW.due_at<>OLD.due_at OR NEW.access_snapshot<>OLD.access_snapshot THEN
    RAISE EXCEPTION 'access_review_evidence_is_immutable';
  END IF;
  IF (OLD.status='pending' AND NEW.status NOT IN ('pending','overdue','retained','revoked')) OR (OLD.status='overdue' AND NEW.status NOT IN ('overdue','retained','revoked')) THEN
    RAISE EXCEPTION 'access_review_status_transition_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER service_account_access_review_evidence_immutable BEFORE UPDATE ON service_account_access_reviews FOR EACH ROW EXECUTE FUNCTION enforce_access_review_evidence_immutability();

ALTER TABLE service_account_access_reviews ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION app_is_access_review_worker() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.system_role',true)='service_account_access_review_worker'
$$;
CREATE POLICY service_account_access_reviews_manager ON service_account_access_reviews USING(
  EXISTS(SELECT 1 FROM service_account_role_assignments assignment WHERE assignment.service_account_id=service_account_access_reviews.service_account_id)
  AND NOT EXISTS(
    SELECT 1 FROM service_account_role_assignments assignment
    WHERE assignment.service_account_id=service_account_access_reviews.service_account_id AND NOT account_has_workspace_permission(assignment.workspace_id,'service_accounts.manage')
  )
);
CREATE POLICY service_account_access_reviews_worker ON service_account_access_reviews
  USING(app_is_access_review_worker()) WITH CHECK(app_is_access_review_worker());
CREATE POLICY service_accounts_access_review_worker ON service_accounts USING(app_is_access_review_worker()) WITH CHECK(app_is_access_review_worker());
CREATE POLICY service_account_assignments_access_review_worker ON service_account_role_assignments FOR SELECT USING(app_is_access_review_worker());
CREATE POLICY service_account_owners_access_review_worker ON service_account_owners FOR SELECT USING(app_is_access_review_worker());
CREATE POLICY access_tokens_access_review_worker ON access_tokens USING(app_is_access_review_worker()) WITH CHECK(app_is_access_review_worker());
CREATE POLICY runner_commands_access_review_worker ON runner_commands FOR UPDATE USING(app_is_access_review_worker()) WITH CHECK(app_is_access_review_worker());
