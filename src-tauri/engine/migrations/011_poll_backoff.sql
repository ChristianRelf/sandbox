ALTER TABLE integration_poll_cursors
  ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 11;
