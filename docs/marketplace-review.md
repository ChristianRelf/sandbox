# Marketplace submission and review

Every plugin version creates an immutable `plugin_versions` row, object key, package digest, and one review object. A publisher cannot replace bytes, reuse a semantic version, reuse a digest for another submission, or inherit approval from an earlier version.

## Publisher trust

Publishers have a UUID internal identity and a stable public ID used by manifests. Membership permissions (`view`, `submit`, `manage_keys`, `security`, `admin`) are checked by the API for every operation. Ed25519 public keys are registered as SubjectPublicKeyInfo DER; private keys never enter the control plane. Key revocation does not rewrite packages already signed by the key, and new submissions cannot use a revoked key.

Identity verification means the publisher identity and control of its listing were reviewed. It is not an endorsement, guarantee of output, or claim that compromise is impossible. Verification is separately revocable and periodically renewable.

## Submission lifecycle

1. `sandbox plugin validate`, `test`, `pack`, and `sign` produce the package and manifest metadata.
2. The publisher creates a submission. The API checks publisher membership, active signing-key identity, manifest identity, version uniqueness, digest uniqueness, package-size limits, and ownership.
3. Object storage issues a 15-minute upload URL for one server-derived immutable key. Upload credentials cannot list or overwrite unrelated objects.
4. Submission finalisation checks object immutability, exact byte length, and object-store SHA-256 before scanning.
5. The deterministic scanner verifies the manifest, package digest, Ed25519 signature, publisher identity, declared contents, Wasm imports, dependency inventory, malware result, sandbox behaviour tests, capabilities, network domains, and reproducibility evidence.
6. A passing automated review enters `manual_review`. Failure enters `changes_requested` with structured reasons. It is never approved by an AI system.
7. A platform reviewer records capability, network, licence, privacy, and behaviour decisions. `changes_requested` and `rejected` require reasons. Approval is scoped to that exact version.
8. Publishing makes the approved immutable version discoverable. Paid listings additionally require an active price and publisher payout readiness.

Statuses are: Draft, Submitted, Automated review, Manual review, Changes requested, Approved, Rejected, Published, Suspended, and Removed.

## Permission changes

Review compares structural capability and network declarations against the previously published version. Additions are highlighted for manual review and for administrators during update installation. Existing local installations and workflows remain pinned. Removal of a permission does not require a new local approval, although the new version still follows normal review.

## Emergency response

Only identities carrying the platform `marketplace.security` permission can revoke a version. Revocation records the exact plugin-version ID, reason, notice URL, actor, time, and correlation ID; suspends that review; blocks new installs; and suspends a listing only when the revoked package is its current version. It does not delete workflows, plugin storage, evidence, or user data. Desktop runners consume signed revocation metadata and block new executions of the exact digest while leaving workflow configuration visible for inspection and rollback.
