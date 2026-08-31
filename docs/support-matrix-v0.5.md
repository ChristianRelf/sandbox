# v0.5 compatibility and support matrix

This matrix is the release contract for sndbox 0.5.x. Components outside the
combinations below are not supported for production use.

| Component | Supported version | Compatibility boundary |
| --- | --- | --- |
| Desktop application | 0.5.x | Use with the 0.5.x control plane and the bundled 0.5.x engine, plugin runtime and browser sidecar. Mixed minor versions are not supported. |
| Web application | 0.5.x | Use with control-plane API v1 from the 0.5.x release line. |
| Control plane, scheduler and browser worker | 0.5.x | Deploy the same patch version together. PostgreSQL 16 is the tested database release. |
| TypeScript API client | 0.5.x | Node.js 20 or later and control-plane API v1. The v1 compatibility and deprecation policy applies. |
| Plugin SDK | 0.5.x | Produces manifest version 1 packages. New plugins default to `minimumHostVersion: ">=0.5.0"`. |
| Self-hosted server runner | 0.5.x | Control plane 0.5.x, runner protocol 2, engine 0.5.x and plugin runtime 0.5.x. |
| Hosted runner | 0.5.x | Internal component; deploy at the exact control-plane patch version with runner protocol 2. |
| Browser sidecar | 0.5.x | Bundled with desktop 0.5.x. Standalone or cross-version operation is unsupported. |

## Upgrade and support policy

- Upgrade the control plane, scheduler and browser worker as one release unit.
- Upgrade hosted runners before admitting new workloads. Drain and then upgrade
  self-hosted runners; the control plane rejects an incompatible protocol.
- Desktop and self-hosted runner 0.4.x installations must be upgraded to 0.5.x
  before connecting to a 0.5.x production control plane.
- Plugin compatibility is evaluated from `minimumHostVersion` and optional
  `maximumHostVersion`. Existing signed packages remain installable only when
  their declared range includes the 0.5.x host.
- Security fixes are delivered on the latest 0.5.x patch. Only the latest patch
  is eligible for production support after a newer patch has been available for
  30 days.

The repository release check verifies that product package metadata, Rust crate
metadata, the desktop configuration, runtime constants and this matrix agree on
the 0.5.0 release and runner protocol 2.
