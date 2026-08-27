ALTER TABLE accounts ADD COLUMN billing_customer_ref text;

CREATE TABLE marketplace_checkout_sessions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  owner_type owner_type NOT NULL,
  owner_id uuid NOT NULL,
  plugin_id text NOT NULL REFERENCES plugins(id),
  plan_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','completed','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE processed_billing_events (
  event_id text PRIMARY KEY,
  event_kind text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX entitlements_subscription_ref_idx ON entitlements(stripe_subscription_ref) WHERE stripe_subscription_ref IS NOT NULL;
CREATE INDEX marketplace_checkout_owner_idx ON marketplace_checkout_sessions(owner_type, owner_id, created_at DESC);
