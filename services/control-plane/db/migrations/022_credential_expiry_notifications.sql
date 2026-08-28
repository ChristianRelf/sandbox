CREATE TABLE credential_expiry_notifications (
  id uuid PRIMARY KEY,
  access_token_id uuid NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
  recipient_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reminder_days smallint NOT NULL CHECK(reminder_days IN (1,7)),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivering','failed','sent','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(access_token_id,recipient_account_id,reminder_days)
);
CREATE INDEX credential_expiry_notifications_delivery_idx
  ON credential_expiry_notifications(next_attempt_at,created_at)
  WHERE status IN ('pending','failed','delivering');

ALTER TABLE credential_expiry_notifications ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app_is_credential_expiry_notifier() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.system_role',true)='credential_expiry_notifier'
$$;
CREATE POLICY access_tokens_expiry_notifier ON access_tokens FOR SELECT USING(app_is_credential_expiry_notifier());
CREATE POLICY service_accounts_expiry_notifier ON service_accounts FOR SELECT USING(app_is_credential_expiry_notifier());
CREATE POLICY service_account_owners_expiry_notifier ON service_account_owners FOR SELECT USING(app_is_credential_expiry_notifier());
CREATE POLICY credential_expiry_notifications_worker ON credential_expiry_notifications
  USING(app_is_credential_expiry_notifier()) WITH CHECK(app_is_credential_expiry_notifier());
