-- Stage 1 keeps runtime details inside the immutable JSON execution snapshot,
-- but advances the database version so downgrade/upgrade boundaries remain
-- explicit. Pinned development fixtures stay in workflow revisions and are
-- never consulted by production execution.
PRAGMA user_version = 12;
