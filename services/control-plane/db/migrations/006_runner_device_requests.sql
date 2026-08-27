CREATE TABLE runner_request_nonces (
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(runner_id, nonce)
);

CREATE INDEX runner_request_nonces_expiry_idx ON runner_request_nonces(expires_at);
