# DigitalOcean beta deployment

This deployment is sized for a basic 1 GB Ubuntu 24.04 Droplet. It runs the public Sandbox website in 256 MB and can optionally run one headless self-hosted runner in 384 MB. Do not co-host PostgreSQL, the control plane, or the Chromium browser worker on this small machine.

The Windows desktop application runs on a tester's PC. The Droplet runner is the always-on execution agent; it does not provide a remote desktop UI.

## Website

1. Install Docker Engine and the Docker Compose plugin using DigitalOcean's current Ubuntu instructions.
2. Copy this directory to `/opt/sandbox` and copy `.env.example` to `.env`.
3. Keep `SANDBOX_HTTP_BIND=127.0.0.1` when placing the app behind Caddy, nginx, or a DigitalOcean load balancer. Only expose port 3100 directly if the Droplet firewall restricts it appropriately.
4. Start and inspect the service:

   ```bash
   docker compose -f compose.yml pull website
   docker compose -f compose.yml up -d website
   docker compose -f compose.yml ps
   curl --fail http://127.0.0.1:3100/
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
