CREATE TABLE shared_connection_runner_deployments (
  connection_id uuid NOT NULL REFERENCES shared_connections(id) ON DELETE CASCADE,
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('authorization_required','available','unavailable')),
  local_credential_label text,
  changed_by uuid NOT NULL REFERENCES accounts(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(connection_id, runner_id)
);

CREATE INDEX shared_connection_deployments_runner_idx
  ON shared_connection_runner_deployments(runner_id, status);
