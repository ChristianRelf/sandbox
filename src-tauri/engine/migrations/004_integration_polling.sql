CREATE TABLE IF NOT EXISTS integration_poll_state (
  workflow_id TEXT PRIMARY KEY NOT NULL,
  last_polled_at TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gmail_poll_processed_at ON gmail_poll_state(processed_at);

PRAGMA user_version = 4;
