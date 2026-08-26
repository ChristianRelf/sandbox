CREATE TABLE IF NOT EXISTS schedule_state (
  workflow_id TEXT PRIMARY KEY NOT NULL,
  next_run_at TEXT,
  last_checked_at TEXT,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

ALTER TABLE executions ADD COLUMN recovered_after_crash INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 2;
