# Security policy

Security reports are welcome and should be submitted privately.

## Supported versions

sndbox is currently in beta. Security fixes are made for the latest release on
the current `0.7.x` line. Older prereleases, development snapshots, forks, and
unofficial builds are not supported. When a security update is released, users
should upgrade promptly.

| Version | Supported |
| --- | --- |
| Latest `0.7.x` release | Yes |
| Older releases and prereleases | No |

This table describes the current repository state and will be updated when the
support policy changes.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting form:

<https://github.com/sndboxhq/sandbox/security/advisories/new>

Do not disclose a suspected vulnerability in an issue, discussion, pull
request, Discord message, support ticket, or other public channel. If the form
is unavailable, use the private support portal at
<https://app.sndbox.app/support> and state that the case contains a security
report; do not attach secrets or production data.

Include, when possible:

- the affected component and version or commit;
- impact and realistic attack scenario;
- prerequisites and minimal reproduction steps;
- proof-of-concept code with destructive actions removed;
- relevant logs or screenshots, fully redacted;
- suggested remediation, if known;
- whether anyone else has been notified and your disclosure timeline.

Never send passwords, access tokens, private keys, unredacted personal data, or
data belonging to another user. Use test accounts and synthetic data.

## What to expect

The project aims to acknowledge a complete report within three business days
and provide an initial assessment within seven business days. These are targets,
not guarantees. The maintainer will keep the reporter informed of material
changes, coordinate a disclosure date, and credit the reporter if requested and
legally possible.

A report may be closed when it cannot be reproduced, has no meaningful security
impact, affects an unsupported configuration, or is already known. Duplicate
reports are handled in the order received.

## Research guidelines and safe harbor

Good-faith research is authorized when you:

- test only accounts and data you own or have explicit permission to use;
- make a reasonable effort to avoid privacy violations, service degradation,
  data destruction, persistence, and access beyond what proves the issue;
- stop and report immediately if you encounter user data or gain unintended
  access;
- do not use social engineering, phishing, physical attacks, denial of service,
  spam, or automated high-volume scanning;
- do not extort the project or make disclosure conditional on payment;
- follow applicable law and coordinate disclosure through the private report.

For research that follows this policy, the project will treat the work as
authorized security research and will not initiate legal action for accidental,
good-faith policy violations. If a third party initiates action, the project
will make its authorization known where it is able to do so. This safe harbor
does not bind third parties or excuse unlawful conduct.

There is no public bug-bounty program and no payment is promised. Any reward is
entirely discretionary and must be agreed in writing.

## Scope

In scope are vulnerabilities in code maintained in this repository, official
sndbox release artifacts, and the official `sndbox.app` services when tested
using an account and data you control.

Generally out of scope are:

- vulnerabilities only in an unsupported or modified build;
- missing best-practice headers without a demonstrated impact;
- self-XSS, clickjacking on pages with no sensitive action, and harmless error
  disclosure;
- rate-limit observations without a practical security consequence;
- dependency advisories without a sndbox-specific exploit path;
- social engineering, physical security, availability testing, and third-party
  services outside sndbox's control.

Out-of-scope findings with a concrete impact may still be reported privately.

## Disclosure and fixes

Fixes are developed in a private advisory when appropriate, reviewed, tested,
and released through the project's protected release process. Public disclosure
should wait until a fix or mitigation is available and the coordinated date has
arrived. Security advisories will describe affected versions, impact, mitigation,
and credits without publishing secrets or unnecessary exploit detail.

The repository uses automated dependency alerts and updates, secret scanning,
push protection, dependency review, static analysis, pinned GitHub Actions, and
protected release provenance as defense-in-depth controls. These controls do not
replace responsible review.
