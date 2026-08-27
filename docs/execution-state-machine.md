# Durable execution state machine

## States

```text
queued -> waiting_for_runner -> claimed -> starting -> running -> succeeded
             |                    |          |          |
             |                    |          |          +-> waiting_for_approval
             |                    |          +------------> retrying
             |                    +-----------------------> lost
             +--------------------------------------------> cancelling -> cancelled

Any applicable non-terminal state may reach failed, timed_out or expired only through an allowed transition.
Skipped is terminal. Terminal states cannot be reopened by a runner.
```

The complete state set is queued, waiting for runner, claimed, starting, running, waiting for approval, retrying, cancelling, succeeded, failed, timed out, skipped, cancelled, lost and expired.

## Storage invariants

- `executions` is the current projection and carries a monotonic `state_version`.
- `execution_events` is append-only, ordered by per-execution sequence and idempotent by transition UUID.
- the database trigger locks the projection, checks expected version/from-state, validates the transition and atomically updates the projection;
- runner events additionally require the assigned runner and a current unexpired lease;
- runners cannot mark themselves lost or rewrite terminal state;
- execution/checkpoint history rejects update and delete operations;
- correlation ID, actor/account/runner, reason, metadata and occurrence time are recorded for every transition.

Application validation produces domain errors before the insert; database validation is the final concurrency and integrity boundary.

## Checkpoints

A checkpoint is appended after every completed node and contains execution/revision, node and node version, attempt, result status, input hash, output reference, side-effect classification, idempotency key, completion time and runner identity. `(execution, node, attempt)` is unique. Temporary browser session identifiers are not resumable output references.

## Lease expiry and recovery

1. Release the expired lease and mark the execution `lost`.
2. Record outcome certainty and the proposed recovery disposition.
3. Inspect the last immutable checkpoint and the interrupted node.
4. Resume only when the interruption is side-effect-free, explicitly safe to retry, or idempotent with a reusable key.
5. If an unsafe/unknown external action may have completed, set certainty to uncertain and disposition to review required.
6. Do not return review-required lost work to the claim query.
7. An authorized operator may later resolve it as resume, restart or abandon; that decision is another audited transition.

The user-facing result must identify whether work resumed, restarted, was abandoned or required manual resolution. No interface may call this exactly once.

