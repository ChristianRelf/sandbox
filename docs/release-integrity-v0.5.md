# v0.5.0 signed release and provenance

Production artifacts are created only by `.github/workflows/release.yml` from an exact `vMAJOR.MINOR.PATCH` tag whose value matches both product and Tauri metadata. The workflow creates a draft GitHub release only after every signing, verification and attestation job succeeds. Local builds are development artifacts and must not be published as production releases.

## Protected release configuration

Create a GitHub environment named `production-release`, restrict it to protected version tags, and require an independent release-engineering reviewer. Configure these environment values:

| Name | Type | Purpose |
| --- | --- | --- |
| `WINDOWS_CERTIFICATE` | Secret | Base64-encoded PFX containing the approved Windows code-signing identity. |
| `WINDOWS_CERTIFICATE_PASSWORD` | Secret | PFX import password. |
| `WINDOWS_TIMESTAMP_URL` | Variable | RFC 3161 timestamp URL supplied by the certificate issuer. |

The Windows job rejects a missing private key, a certificate without the code-signing extended key usage, or a certificate expiring within 14 days. The temporary PFX is deleted immediately after non-exportable import. Every produced MSI and NSIS executable must report valid Authenticode and the expected signer thumbprint.

GitHub OIDC supplies short-lived identities for Sigstore and provenance; no long-lived Sigstore private key is stored. The release workflow and every third-party action are pinned to immutable commits. Updating an action requires reviewing its upstream release and replacing both the commit and adjacent version comment.

## Released subjects

- Windows MSI and NSIS installers: Authenticode signed, timestamped, SHA-256 listed and covered by GitHub build provenance.
- Linux x86-64 and ARM64 self-hosted runner archives: deterministic timestamp/owner metadata, SHA-256 manifest, keyless Sigstore bundle, immediate identity verification and GitHub build provenance.
- GHCR server-runner and hosted-runner images for AMD64/ARM64, plus the browser-worker image for AMD64: immutable digest tags, keyless Sigstore signatures, BuildKit maximum provenance, SPDX SBOM attestations and GitHub OCI attestations.

The draft release contains installer and agent files, checksum manifests, the Sigstore bundle and text files recording every published OCI digest. Mutable container version tags are convenience references only; deployments must pin the recorded digest.

## Release procedure

1. Confirm the complete protected-branch suite is green and the blocker register permits a candidate.
2. Create a signed, protected tag such as `v0.5.0` at the reviewed commit and push only that tag.
3. Approve the `production-release` environment after checking the commit and workflow diff.
4. Confirm the workflow's Authenticode, `cosign verify`, `cosign verify-blob`, attestation and publication steps all pass.
5. Download the draft assets, verify them independently, smoke-test both Windows installers and both agent architectures, then promote the unchanged draft release.
6. Record the release URL, workflow run, commit, signer identity, installer hashes and OCI digests in GA-019 evidence.

Do not retry by replacing a failed tag or overwriting an existing release. Correct the source or release configuration, increment the patch version and create a new signed tag.

## Consumer verification

Verify a Windows download before execution:

```powershell
Get-AuthenticodeSignature -LiteralPath .\Sandbox_0.5.0_x64-setup.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
Get-FileHash -Algorithm SHA256 -LiteralPath .\Sandbox_0.5.0_x64-setup.exe
```

Verify an agent archive against its checksum and Sigstore bundle:

```bash
sha256sum --check SHA256SUMS
cosign verify-blob \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity-regexp 'https://github.com/OWNER/REPOSITORY/.github/workflows/release.yml@refs/tags/v0\.5\.0' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  SHA256SUMS
gh attestation verify sandbox-runner-0.5.0-linux-x86_64.tar.gz -R OWNER/REPOSITORY
```

Verify and deploy a container by immutable digest:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/OWNER/REPOSITORY/.github/workflows/release.yml@refs/tags/v0\.5\.0' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/OWNER/sandbox-server-runner@sha256:DIGEST
gh attestation verify oci://ghcr.io/OWNER/sandbox-server-runner@sha256:DIGEST -R OWNER/REPOSITORY
```

GA-019 remains open until the protected workflow has produced and independently verified the actual v0.5.0 artifacts. Repository tests prove the fail-closed release contract but cannot substitute for possession of the approved certificate or a completed registry publication.
