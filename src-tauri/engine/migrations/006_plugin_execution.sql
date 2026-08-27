ALTER TABLE installed_plugins ADD COLUMN publisher_public_key_pem TEXT;

CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  publisher_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  major_version INTEGER NOT NULL DEFAULT 0,
  temporary_execution_id TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL,
  value BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(
    plugin_id,
    publisher_id,
    owner_id,
    workspace_id,
    major_version,
    temporary_execution_id,
    storage_key
  )
);

CREATE INDEX IF NOT EXISTS idx_plugin_storage_owner
  ON plugin_storage(owner_id, workspace_id, publisher_id, plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_storage_temporary
  ON plugin_storage(temporary_execution_id)
  WHERE temporary_execution_id != '';

PRAGMA user_version = 6;
