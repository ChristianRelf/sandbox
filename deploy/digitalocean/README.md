# DigitalOcean beta deployment

For the complete first-time walkthrough, follow [DEPLOYMENT-GUIDE.md](./DEPLOYMENT-GUIDE.md).

This deployment is sized for an Ubuntu 24.04 Droplet with at least 4 GB RAM. It caps the public website at 384 MB, the account portal at 512 MB, Caddy at 128 MB, and an optional headless self-hosted runner at 512 MB. An 8 GB Droplet leaves generous headroom for Docker, system services, updates, and short-lived spikes. Do not co-host PostgreSQL, the control plane, or the Chromium browser worker on this machine.

The Windows desktop application runs on a tester's PC. The Droplet runner is the always-on execution agent; it does not provide a remote desktop UI.

## One-time Droplet setup

1. Create these DNS records, replacing `YOUR_DROPLET_IPV4` with the Droplet's public IPv4 address:

   | Type | Host/name | Value/target | TTL |
   | --- | --- | --- | --- |
   | `A` | `@` | `YOUR_DROPLET_IPV4` | `300` or automatic |
   | `CNAME` | `www` | `sndbox.app` | `300` or automatic |
   | `CNAME` | `app` | `sndbox.app` | `300` or automatic |

   Keep `api` on the separately deployed control plane. Configure `docs.sndbox.app` as a Mintlify custom domain using the DNS target Mintlify provides; it no longer points at this Droplet. Do not point `identity` or `internal` at this Droplet; `internal` should not receive a public DNS record. Only add an `AAAA` record when IPv6 is configured on the Droplet.
2. Add the SSH public key used by GitHub Actions to `/root/.ssh/authorized_keys`. Keep the private key only in GitHub's `digitalocean-beta` environment.
3. Copy `bootstrap.sh` to the Droplet and run it once:

   ```bash
   chmod 755 bootstrap.sh
   sudo ./bootstrap.sh
   ```

   The script installs Docker Engine and Compose from Docker's official Ubuntu repository when needed, enables Docker, and creates `/opt/sandbox`. It does not change the host firewall.
4. In the DigitalOcean cloud firewall, allow inbound TCP `22`, `80`, and `443`. UDP `443` is optional and enables HTTP/3. Do not expose `3100`, `3300`, `12345`, PostgreSQL, or Docker's daemon port.

## One-click GitHub Actions deployment

Create a GitHub environment named `digitalocean-beta` and add these secrets:

| Secret | Value |
| --- | --- |
| `DROPLET_HOST` | The Droplet's public IPv4 address or hostname. |
| `DROPLET_SSH_PRIVATE_KEY` | A dedicated unencrypted SSH private key whose public key was installed during setup. |
| `DROPLET_SSH_KNOWN_HOSTS` | The Droplet's complete `known_hosts` line. Obtain the key with `ssh-keyscan`, but compare its fingerprint against the DigitalOcean console before trusting it. |

The optional environment variables `DROPLET_USER` and `DROPLET_DEPLOY_PATH` default to `root` and `/opt/sandbox`. The workflow validates the host key, uploads only this deployment bundle, authenticates to GHCR with its short-lived GitHub token, pulls the selected immutable version, and waits for the website and account health checks. Existing `.env`, `runner.toml`, data, automation files, and Docker volumes are not overwritten.

Before the first deployment, configure `CONTROL_PLANE_URL`, `OIDC_AUTHORIZE_URL`, `OIDC_TOKEN_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, and `OIDC_AUDIENCE` in `/opt/sandbox/.env`. Use a dedicated Auth0 Regular Web Application whose callback URL is `https://app.sndbox.app/auth/callback`; keep the client secret out of Git.

For the first deployment, open **Actions > Deploy DigitalOcean beta > Run workflow**, enter the published version without `v` (for example `0.7.1-beta.3`), and select `website`.

To deploy automatically after every successful release, create the repository variable `DEPLOY_DIGITALOCEAN=true`. Automatic deployments intentionally select the website-only profile; observability and the runner remain manual choices.

Caddy runs in Compose, obtains and renews TLS certificates automatically, redirects `www` to the apex domain, and only starts after the website and account portal are healthy. Verify the result with:

```bash
cd /opt/sandbox
docker compose ps
curl --fail http://127.0.0.1:3100/
curl --fail http://127.0.0.1:3300/sign-in
curl --fail https://sndbox.app/
curl --fail https://app.sndbox.app/sign-in
```

The documentation is deployed independently from `apps/docs` through Mintlify. After connecting the repository and custom domain in Mintlify, verify it separately with `curl --fail https://docs.sndbox.app/`.

For a manual deployment without Actions, copy this directory to `/opt/sandbox`, copy `.env.example` to `.env`, authenticate Docker to GHCR if the package is private, and run:

```bash
./deploy.sh 0.7.1-beta.3 website
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

Run the deployment workflow again with any previously published version to roll back. `deploy.sh` also restores the prior website and account images automatically when a health check fails. Mintlify deployments have their own deployment history. Back up `data`, `automation`, `runner.toml`, `.env`, and the Caddy data volume before changing runner versions or moving hosts.
