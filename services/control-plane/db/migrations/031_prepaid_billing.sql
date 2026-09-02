CREATE TYPE prepaid_wallet_entry_kind AS ENUM ('top_up','usage','refund','adjustment');

CREATE TABLE prepaid_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'usd' CHECK(currency = 'usd'),
  balance_microusd bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prepaid_topup_sessions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 500 AND 50000),
  currency text NOT NULL DEFAULT 'usd' CHECK(currency = 'usd'),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','refunded','expired')),
  payment_ref text UNIQUE,
  refunded_microusd bigint NOT NULL DEFAULT 0 CHECK(refunded_microusd >= 0),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prepaid_topup_account_idx ON prepaid_topup_sessions(account_id,created_at DESC);

CREATE TABLE prepaid_execution_charges (
  execution_id uuid PRIMARY KEY REFERENCES executions(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES prepaid_wallets(id) ON DELETE RESTRICT,
  amount_microusd bigint NOT NULL DEFAULT 0 CHECK(amount_microusd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prepaid_wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES prepaid_wallets(id) ON DELETE RESTRICT,
  kind prepaid_wallet_entry_kind NOT NULL,
  amount_microusd bigint NOT NULL CHECK(amount_microusd <> 0),
  balance_after_microusd bigint NOT NULL,
  description text NOT NULL CHECK(length(description) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 8 AND 200),
  billing_event_id text UNIQUE,
  execution_id uuid REFERENCES executions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prepaid_wallet_entries_wallet_idx ON prepaid_wallet_entries(wallet_id,created_at DESC);

CREATE TRIGGER prepaid_wallet_entries_immutable BEFORE UPDATE OR DELETE ON prepaid_wallet_entries FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();
CREATE TRIGGER prepaid_execution_charges_immutable_delete BEFORE DELETE ON prepaid_execution_charges FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();

ALTER TABLE prepaid_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE prepaid_topup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prepaid_execution_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE prepaid_wallet_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY prepaid_wallet_owner_read ON prepaid_wallets FOR SELECT USING(account_id=app_account_id());
CREATE POLICY prepaid_topup_owner_read ON prepaid_topup_sessions FOR SELECT USING(account_id=app_account_id());
CREATE POLICY prepaid_execution_charge_owner_read ON prepaid_execution_charges FOR SELECT USING(wallet_id IN (SELECT id FROM prepaid_wallets WHERE account_id=app_account_id()));
CREATE POLICY prepaid_wallet_entry_owner_read ON prepaid_wallet_entries FOR SELECT USING(wallet_id IN (SELECT id FROM prepaid_wallets WHERE account_id=app_account_id()));
