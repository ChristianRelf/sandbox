CREATE TABLE workflow_metadata (
  workflow_id TEXT PRIMARY KEY NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  favorite INTEGER NOT NULL DEFAULT 0,
  folder TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  archived_at TEXT,
  last_opened_at TEXT
);

CREATE INDEX idx_workflow_metadata_archived ON workflow_metadata(archived_at);
CREATE INDEX idx_executions_started_id ON executions(started_at DESC, id DESC);

PRAGMA user_version = 8;
