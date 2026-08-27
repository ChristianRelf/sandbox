CREATE TABLE api_idempotency_records (
  actor_scope text NOT NULL CHECK(actor_scope ~ '^sha256:[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 200),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[a-f0-9]{64}$'),
  owner_token uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('processing','completed')),
  response_ciphertext bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(actor_scope,idempotency_key),
  CHECK((state='processing' AND response_ciphertext IS NULL) OR (state='completed' AND response_ciphertext IS NOT NULL))
);
CREATE INDEX api_idempotency_expiry_idx ON api_idempotency_records(expires_at);
REVOKE ALL ON api_idempotency_records FROM PUBLIC;
