# Contributing to sndbox

Thank you for helping improve sndbox. This guide applies to code, tests,
documentation, examples, and design changes in this repository.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Use a GitHub issue for a reproducible bug or a focused feature proposal.
- Discuss substantial changes with the maintainers before investing in an
  implementation. This is especially important for public APIs, workflow
  schemas, permissions, storage, authentication, billing, and release logic.
- Do not use a public issue to report a vulnerability. Follow
  [SECURITY.md](SECURITY.md) instead.
- Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Development setup

The main prerequisites are Node.js 20 or newer, Rust stable, the Tauri 2
platform prerequisites, and WebView2 on Windows.

```powershell
git clone https://github.com/sndboxhq/sandbox.git
cd sandbox
npm.cmd ci
npm.cmd run desktop:dev
```

The web surfaces can be run independently:

```powershell
npm.cmd run dev
npm.cmd run web:dev
npm.cmd run marketing:dev
npm.cmd run docs:dev
```

Do not commit credentials, tokens, production data, local databases, build
artifacts, or generated secrets. Use synthetic and redacted fixtures.

## Making a change

1. Create a branch from the latest `main`. Use a short name such as
   `fix/cancel-timeout` or `docs/runner-setup`.
2. Keep the change focused. Separate unrelated refactors from behavior changes.
3. Add or update tests for observable behavior. Update user and operator
   documentation when interfaces, permissions, schemas, or deployment steps
   change.
4. Preserve compatibility unless the issue explicitly approves a breaking
   change. Migration and rollback behavior must be described for data or schema
   changes.
5. Run the checks that cover the affected area.

Useful checks from the repository root include:

```powershell
npm.cmd run build
npm.cmd run test:node
npm.cmd run test:rust
npm.cmd run test:rust:runners
```

The full suite is `npm.cmd run test:all`. It is acceptable to run a narrower
package or crate test locally, but list exactly what you ran in the pull
request. CI remains authoritative.

Security-sensitive changes should also explain the trust boundary, untrusted
inputs, authorization decision, secret handling, logging/redaction behavior,
resource limits, and failure mode. Never weaken a security boundary merely to
make a test pass.

## Commits and pull requests

Use clear, imperative commit subjects. The repository commonly uses
Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`,
`refactor:`, and `chore:`.

A pull request must:

- explain the problem and the chosen approach;
- link the relevant issue when one exists;
- identify security, privacy, compatibility, migration, and rollback effects;
- include tests, or explain why tests are not applicable;
- include screenshots for visible UI changes;
- pass required CI and security checks;
- resolve review conversations and receive the required approval.

Maintainers may request that a large pull request be split. Draft pull requests
are welcome for early feedback, but are not mergeable.

## Contribution rights

The repository is distributed under the terms in [LICENSE](LICENSE). Unless a
separate written agreement applies, you retain copyright in your contribution
and, by submitting it, grant the repository owner and its successors a
worldwide, perpetual, irrevocable, non-exclusive, royalty-free license to use,
reproduce, modify, distribute, sublicense, and relicense the contribution as
part of sndbox and related works. You represent that you have the right to make
that grant.

Do not contribute third-party material unless its license permits the proposed
use and the required notices are included. A maintainer may require a separate
contributor agreement before accepting a substantial contribution.

## Review and release

Maintainers decide whether and when a contribution is accepted. Approved pull
requests are normally squash-merged so `main` remains linear. Releases are
created only by the protected release workflow; contributors must not publish
artifacts or create release tags on behalf of the project without authorization.

See [GOVERNANCE.md](GOVERNANCE.md) for decision-making and maintainer roles.
