# Managed hosted-runner isolation review

## Current prototype

The hosted runner is an independently built Rust binary and container that imports `sandbox-engine` directly. The smoke workflow and unit test execute the same schema-3 graph and produce the same engine record as desktop execution.

Preflight rejects file watches, local file moves, arbitrary commands, desktop notifications and all browser nodes. Browser graphs must select a managed browser worker. Plugin pins and connection references must match the workload grant exactly.

## Workload boundary

The image is distroless and runs as `nonroot:nonroot`. Production launch must additionally set:

- one workload per execution;
- read-only root filesystem;
- private `/tmp` tmpfs with size and `noexec,nosuid` controls;
- all Linux capabilities dropped, no privilege escalation and runtime-default seccomp;
- PID, CPU, memory, duration and ephemeral-storage limits from the validated isolation policy;
- a workspace/execution-scoped service identity with no control-plane administration permissions;
- default-deny ingress and egress, with DNS plus approved external origins only;
- cloud metadata and control-plane internal address blocking at both network and application layers;
- no host paths, Docker socket, privileged mode or shared customer volumes.

The Rust policy rejects resource values above platform maxima and rejects a direct private-network flag. Private access requires the separately authenticated connector. Literal loopback, private, link-local, IPv6 local and `169.254.169.254` destinations are blocked. The network proxy/firewall must also validate resolved addresses and redirects to prevent DNS rebinding.

## Secrets and plugins

Workload input contains secret grant references, not secret values. A connection broker should redeem a reference for a time-limited operation or node-scoped value. The default hosted host denies integrations and plugins unless the corresponding broker/runtime is injected. This fail-closed state is deliberate; hosted plugin execution is not claimed complete until the v0.3 Wasmtime broker is wired with workload-specific policy.

## Data lifecycle

Each execution creates a unique temporary SQLite database inside the workload temporary directory. The directory is deleted on normal teardown and the container runtime destroys it after exit. Uploaded logs are bounded and redacted; downloadable artifacts use a separate quota and expiring upload grant. Infrastructure must enforce deletion after abnormal termination as well as normal process exit.

## Verification completed

- same-engine set-data execution;
- unsupported local/shell/browser node rejection;
- private and metadata literal address rejection;
- invalid resource policy rejection;
- temporary filesystem deletion on drop;
- release container build from lockfile;
- non-root image identity and constrained container smoke test.

## Remaining launch gates

- network-policy integration tests covering DNS rebinding and redirects;
- cgroup CPU/memory/ephemeral-storage failure tests in the target orchestrator;
- operation-scoped cloud connection broker;
- production plugin-runtime injection and sandbox regression suite inside the image;
- signed image, SBOM, dependency/container scan and admission-policy enforcement;
- tenant-isolation test across concurrent workloads and artifact namespaces.

