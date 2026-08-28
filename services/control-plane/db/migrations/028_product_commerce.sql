CREATE TABLE product_plans (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{1,49}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  audience text NOT NULL CHECK (audience IN ('individual','team','enterprise')),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  currency text CHECK (currency ~ '^[a-z]{3}$'),
  unit_amount bigint CHECK (unit_amount IS NULL OR unit_amount >= 0),
  billing_interval text CHECK (billing_interval IN ('month','year') OR billing_interval IS NULL),
  stripe_price_ref text UNIQUE,
  included_usage jsonb NOT NULL DEFAULT '{}',
  entitlements jsonb NOT NULL DEFAULT '{}',
  seat_allowance integer CHECK (seat_allowance IS NULL OR seat_allowance > 0),
  offline_grace_days integer NOT NULL CHECK (offline_grace_days BETWEEN 1 AND 90),
  local_execution_unmetered boolean NOT NULL DEFAULT true,
  overage_policy text NOT NULL DEFAULT 'blocked' CHECK (overage_policy IN ('blocked','spending_limit','contract')),
  published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((unit_amount IS NULL AND currency IS NULL AND billing_interval IS NULL AND stripe_price_ref IS NULL) OR (unit_amount IS NOT NULL AND currency IS NOT NULL AND billing_interval IS NOT NULL AND stripe_price_ref IS NOT NULL))
);

CREATE TABLE product_checkout_sessions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('personal','organisation')),
  owner_id uuid NOT NULL,
  plan_id text NOT NULL REFERENCES product_plans(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','expired')), 
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('personal','organisation')),
  owner_id uuid NOT NULL,
  plan_id text NOT NULL REFERENCES product_plans(id),
  status text NOT NULL CHECK (status IN ('trial','active','past_due','cancelled','expired')),
  stripe_customer_ref text,
  stripe_subscription_ref text UNIQUE,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_subscriptions_owner_idx ON product_subscriptions(owner_type, owner_id, updated_at DESC);

CREATE TABLE product_licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL UNIQUE REFERENCES product_subscriptions(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('personal','organisation')),
  owner_id uuid NOT NULL,
  plan_id text NOT NULL REFERENCES product_plans(id),
  status text NOT NULL CHECK (status IN ('active','past_due','expired','revoked')),
  seat_allowance integer,
  offline_grace_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_licences_owner_idx ON product_licences(owner_type, owner_id, updated_at DESC);

CREATE TABLE product_licence_seats (
  licence_id uuid NOT NULL REFERENCES product_licences(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (licence_id, account_id)
);

CREATE TABLE licensed_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_id uuid NOT NULL REFERENCES product_licences(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_public_id text NOT NULL CHECK (length(device_public_id) BETWEEN 16 AND 200),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (licence_id, device_public_id)
);

ALTER TABLE product_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_licence_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensed_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_plans_public_read ON product_plans FOR SELECT USING (published);
CREATE POLICY product_checkout_owner_read ON product_checkout_sessions USING (account_id=app_account_id());
CREATE POLICY product_subscriptions_owner_read ON product_subscriptions USING ((owner_type='personal' AND owner_id=app_account_id()) OR (owner_type='organisation' AND account_can_access_organisation(owner_id)));
CREATE POLICY product_licences_owner_read ON product_licences USING ((owner_type='personal' AND owner_id=app_account_id()) OR (owner_type='organisation' AND account_can_access_organisation(owner_id)));
CREATE POLICY product_licence_seats_owner_read ON product_licence_seats USING (account_id=app_account_id() OR EXISTS(SELECT 1 FROM product_licences licence WHERE licence.id=licence_id));
CREATE POLICY licensed_devices_owner_read ON licensed_devices USING (account_id=app_account_id() OR EXISTS(SELECT 1 FROM product_licences licence WHERE licence.id=licence_id));
