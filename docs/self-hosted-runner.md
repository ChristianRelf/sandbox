# Self-hosted Linux runner

The supported server runner targets Linux x86-64 and Linux ARM64 as a signed standalone binary, an unprivileged container image, or a hardened systemd service. It uses runner protocol v2 and reports its exact engine, plugin-runtime, architecture, tags, environment, and concurrency before work can be routed to it.

## Install the standalone runner

Download the release archive matching `uname -m`: `linux-x86_64` for `x86_64`, or `linux-aarch64` for `aarch64`/`arm64`. Verify it against the published `SHA256SUMS` and Sigstore bundle, then install it:

```sh
tar -xzf sandbox-runner-VERSION-linux-ARCHITECTURE.tar.gz
sudo ./install.sh
sudoedit /etc/sandbox-runner/config.toml
```

The installer places the executable at `/usr/local/bin/sandbox-runner`, creates the unprivileged `sandbox-runner` service account, provisions `/var/lib/sandbox-runner`, installs the example configuration without overwriting an existing one, and registers the hardened systemd unit. It deliberately does not start an unconfigured runner.

Set the control-plane URL, runner and workspace/environment IDs, signing keys, and allowed working directories in the configuration. Create each allowed working directory and grant the `sandbox-runner` account only the access the workflows need.

Validate configuration as the same account that runs the service:

```sh
sudo -u sandbox-runner /usr/local/bin/sandbox-runner \
  --config /etc/sandbox-runner/config.toml validate
```

## Pair and start

Create a runner in the Operations area, copy the short-lived pairing token, and place it in `SANDBOX_PAIRING_TOKEN` only for the pairing command. Pair as the service account so its private device identity has the correct owner:

```sh
sudo -u sandbox-runner env SANDBOX_PAIRING_TOKEN='short-lived-token' \
  /usr/local/bin/sandbox-runner \
  --config /etc/sandbox-runner/config.toml pair
```

The runner creates an Ed25519 device key locally, sends only its public key with the one-time token, and prints the fingerprint that an administrator must confirm. Its device identity is stored with owner-only permissions and signs every heartbeat and control-plane request with a fresh timestamp and nonce. Revocation invalidates the device key and stops new claims; draining stops claims while allowing bounded in-flight completion.

Configuration is versioned and rejects unknown fields. HTTPS is required except for a localhost development control plane. Working directories and local-network targets are explicit allowlists. Simple command execution is disabled by default and does not grant plugins the same permission. Pairing tokens should never be written into the config file, shell history, image, or systemd unit.

Set both `workspace_id` and the immutable `environment_id`; the human-readable `environment` must be `development`, `staging`, or `production`. A command for any other environment is rejected locally even when its control-plane signature is otherwise valid.

After confirming the printed fingerprint in the Operations area, start the service:

```sh
sudo systemctl enable --now sandbox-runner
sudo systemctl status sandbox-runner
journalctl -u sandbox-runner -f
```

On a Linux host without systemd, run the same binary under that host's service manager as the `sandbox-runner` user. Keep `/var/lib/sandbox-runner` persistent and writable by that user.

## NAS and container hosts

For Synology, QNAP, TrueNAS SCALE, Unraid, and other container-oriented systems, use the published `ghcr.io/sndboxhq/sandbox-server-runner` image instead of modifying the NAS host. Mount a completed config read-only, plus persistent data and explicitly allowed working directories. The image runs as unprivileged UID/GID `65532`:

```sh
mkdir -p ./sndbox-runner/data ./sndbox-runner/automation
cp config.example.toml ./sndbox-runner/config.toml
sudo chown -R 65532:65532 ./sndbox-runner/data ./sndbox-runner/automation

docker run --rm \
  -e SANDBOX_PAIRING_TOKEN='short-lived-token' \
  -v "$PWD/sndbox-runner/config.toml:/etc/sandbox/runner.toml:ro" \
  -v "$PWD/sndbox-runner/data:/var/lib/sandbox-runner" \
  -v "$PWD/sndbox-runner/automation:/srv/automation" \
  ghcr.io/sndboxhq/sandbox-server-runner:VERSION \
  --config /etc/sandbox/runner.toml pair

docker run -d --name sandbox-runner --restart unless-stopped \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  -v "$PWD/sndbox-runner/config.toml:/etc/sandbox/runner.toml:ro" \
  -v "$PWD/sndbox-runner/data:/var/lib/sandbox-runner" \
  -v "$PWD/sndbox-runner/automation:/srv/automation" \
  ghcr.io/sndboxhq/sandbox-server-runner:VERSION \
  --config /etc/sandbox/runner.toml run
```

Replace `VERSION` with the immutable release version and edit the copied config before pairing. Prefer an immutable image digest for production.

`run` reports health every 30 seconds, polls for work every two seconds while
capacity is available, and reports `draining` during a graceful shutdown. Each
command is verified against an Ed25519 public key in `command_signing_keys`, its
runner/workspace target and expiry are checked, and the executable workflow is
hashed locally before it can match the signed, approved revision identity and
content hash. The signed authorization context must map the action to its exact
permission and repeat any credential workspace, environment, scope, and
service-account role restrictions. The runner applies those restrictions again
before claiming the durable receipt. Unknown actions are rejected.

Command receipts are claimed atomically in `runner.sqlite3` before execution.
Accepted, completed and rejected states are reported to the control plane. A
redelivered completed command is acknowledged without re-execution; a command
interrupted by a restart is rejected with `runner_restarted_before_completion`
after the engine marks its unfinished execution failed. Configure the service
manager with enough stop time for `drain_timeout_seconds` so active commands can
finish cleanly.

Copy only the control plane's current and next command-signing public keys into
the config during key rotation. Remove the old key only after commands signed by
it have expired. The example key in `config.example.toml` is not a production
trust root and must be replaced.

The systemd unit uses a dedicated account, a read-only system view, private temporary storage, and a single writable data directory. Container deployments should additionally use a read-only root filesystem, dropped capabilities, PID/CPU/memory limits, and only the approved data and working-directory mounts.

## Release packaging

Release builders require `cargo-zigbuild`, Zig, GNU tar, and `sha256sum`. The packaging script cross-compiles both supported GNU/Linux architectures, normalizes archive ownership and timestamps, and produces one checksum manifest:

```sh
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" \
  agents/server/packaging/build-release.sh 0.5.0
```

For a local signed build, set `COSIGN_KEY` to an approved Sigstore key or KMS URI. The production release workflow instead sets `RELEASE_SIGNING_REQUIRED=1` and uses its short-lived GitHub OIDC identity; signing or immediate identity verification failure aborts publication. Unsigned output is for local testing only. Publish the two archives, checksum manifest, and Sigstore bundle as one immutable release. Build the container for both platforms with `docker buildx build --platform linux/amd64,linux/arm64`; production publication must also attach provenance, an SBOM and an image signature.
