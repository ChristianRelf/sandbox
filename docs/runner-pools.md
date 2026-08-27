# Runner pools and routing

A runner pool is scoped to one workspace and environment. Membership never broadens a runner's workspace authority: the database constrains pool-backed executions and deployments to the same workspace/environment tuple, and a runner may claim pooled work only while it is an enabled member of an active pool.

Routing first applies the full protocol-v2 compatibility check, then pool policy. Candidates must be online, recently heartbeating, below their own concurrency limit, in the configured region, and carry every required pool tag. Pool concurrency is an aggregate ceiling and reserves the assignment's requested capacity before selection.

The supported strategies are:

- `least_loaded`: lowest workload-to-capacity ratio, then member priority and runner ID;
- `round_robin`: stable runner-ID order with a durable cursor;
- `priority_failover`: lowest member priority first, then proportional load.

All strategies use deterministic tie-breaking. Offline, stale, disabled, draining, incompatible, or capacity-exhausted runners remain in rejection diagnostics but cannot receive work. A paused or draining pool permits no new claims. Existing leases continue through their normal renewal, drain, or expiry path.
