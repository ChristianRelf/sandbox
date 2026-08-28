# Control-plane reliability v0.5

The control plane exposes separate liveness, readiness, and metrics signals:

- `GET /health` proves that the HTTP process can respond. It does not inspect dependencies.
- `GET /ready` returns 200 only when PostgreSQL responds and both recurring credential-governance sweeps have completed within twice their configured interval. Probe failures are named but their error details are never returned.
- `GET /metrics` exports Prometheus text with request counts, summed request duration, and readiness outcomes. Request labels use Fastify route templates and status classes, keeping label cardinality bounded.

Set `METRICS_BEARER_TOKEN` to a dedicated high-entropy secret. The metrics endpoint fails closed when metrics or the secret are absent and compares bearer tokens in constant time. Do not reuse an account, runner, webhook, or usage-producer credential.

Route traffic only to replicas returning 200 from `/ready`. Alert on sustained non-200 readiness, any stale background probe, elevated 5xx ratio, and request-duration objectives computed from the exported counters. A metrics collector should scrape `/metrics` over the private service network with `Authorization: Bearer <METRICS_BEARER_TOKEN>`.

Before closing GA-014, production operations must additionally record evidence for alert delivery and acknowledgement, a scheduled synthetic workflow covering authentication through execution completion, and an incident exercise that updates the customer status channel and links an immutable incident timeline. Unit and API tests in this repository prove signal behaviour but do not substitute for those deployment exercises.
