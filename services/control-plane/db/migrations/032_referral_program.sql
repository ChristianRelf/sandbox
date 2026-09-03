CREATE TABLE referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE CHECK(code ~ '^[a-z0-9]{12,24}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id uuid NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
  referrer_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  referred_account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rewarded','reversed','ineligible')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  reversed_at timestamptz,
  qualifying_payment_ref text UNIQUE,
  ineligible_reason text,
  CHECK(referrer_account_id <> referred_account_id)
);
CREATE INDEX account_referrals_referrer_idx ON account_referrals(referrer_account_id,claimed_at DESC);

CREATE TABLE referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES account_referrals(id) ON DELETE RESTRICT,
  beneficiary_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_microusd bigint NOT NULL CHECK(amount_microusd > 0),
  wallet_entry_id uuid NOT NULL UNIQUE REFERENCES prepaid_wallet_entries(id) ON DELETE RESTRICT,
  reversal_wallet_entry_id uuid UNIQUE REFERENCES prepaid_wallet_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  UNIQUE(referral_id,beneficiary_account_id)
);
CREATE INDEX referral_rewards_beneficiary_idx ON referral_rewards(beneficiary_account_id,created_at DESC);

CREATE TRIGGER referral_rewards_immutable BEFORE DELETE ON referral_rewards FOR EACH ROW EXECUTE FUNCTION reject_execution_history_mutation();

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_codes_owner_read ON referral_codes FOR SELECT USING(account_id=app_account_id());
CREATE POLICY account_referrals_participant_read ON account_referrals FOR SELECT USING(referrer_account_id=app_account_id() OR referred_account_id=app_account_id());
CREATE POLICY referral_rewards_participant_read ON referral_rewards FOR SELECT USING(
  beneficiary_account_id=app_account_id()
  OR referral_id IN (SELECT id FROM account_referrals WHERE referrer_account_id=app_account_id() OR referred_account_id=app_account_id())
);
CREATE POLICY referral_codes_privacy_service ON referral_codes FOR SELECT USING(app_is_privacy_service());
CREATE POLICY account_referrals_privacy_service ON account_referrals FOR SELECT USING(app_is_privacy_service());
CREATE POLICY referral_rewards_privacy_service ON referral_rewards FOR SELECT USING(app_is_privacy_service());
