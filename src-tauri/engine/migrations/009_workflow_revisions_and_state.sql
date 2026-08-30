CREATE TABLE IF NOT EXISTS workflow_revisions (
  revision_id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  parent_revision_id TEXT,
  schema_version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_revision_id) REFERENCES workflow_revisions(revision_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_revisions_workflow_created
  ON workflow_revisions(workflow_id, created_at DESC, revision_id DESC);

CREATE TABLE IF NOT EXISTS workflow_revision_heads (
  workflow_id TEXT PRIMARY KEY NOT NULL,
  revision_id TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  FOREIGN KEY(revision_id) REFERENCES workflow_revisions(revision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workflow_state (
  workflow_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workflow_id, state_key),
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

PRAGMA user_version = 9;
