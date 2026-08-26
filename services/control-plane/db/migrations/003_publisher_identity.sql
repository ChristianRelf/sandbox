ALTER TABLE publishers ADD COLUMN IF NOT EXISTS public_id text;
UPDATE publishers SET public_id = concat('publisher.', replace(id::text, '-', '')) WHERE public_id IS NULL;
ALTER TABLE publishers ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE publishers ADD CONSTRAINT publishers_public_id_format CHECK (public_id ~ '^[a-z0-9]+([.-][a-z0-9]+)+$');
CREATE UNIQUE INDEX IF NOT EXISTS publishers_public_id_idx ON publishers(public_id);

CREATE INDEX IF NOT EXISTS publisher_members_account_idx ON publisher_members(account_id, publisher_id, permission);
CREATE INDEX IF NOT EXISTS plugin_versions_plugin_version_integrity_idx ON plugin_versions(plugin_id, version, package_integrity);

CREATE TABLE IF NOT EXISTS platform_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_account_id uuid REFERENCES accounts(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}',
  correlation_id uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS platform_audit_events_resource_idx ON platform_audit_events(resource_type, resource_id, occurred_at DESC);
