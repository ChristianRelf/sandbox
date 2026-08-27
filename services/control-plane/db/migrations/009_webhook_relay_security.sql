ALTER TABLE webhook_endpoints ADD COLUMN signing_secret_ciphertext bytea;

CREATE TABLE webhook_rate_windows (
  endpoint_id uuid PRIMARY KEY REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0)
);

CREATE INDEX webhook_endpoints_public_active_idx ON webhook_endpoints(public_id) WHERE disabled_at IS NULL;
