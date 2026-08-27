ALTER TABLE plugin_ratings ALTER COLUMN installation_id DROP NOT NULL;

CREATE TABLE plugin_rating_reports (
  rating_id uuid NOT NULL REFERENCES plugin_ratings(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY(rating_id, reported_by)
);

CREATE INDEX plugin_rating_reports_moderation_idx ON plugin_rating_reports(status, created_at);
