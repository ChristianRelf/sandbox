CREATE TABLE workflow_approval_votes (
  approval_id uuid NOT NULL REFERENCES workflow_approvals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  reason text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(approval_id, account_id)
);

CREATE INDEX workflow_approval_votes_decision_idx
  ON workflow_approval_votes(approval_id, decision);
