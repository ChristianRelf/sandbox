# Durable scheduler and event queue

The stage-four scheduler is an independently deployable service. It computes interval, calendar, and cron occurrences in the configured IANA time zone and persists each emission before a worker can claim it. PostgreSQL advisory locking elects one scheduler transaction at a time, while row locks and the `(schedule_id, scheduled_for)` constraint prevent duplicate emission after restarts or overlapping ticks.

Schedules explicitly define daylight-saving, misfire, jitter, concurrency, and no-runner behaviour. Spring-forward wall times that do not exist are not silently shifted. Operators can backfill a bounded date range; an existing occurrence is not emitted again.

Queued events use at-least-once delivery. A claim has a short, hashed visibility token; expired claims return to the queue and add an immutable attempt-history event. Retries use exponential backoff with deterministic jitter. The queue sends events to the dead-letter state after the configured attempt bound or three identical failures, which limits poison-event churn.

Administrative replay is explicit and audited. A replay creates a new queue row and correlation ID while preserving the original logical event identity. It has a new idempotency key so the original delivery record remains immutable. Replaying an event does not imply that an external side effect is safe; execution recovery policy still governs node replay.

The durable queue is used for schedule emissions and is designed for webhook events, remote commands, approval continuations, retry events, and plugin lifecycle events. Payloads are referenced through encrypted storage rather than stored inline. Every row carries workspace, workflow revision, routing requirements, expiry, attempts, and correlation identity.
