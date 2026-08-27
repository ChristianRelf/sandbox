# Self-hosted Linux runner

The supported server runner targets Linux x86-64 and Linux ARM64 as a signed standalone binary, an unprivileged container image, or a hardened systemd service. It uses runner protocol v2 and reports its exact engine, plugin-runtime, architecture, tags, environment, and concurrency before work can be routed to it.

Create a runner in the Operations area, copy the short-lived pairing token, and place it in `SANDBOX_PAIRING_TOKEN` only for the pairing command. The command contains no permanent account credential:

```sh
sudo SANDBOX_PAIRING_TOKEN='short-lived-token' sandbox-runner \
  --config /etc/sandbox-runner/config.toml pair
```

The runner creates an Ed25519 device key locally, sends only its public key with the one-time token, and prints the fingerprint that an administrator must confirm. Its issued runner certificate and private key are stored with owner-only permissions. Revocation invalidates the certificate and stops new claims; draining stops claims while allowing bounded in-flight completion.

Configuration is versioned and rejects unknown fields. HTTPS is required except for a localhost development control plane. Working directories and local-network targets are explicit allowlists. Simple command execution is disabled by default and does not grant plugins the same permission. Pairing tokens should never be written into the config file, shell history, image, or systemd unit.

Validate configuration before starting:

```sh
sandbox-runner --config /etc/sandbox-runner/config.toml validate
```

The systemd unit uses a dedicated account, a read-only system view, private temporary storage, and a single writable data directory. Container deployments should additionally use a read-only root filesystem, dropped capabilities, PID/CPU/memory limits, and only the approved data and working-directory mounts.
