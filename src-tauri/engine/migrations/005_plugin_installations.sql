CREATE TABLE IF NOT EXISTS installed_plugins (
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  package_integrity TEXT NOT NULL,
  publisher_id TEXT NOT NULL,
  publisher_key_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('personal', 'workspace')),
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('marketplace', 'private', 'development')),
  development INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'disabled' CHECK(state IN ('disabled', 'enabled', 'revoked')),
  manifest_json TEXT NOT NULL,
  requested_permissions_json TEXT NOT NULL,
  approved_permissions_json TEXT NOT NULL DEFAULT '[]',
  update_requires_review INTEGER NOT NULL DEFAULT 0,
  package_path TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(plugin_id, version, package_integrity, owner_type, owner_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_plugins_owner_version
  ON installed_plugins(owner_type, owner_id, plugin_id, version);
CREATE INDEX IF NOT EXISTS idx_installed_plugins_owner_state
  ON installed_plugins(owner_type, owner_id, state, plugin_id);
CREATE INDEX IF NOT EXISTS idx_installed_plugins_integrity
  ON installed_plugins(package_integrity);

CREATE TABLE IF NOT EXISTS plugin_revocations (
  id TEXT PRIMARY KEY NOT NULL,
  plugin_id TEXT NOT NULL,
  version TEXT,
  package_integrity TEXT,
  reason TEXT NOT NULL,
  security_notice_url TEXT,
  revoked_at TEXT NOT NULL,
  CHECK(version IS NOT NULL OR package_integrity IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_plugin_revocations_plugin
  ON plugin_revocations(plugin_id, version);
CREATE INDEX IF NOT EXISTS idx_plugin_revocations_integrity
  ON plugin_revocations(package_integrity);

CREATE TABLE IF NOT EXISTS plugin_permission_audit (
  id TEXT PRIMARY KEY NOT NULL,
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  package_integrity TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  previous_permissions_json TEXT NOT NULL,
  approved_permissions_json TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  FOREIGN KEY(plugin_id, version, package_integrity, owner_type, owner_id)
    REFERENCES installed_plugins(plugin_id, version, package_integrity, owner_type, owner_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plugin_permission_audit_install
  ON plugin_permission_audit(owner_type, owner_id, plugin_id, approved_at DESC);

PRAGMA user_version = 5;
