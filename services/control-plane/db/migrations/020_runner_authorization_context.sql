ALTER TABLE runner_commands ADD COLUMN authorization_context jsonb;

UPDATE runner_commands
SET status='expired', result_summary=jsonb_build_object('reason','authorization_context_missing')
WHERE status IN ('queued','delivered','accepted');

CREATE INDEX runner_commands_authorized_delivery_idx
ON runner_commands(target_runner_id,created_at)
WHERE status='queued' AND authorization_context IS NOT NULL;
