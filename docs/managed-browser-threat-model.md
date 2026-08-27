# Managed browser threat model

Each managed browser execution launches a new Chromium process and isolated browser context in a short-lived workload. The worker disables extensions, blocks service workers, does not expose the DevTools protocol to workflow nodes or plugins, and destroys its temporary directory and browser process in a `finally` path. No context or filesystem is shared between customer executions.

All browser requests, including subresources and redirects, pass through a request-time network decision. DNS is resolved on every decision to reduce DNS-rebinding exposure. The worker rejects non-HTTP schemes, loopback, link-local, RFC1918/private ranges, carrier-grade NAT, benchmark ranges, IPv6 unique-local/link-local addresses, cloud metadata hostnames, and common cluster-internal names. Private access is only introduced later through an authenticated connector with an explicit target policy; it is not an escape hatch in this worker.

Cloud browser profiles are independent workspace-owned objects containing only an encrypted state reference and non-secret policy metadata. Local profiles are never uploaded automatically. Import is explicit, expiring, audited, warns the user, recommends reauthentication, and rejects saved-password content.

Downloads are size checked, malware scanned, and uploaded to a durable artifact sink before the sandbox is destroyed. An absent scanner never counts as clean. Upload nodes accept only paths under approved artifact roots. Screenshots mask password fields and elements marked sensitive. Diagnostic URLs omit credentials, query strings, and fragments.

Residual risks include hostile browser-engine exploits, compromised artifact scanners, and sophisticated DNS/proxy behaviour. Production deployment therefore also requires an unprivileged container, read-only root filesystem, seccomp/AppArmor or equivalent, CPU/memory/PID limits, segmented egress proxying, signed images, vulnerability scanning, and immediate workload destruction after completion or crash.
