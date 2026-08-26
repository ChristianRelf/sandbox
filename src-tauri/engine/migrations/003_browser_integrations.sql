CREATE TABLE IF NOT EXISTS browser_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  persistent INTEGER NOT NULL DEFAULT 1,
  data_path TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_identifier TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS workflow_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_schema_version INTEGER NOT NULL,
  approval_kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  permission_revision TEXT,
  approved_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_workflow ON workflow_approvals(workflow_id, approval_kind);

CREATE TABLE IF NOT EXISTS pending_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  action_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON pending_approvals(status, expires_at);

CREATE TABLE IF NOT EXISTS browser_diagnostics (
  id TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  diagnostic_json TEXT NOT NULL,
  screenshot_path TEXT,
  trace_path TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recorded_workflow_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_metadata (
  template_key TEXT PRIMARY KEY NOT NULL,
  metadata_json TEXT NOT NULL,
  installed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gmail_poll_state (
  workflow_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY(workflow_id, message_id),
  FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artifact_retention (
  id TEXT PRIMARY KEY NOT NULL,
  artifact_type TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

PRAGMA user_version = 3;
