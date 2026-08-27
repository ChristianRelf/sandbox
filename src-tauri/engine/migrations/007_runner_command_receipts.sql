CREATE TABLE IF NOT EXISTS runner_command_receipts (
  command_id TEXT PRIMARY KEY NOT NULL,
  runner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('claimed','accepted','rejected','completed','expired')),
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(runner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_runner_command_receipts_expiry
  ON runner_command_receipts(expires_at, status);

PRAGMA user_version = 7;
