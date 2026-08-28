# Managed usage metering

Only `managed_cloud_runner` and `managed_browser_worker` deployments can emit their corresponding seconds meter. The control plane also verifies that the referenced execution belongs to the submitted deployment, workspace, and environment. Personal-local and self-hosted targets fail closed at the ledger.

Configure the control plane with a JSON map of producer identifiers to independent base64-encoded keys of at least 32 bytes:

```text
USAGE_PRODUCER_SECRETS_JSON={"hosted-runner":"<base64>","browser-worker":"<base64>"}
```

Configure each managed worker with only its own key:

```text
SANDBOX_CONTROL_PLANE_URL=https://control-plane.example
SANDBOX_USAGE_PRODUCER_ID=hosted-runner
SANDBOX_USAGE_PRODUCER_SECRET_BASE64=<base64>
```

Use `browser-worker` as the browser process identifier. Producer requests sign the exact JSON body together with a Unix timestamp. The control plane rejects unknown producers, modified bodies, and requests outside the five-minute freshness window. Worker retries reuse the identical event body and signature; ledger insertion is atomic under concurrent replay.

`PostgresUsageLedger.invoiceInputs` aggregates only executions whose latest reconciliation is `matched`. A later discrepancy removes those events from invoice inputs. Each line includes a SHA-256 evidence digest over the immutable event and reconciliation identifiers so an invoice export can be reproduced and audited. Production release evidence must include key rotation and a comparison between these inputs and the billing provider's invoice period.
