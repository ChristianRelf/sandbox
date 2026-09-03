CREATE TABLE IF NOT EXISTS loop_iteration_checkpoints (
  execution_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  iteration_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  status TEXT NOT NULL CHECK(status IN ('active','completed','failed','uncertain')),
  batch_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(execution_id,node_id,iteration_id)
);
CREATE INDEX IF NOT EXISTS loop_iteration_checkpoints_execution_idx ON loop_iteration_checkpoints(execution_id,node_id,updated_at);
PRAGMA user_version = 13;
