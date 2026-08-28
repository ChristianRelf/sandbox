# v0.3 development, testing and deployment

## Development

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run control-plane:build
npm.cmd run web:dev
npm.cmd run desktop:dev
```

The desktop remains usable without the control-plane environment. Production control-plane startup requires PostgreSQL/OIDC, transactional email, immutable object-storage signer, package scanner, Stripe, Ed25519 signing keys, a dedicated metrics bearer token and separate 32-byte webhook/protected-value encryption keys. See `services/control-plane/src/main.ts` for the authoritative environment-variable names and `reliability-v0.5.md` for probe and scrape behaviour.

The privacy retention worker runs daily by default. `PRIVACY_RETENTION_SWEEP_INTERVAL_MS` may change the cadence but cannot be below 60 seconds; see `privacy-and-retention-v0.5.md` for enforced classes and limits.

## Tests

```powershell
npm.cmd test
npm.cmd run browser:test
npm.cmd run control-plane:test
npm.cmd run test:rust
npm.cmd run test:all
```

Rust/Wasmtime artifacts can exceed tens of gigabytes during repeated debug builds. Reclaim them safely with:

```powershell
cargo clean --manifest-path src-tauri/Cargo.toml
```

## Production builds

```powershell
npm.cmd run build
npm.cmd run web:build
npm.cmd run control-plane:build
npm.cmd run desktop:build
```

Apply PostgreSQL migrations before starting the API:

```powershell
$env:DATABASE_URL = "postgresql://..."
npm.cmd run migrate --workspace @sandbox/control-plane
npm.cmd run start --workspace @sandbox/control-plane
```

Run the web app separately with `CONTROL_PLANE_URL` configured. The API and web app are independent deployables; the Next.js application does not own marketplace, billing, runner, authorization or webhook domain logic.

## Required release checks

- Run migrations against a disposable PostgreSQL instance, then rerun them to prove idempotent migration tracking.
- Exercise platform vault integration on Windows Credential Manager, macOS Keychain and Linux Secret Service.
- Run `cargo audit` and npm production audits in CI.
- Produce NSIS/MSI (and supported non-Windows) packages and smoke-test the installed executable.
- Test Stripe webhooks with test-mode checkout/subscription/refund events.
- Test object storage signed URLs, package scanner, email provider and OIDC session revocation.
