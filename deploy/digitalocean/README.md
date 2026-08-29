# DigitalOcean beta deployment

This deployment is sized for an Ubuntu 24.04 Droplet with 2 GB RAM and 1 vCPU. It caps the public Sandbox website at 384 MB and an optional headless self-hosted runner at 512 MB, leaving headroom for Docker, Caddy, system services, updates, and short-lived spikes. Do not co-host PostgreSQL, the control plane, or the Chromium browser worker on this machine.

The Windows desktop application runs on a tester's PC. The Droplet runner is the always-on execution agent; it does not provide a remote desktop UI.

## Website

1. Create these DNS records, replacing `YOUR_DROPLET_IPV4` with the Droplet's public IPv4 address:

   | Type | Host/name | Value/target | TTL |
   | --- | --- | --- | --- |
   | `A` | `@` | `YOUR_DROPLET_IPV4` | `300` or automatic |
   | `CNAME` | `www` | `sndbox.app` | `300` or automatic |

   Do not point `app`, `docs`, `api`, `identity`, or `internal` at this small Droplet yet. Those names need their own deployed services, and `internal` should not receive a public DNS record. Only add an `AAAA` record when IPv6 is configured on the Droplet.
2. Install Docker Engine and the Docker Compose plugin using DigitalOcean's current Ubuntu instructions.
3. Copy this directory to `/opt/sandbox` and copy `.env.example` to `.env`.
4. Keep `SANDBOX_HTTP_BIND=127.0.0.1` when placing the app behind Caddy, nginx, or a DigitalOcean load balancer. Only expose port 3100 directly if the Droplet firewall restricts it appropriately.
5. Start and inspect the service:

   ```bash
   docker compose -f compose.yml pull website
   docker compose -f compose.yml up -d website
   docker compose -f compose.yml ps
   curl --fail http://127.0.0.1:3100/
   ```

6. Terminate TLS at the reverse proxy. A minimal Caddy configuration is:

   ```caddyfile
   sndbox.app {
     reverse_proxy 127.0.0.1:3100
   }

   www.sndbox.app {
     redir https://sndbox.app{uri} permanent
   }
   ```

## Grafana Application Observability

The website includes OpenTelemetry instrumentation for HTTP traces and Node.js runtime metrics. Instrumentation remains disabled until `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so the website can still run without a collector. The optional `observability` profile runs Grafana Alloy on the same host, adds DigitalOcean and stable Docker-host resource attributes, batches telemetry, and forwards it to Grafana Cloud over OTLP.

1. In your Grafana Cloud stack, open **Home > Setup guide > OpenTelemetry > Production**. Create a token with OTLP write access and copy the OTLP endpoint, instance ID, and token into `.env`:

   ```dotenv
   OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318
   OTEL_DEPLOYMENT_ENVIRONMENT=production
   GRAFANA_CLOUD_OTLP_ENDPOINT=https://otlp-gateway-prod-REGION.grafana.net/otlp
   GRAFANA_CLOUD_INSTANCE_ID=123456
   GRAFANA_CLOUD_API_KEY=replace-with-the-generated-token
   GRAFANA_HOST_ID=sandbox-marketing-do-01
   ```

   Keep `GRAFANA_HOST_ID` stable and unique for the Droplet. Grafana uses it to identify the Docker host for Application Observability. Never commit `.env`; repository ignore rules exclude it.
2. Start the collector and recreate the website with instrumentation enabled:

   ```bash
   docker compose -f compose.yml --profile observability pull alloy website
   docker compose -f compose.yml --profile observability up -d alloy website
   ```

3. Verify Alloy loaded its configuration and generate a few requests:

   ```bash
   curl --fail http://127.0.0.1:12345/-/healthy
   curl --fail https://sndbox.app/
   docker compose -f compose.yml --profile observability logs --tail=100 alloy website
   ```

4. In Grafana Cloud, open **Application > Application Observability** and select the `sandbox/sandbox-marketing` service in the `production` environment. Runtime metrics export every 60 seconds; the RED metrics used by Application Observability are generated from the exported HTTP traces.

The Alloy UI is bound to loopback only. OTLP ports `4317` and `4318` remain private to the Compose network. Stop telemetry without stopping the website by clearing `OTEL_EXPORTER_OTLP_ENDPOINT`, recreating `website`, and stopping the profile:

```bash
docker compose -f compose.yml up -d --force-recreate website
docker compose -f compose.yml --profile observability stop alloy
```

## Optional headless runner

1. Copy `runner.toml.example` to `runner.toml`, replace every placeholder, and keep concurrency at `1` on a small Droplet.
2. Create `data` and `automation` directories writable by container UID `65532`:

   ```bash
   sudo install -d -o 65532 -g 65532 /opt/sandbox/data /opt/sandbox/automation
   ```

3. Pair once. Supply the short-lived token in the command environment rather than storing it in `.env` or `runner.toml`, then compare the displayed fingerprint with the control plane:

   ```bash
   docker compose -f compose.yml --profile runner run --rm -e SANDBOX_PAIRING_TOKEN runner --config /etc/sandbox/runner.toml pair
   ```

4. Start the runner and follow its logs:

   ```bash
   docker compose -f compose.yml --profile runner up -d runner
   docker compose -f compose.yml logs -f --tail=100 runner
   ```

## Upgrade and rollback

Set `SANDBOX_VERSION` to an immutable published version, pull, and recreate the selected services. To roll back, restore the previous version and repeat the same commands. Back up `data`, `automation`, `runner.toml`, and `.env` before changing runner versions.
