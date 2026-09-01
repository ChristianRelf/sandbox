CREATE TABLE IF NOT EXISTS integration_poll_cursors (
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  plugin_version TEXT NOT NULL,
  cursor_json TEXT,
  baseline_complete INTEGER NOT NULL DEFAULT 0,
  last_polled_at TEXT,
  next_poll_at TEXT,
  last_error TEXT,
  PRIMARY KEY(workflow_id,node_id,runner_id,connection_id,plugin_id,plugin_version),
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_integration_poll_due
  ON integration_poll_cursors(runner_id,next_poll_at);

CREATE TABLE IF NOT EXISTS integration_poll_dedup (
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(workflow_id,node_id,event_key),
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_integration_poll_dedup_age
  ON integration_poll_dedup(observed_at);

CREATE TABLE IF NOT EXISTS file_grants (
  id TEXT PRIMARY KEY NOT NULL,
  absolute_path TEXT NOT NULL,
  maximum_bytes INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_file_grants_expiry ON file_grants(expires_at);

PRAGMA user_version = 10;
