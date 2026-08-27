ALTER TABLE workflow_revisions
  ADD COLUMN IF NOT EXISTS encryption_algorithm text NOT NULL DEFAULT 'aes-256-gcm'
    CHECK (encryption_algorithm = 'aes-256-gcm'),
  ADD COLUMN IF NOT EXISTS encryption_key_version integer NOT NULL DEFAULT 1
    CHECK (encryption_key_version > 0),
  ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'synced'
    CHECK (sync_state IN ('local', 'synced', 'conflicted', 'deleted'));

ALTER TABLE workflow_revisions
  ADD CONSTRAINT workflow_revisions_payload_size
    CHECK (octet_length(encrypted_payload) BETWEEN 20 AND 2250000),
  ADD CONSTRAINT workflow_revisions_key_envelope_size
    CHECK (octet_length(payload_key_envelope) BETWEEN 20 AND 768);

CREATE INDEX IF NOT EXISTS workflow_revisions_conflict_idx
  ON workflow_revisions(workflow_id, updated_at DESC)
  WHERE sync_state = 'conflicted';
