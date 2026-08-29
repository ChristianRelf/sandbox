# Sandbox beta: step-by-step DigitalOcean deployment

This guide deploys the supported v0.7 beta server surface:

- `https://sndbox.app` and `https://www.sndbox.app`
- Automatic HTTPS through Caddy
- Optional Grafana Alloy observability
- Optional headless Sandbox runner

It does **not** deploy identity, the control plane/API, PostgreSQL, or the managed browser worker. The Windows desktop application runs on each tester's computer.

## 1. Prerequisites

You need:

- An Ubuntu 24.04 DigitalOcean Droplet
- The Droplet's public IPv4 address
- Access to manage DNS for `sndbox.app`
- Administrator access to the Sandbox GitHub repository
- A local clone of this repository with the deployment changes pushed to `main`

The website, Caddy, telemetry collector, and one runner fit comfortably on an 8 GB Droplet. The supplied limits also support the smaller 2 GB staging configuration.

## 2. Configure DNS

Open the DNS management page for `sndbox.app` and create:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| `A` | `@` | `YOUR_DROPLET_IPV4` | `300` or automatic |
| `CNAME` | `www` | `sndbox.app` | `300` or automatic |

Do not create `A` records for `app`, `api`, `docs`, `identity`, or `internal` yet. Do not add an `AAAA` record unless IPv6 is configured on the Droplet.

From PowerShell, check propagation:

```powershell
Resolve-DnsName sndbox.app
Resolve-DnsName www.sndbox.app
```

Both names must eventually resolve to the Droplet.

## 3. Create a dedicated deployment SSH key

Run this on your Windows computer. Do not add a passphrase because GitHub Actions must use the key non-interactively:

```powershell
ssh-keygen -t ed25519 -C "sandbox-github-actions" -f "$env:USERPROFILE\.ssh\sandbox_droplet_deploy"
```

Set the Droplet address for the remaining PowerShell examples:

```powershell
$DropletIp = "YOUR_DROPLET_IPV4"
```

Install only the public key on the Droplet:

```powershell
Get-Content "$env:USERPROFILE\.ssh\sandbox_droplet_deploy.pub" | ssh "root@$DropletIp" 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
```

Confirm the dedicated key works:

```powershell
ssh -i "$env:USERPROFILE\.ssh\sandbox_droplet_deploy" "root@$DropletIp" 'whoami'
```

The result should be `root`.

## 4. Record and verify the Droplet host key

GitHub Actions is configured to reject unknown or changed SSH host keys. Do not disable this check.

Use the DigitalOcean web console to run this directly on the Droplet:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Keep the displayed SHA-256 fingerprint. Windows' bundled `ssh-keyscan` can fail against newer Ubuntu SSH servers during hybrid key-exchange negotiation. Use the normal SSH client with a compatible key-exchange algorithm to populate a dedicated file instead:

```powershell
$DropletIp = "YOUR_ACTUAL_DROPLET_IPV4"
$KnownHostsPath = Join-Path $env:USERPROFILE "sandbox_known_hosts"
$KnownHostsPathForSsh = $KnownHostsPath.Replace('\', '/')
$DeployKeyPath = Join-Path $env:USERPROFILE ".ssh\sandbox_droplet_deploy"

if (Test-Path -LiteralPath $KnownHostsPath) {
  Remove-Item -LiteralPath $KnownHostsPath
}

ssh -4 `
  -i $DeployKeyPath `
  -o KexAlgorithms=curve25519-sha256 `
  -o StrictHostKeyChecking=accept-new `
  -o "UserKnownHostsFile=$KnownHostsPathForSsh" `
  -o ConnectTimeout=10 `
  "root@$DropletIp" exit

if (-not (Test-Path -LiteralPath $KnownHostsPath)) {
  throw "SSH did not save the host key. Check the IP and that TCP port 22 is open."
}

Get-Content -LiteralPath $KnownHostsPath
ssh-keygen -lf $KnownHostsPath
```

The local fingerprint must exactly match the fingerprint from the DigitalOcean console. If it does not match, delete the dedicated `sandbox_known_hosts` file and stop to investigate. An authentication error after the host-key line does not invalidate the saved host key, but fix SSH-key access before continuing to the bootstrap step.

## 5. Bootstrap the Droplet

From the repository root on your computer, upload the bootstrap script:

```powershell
if ([string]::IsNullOrWhiteSpace($DropletIp)) {
  throw 'DropletIp is empty. Set it first: $DropletIp = "YOUR_DROPLET_IPV4"'
}

scp -4 `
  -o KexAlgorithms=curve25519-sha256 `
  -i "$env:USERPROFILE\.ssh\sandbox_droplet_deploy" `
  .\deploy\digitalocean\bootstrap.sh `
  "root@${DropletIp}:/root/bootstrap.sh"
```

PowerShell variables exist only in the terminal session where they were set. If you open a new PowerShell window, set `$DropletIp` again before running these commands.

Run it:

```powershell
ssh -4 `
  -o KexAlgorithms=curve25519-sha256 `
  -i "$env:USERPROFILE\.ssh\sandbox_droplet_deploy" `
  "root@$DropletIp" `
  'chmod 755 /root/bootstrap.sh && /root/bootstrap.sh'
```

The script:

1. Verifies the server is Ubuntu.
2. Installs Docker Engine, Buildx, and Docker Compose from Docker's official repository when needed.
3. Enables Docker at boot.
4. Creates `/opt/sandbox` and the optional runner directories.

Verify Docker:

```powershell
ssh -i "$env:USERPROFILE\.ssh\sandbox_droplet_deploy" "root@$DropletIp" `
  'docker version && docker compose version'
```

## 6. Configure the DigitalOcean firewall

In **DigitalOcean > Networking > Firewalls**, attach a firewall to the Droplet with these inbound rules:

| Protocol | Port | Source |
| --- | --- | --- |
| TCP | `22` | Your IP where practical; GitHub Actions also needs SSH access |
| TCP | `80` | All IPv4 and IPv6 |
| TCP | `443` | All IPv4 and IPv6 |
| UDP | `443` | All IPv4 and IPv6; optional HTTP/3 support |

Allow normal outbound traffic. Do not expose ports `3100`, `12345`, `2375`, `2376`, or PostgreSQL.

If restricting SSH to fixed source addresses, remember that ordinary GitHub-hosted runners do not use one small permanent IP range. For this beta, allow SSH broadly and rely on key-only authentication, or use a self-hosted runner/VPN later.

## 7. Configure the release environment

In GitHub, open:

**Repository > Settings > Environments > New environment**

Create `production-release`. You do not need to add a code-signing certificate for an `alpha`, `beta`, or `rc` test release.

The release workflow deliberately produces an unsigned Windows installer for prerelease tags such as `v0.7.0-beta.2`. It still publishes a SHA-256 checksum and retains the GitHub Actions release record. GitHub artifact attestations are added when the repository visibility and account support them; they are unavailable for a private repository owned by a personal account. Windows will identify the publisher as unknown and may display a SmartScreen warning; only share this installer with invited testers who understand that warning.

You can optionally require manual approval on this environment before GitHub publishes a release.

Stable tags such as `v0.7.0` remain blocked until the following production signing configuration exists:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `WINDOWS_CERTIFICATE` | Base64-encoded PFX certificate |
| Secret | `WINDOWS_CERTIFICATE_PASSWORD` | PFX password |
| Variable | `WINDOWS_TIMESTAMP_URL` | Timestamp URL supplied by the certificate authority |

Encode the PFX locally without printing it into the terminal:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("C:\path\to\sandbox-signing-certificate.pfx")
) | Set-Clipboard
```

Paste the clipboard into the `WINDOWS_CERTIFICATE` secret when you are ready to publish stable builds. Never commit the PFX, password, or encoded certificate.

## 8. Configure the Droplet deployment environment

Create another GitHub environment named `digitalocean-beta`.

Add these environment secrets:

| Secret | What to paste |
| --- | --- |
| `DROPLET_HOST` | The Droplet IPv4 address |
| `DROPLET_SSH_PRIVATE_KEY` | Complete contents of `sandbox_droplet_deploy` |
| `DROPLET_SSH_KNOWN_HOSTS` | Complete contents of `sandbox_known_hosts` |

Copy the private key safely to your clipboard:

```powershell
Get-Content -Raw "$env:USERPROFILE\.ssh\sandbox_droplet_deploy" | Set-Clipboard
```

Copy the verified host entry:

```powershell
Get-Content -Raw "$env:USERPROFILE\sandbox_known_hosts" | Set-Clipboard
```

Optional environment variables:

| Variable | Default |
| --- | --- |
| `DROPLET_USER` | `root` |
| `DROPLET_DEPLOY_PATH` | `/opt/sandbox` |

For the simplest first deployment, leave both at their defaults.

## 9. Confirm GHCR can be accessed

The deployment action signs in to GitHub Container Registry using its short-lived `GITHUB_TOKEN`; no long-lived registry token is copied to the Droplet.

After the first container build, open each Sandbox package under your GitHub account or organisation. Under **Package settings > Manage Actions access**, ensure this repository has read access. Making the packages public is another option for a public beta.

## 10. Publish `v0.7.0-beta.2`

Before tagging, ensure all deployment changes are committed and pushed, the working tree is clean, and these files all contain version `0.7.0-beta.2`:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Then run:

```powershell
git switch main
git pull --ff-only origin main
git status --short
git tag -a v0.7.0-beta.2 -m "Sandbox v0.7.0 beta 2"
git push origin v0.7.0-beta.2
```

Open **GitHub > Actions > Release**. Wait for every job to succeed. The workflow produces:

- An explicitly unsigned Windows NSIS test installer for this prerelease
- Linux runner archives
- Multi-architecture website and runner containers
- Checksums, Sigstore signatures, `release-manifest.json`, and GitHub artifact attestations when the repository supports them
- A published GitHub prerelease

Do not start the Droplet deployment until the release and container jobs are green.

## 11. Perform the first deployment

Open:

**GitHub > Actions > Deploy DigitalOcean beta > Run workflow**

Enter:

| Input | Value |
| --- | --- |
| Branch | `main` |
| Version | `0.7.0-beta.2` — do not include `v` |
| Deployment | `website` |

Select **Run workflow** and approve the `digitalocean-beta` environment if prompted.

The workflow will:

1. Validate every input.
2. Connect using the verified SSH host key.
3. Upload only `deploy/digitalocean`.
4. Preserve the existing `.env`, `runner.toml`, runner data, and Docker volumes.
5. Authenticate to GHCR with a temporary token.
6. Pull the immutable website version and the pinned Caddy release.
7. Start both services and wait for their health checks.
8. Test the website over the Droplet's loopback interface.
9. Restore the previous website version if deployment fails.
10. Remove the temporary GHCR and SSH credentials from the Actions runner.

## 12. Verify the deployment

Connect to the Droplet:

```powershell
ssh -i "$env:USERPROFILE\.ssh\sandbox_droplet_deploy" "root@$DropletIp"
```

Run:

```bash
cd /opt/sandbox
docker compose ps
docker compose logs --tail=100 website caddy
curl --fail http://127.0.0.1:3100/
curl --fail --head https://sndbox.app/
curl --fail --head https://www.sndbox.app/
```

Expected results:

- `website` and `caddy` are running and healthy.
- The loopback request succeeds.
- `https://sndbox.app` returns a successful response.
- `https://www.sndbox.app` redirects to `https://sndbox.app`.
- The downloads page displays the published beta installer from `release-manifest.json`.

Also install the downloaded NSIS package on a clean Windows test machine and verify the browser engine, update notice, settings, and one harmless local workflow.

## 13. Enable automatic deployments

After the first manual deployment works, open:

**GitHub > Repository Settings > Secrets and variables > Actions > Variables**

Create this repository variable:

```text
DEPLOY_DIGITALOCEAN=true
```

Future successful releases will automatically deploy the website. Observability and the runner remain manual profile choices.

## 14. Enable optional observability

On the Droplet, edit `/opt/sandbox/.env` and set:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318
OTEL_DEPLOYMENT_ENVIRONMENT=production
GRAFANA_CLOUD_OTLP_ENDPOINT=https://otlp-gateway-prod-REGION.grafana.net/otlp
GRAFANA_CLOUD_INSTANCE_ID=YOUR_INSTANCE_ID
GRAFANA_CLOUD_API_KEY=YOUR_GRAFANA_TOKEN
GRAFANA_HOST_ID=sandbox-marketing-do-01
```

Run **Deploy DigitalOcean beta** again with deployment `website+observability`.

Verify:

```bash
cd /opt/sandbox
curl --fail http://127.0.0.1:12345/-/healthy
docker compose --profile observability logs --tail=100 alloy website
```

## 15. Enable the optional runner

On the Droplet:

```bash
cd /opt/sandbox
cp runner.toml.example runner.toml
nano runner.toml
```

Replace every `example.com` and `replace-with-...` value. The control-plane URL and signing public key must come from a separately hosted control plane. Keep concurrency at `1` on the 2 GB profile.

Pair the runner using a short-lived token without saving that token in `.env` or shell history:

```bash
read -rsp "Pairing token: " SANDBOX_PAIRING_TOKEN
echo
export SANDBOX_PAIRING_TOKEN
docker compose --profile runner run --rm -e SANDBOX_PAIRING_TOKEN runner --config /etc/sandbox/runner.toml pair
unset SANDBOX_PAIRING_TOKEN
```

Compare the displayed fingerprint with the control plane, then run **Deploy DigitalOcean beta** with deployment `website+runner`.

## 16. Deploy an update

For a new version:

1. Update all application and crate versions together.
2. Commit and push the release changes.
3. Create and push the matching annotated tag.
4. Wait for **Release** to succeed.
5. Let automatic deployment run, or manually run **Deploy DigitalOcean beta** with the new version.

Never deploy mutable tags such as `latest`.

## 17. Roll back

Open **Actions > Deploy DigitalOcean beta > Run workflow** and enter the last known-good published version. The action pulls that immutable image and restarts the website.

The deployment script also attempts this rollback automatically when a new image fails its health checks.

## 18. Troubleshooting

### GHCR returns `403 Forbidden`

- Confirm the release container job succeeded.
- Confirm the image version exists.
- Under the GHCR package's **Manage Actions access**, grant this repository read access.
- Confirm the workflow still has `packages: read` permission.

### SSH host-key verification fails

- Recreate `sandbox_known_hosts`.
- Compare its fingerprint with `/etc/ssh/ssh_host_ed25519_key.pub` through the DigitalOcean console.
- Update `DROPLET_SSH_KNOWN_HOSTS` only after confirming the change is legitimate.
- Never change the workflow to `StrictHostKeyChecking no`.

### Caddy cannot obtain a certificate

- Confirm both DNS records point to this Droplet.
- Confirm TCP ports `80` and `443` are open.
- Check `docker compose logs --tail=200 caddy`.
- Remove incorrect `AAAA` records when the Droplet has no working IPv6 route.

### Website is unhealthy

```bash
cd /opt/sandbox
docker compose ps
docker compose logs --tail=200 website
curl -v http://127.0.0.1:3100/
```

### The release workflow rejects the tag

The Git tag, root package version, and Tauri version must match exactly. Supported prerelease tags use forms such as `v0.7.0-beta.2`, not `v0.7-beta` or `v0.7.0-beta2`.

## 19. Files and data to back up

Before moving hosts or making runner configuration changes, back up:

- `/opt/sandbox/.env`
- `/opt/sandbox/runner.toml`
- `/opt/sandbox/data`
- `/opt/sandbox/automation`
- The `caddy-data` Docker volume
- The `alloy-data` Docker volume when observability is enabled

Do not commit any of these runtime files or secrets to Git.
