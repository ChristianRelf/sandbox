ALTER TABLE runner_pairing_challenges
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';

CREATE INDEX runner_pairing_challenges_expiry_idx
  ON runner_pairing_challenges(expires_at)
  WHERE consumed_at IS NULL;
