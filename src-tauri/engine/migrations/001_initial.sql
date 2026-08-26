CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  trigger_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  trigger_json TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  node_executions_json TEXT NOT NULL DEFAULT '[]',
  error_json TEXT,
  skip_reason TEXT,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_executions_workflow_started
  ON executions(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_status
  ON executions(status);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  previous_json TEXT,
  current_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

PRAGMA user_version = 1;
