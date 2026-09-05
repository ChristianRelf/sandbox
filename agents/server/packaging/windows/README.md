# sndbox Windows runner

Runs signed sndbox workflows as an unprivileged Windows service on x64 or ARM64
hosts.

## Contents

- `sandbox-runner.wxs` — WiX v4 source for the signed MSI installer.
- `install.ps1` — fallback PowerShell installer for unsigned test builds and
  air-gapped hosts.
- `config.example.toml` — packaged placeholder that `sandbox-runner setup`
  replaces after validating every answer.

## Install (production MSI)

Verify the archive against the release's `SHA256SUMS` and Authenticode
signature, then install as an Administrator:

```powershell
msiexec /i sandbox-runner-VERSION-windows-x64.msi /qb
sandbox-runner            # opens the guided terminal home
```

The MSI:

- installs `C:\Program Files\sndbox\sandbox-runner.exe` and adds it to the
  system `PATH`;
- provisions `C:\ProgramData\sndbox-runner\` with an ACL granting full control
  only to `BUILTIN\Administrators` and `NT SERVICE\sandbox-runner`;
- writes a placeholder `config.toml` that guided setup replaces without
  overwriting a customer-edited file;
- registers the `sandbox-runner` Windows service under the virtual account
  `NT SERVICE\sandbox-runner` in `Demand` start mode; does not start it.

The guided setup replaces the packaged placeholder after validating every
answer and preserves the original as `config.toml.bak`. The `workspace_id` and
`environment_id` must be UUIDs, the control-plane URL must use HTTPS except for
localhost development, and every workflow directory or network destination must
be explicitly allowed.

Validate the config, then pair as the operator account (**not** an elevated
shell — the CLI refuses to pair from `Administrator` so identity files do not
end up owned by `Administrators`):

```powershell
sandbox-runner setup
sandbox-runner validate
sandbox-runner pair
```

Create a runner in the sndbox Operations area and copy its short-lived pairing
token. Paste it into the hidden prompt. Confirm the printed fingerprint in the
Operations area, then start the service from an elevated PowerShell:

```powershell
sc.exe config sandbox-runner start= auto
sc.exe start   sandbox-runner
sandbox-runner status
Get-WinEvent -LogName 'sandbox-runner' -MaxEvents 200
```

## Install (unsigned / air-gapped fallback)

For unsigned test builds where the MSI is blocked, use the PowerShell wrapper:

```powershell
# From an elevated PowerShell in the extracted archive directory:
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install.ps1
```

`install.ps1` performs the same steps as the MSI (Program Files layout,
ProgramData ACL, service registration under the virtual account, atomic binary
replacement) but without an MSI package. Prefer the signed MSI in production.

## Containers on Windows Server

Windows Server hosts running Docker EE or containerd can pull
`ghcr.io/sndboxhq/sandbox-server-runner:VERSION-windowsservercore-ltsc2022`. Run
the container as `ContainerUser`, mount the config read-only, persist data, and
mount only approved workflow directories.

Pair once with the `pair` command and `SANDBOX_PAIRING_TOKEN` supplied only to
that container. Then run a long-lived container with the same mounts, the
`run` command, `--restart unless-stopped`, and `--security-opt no-new-privileges`.
Do not store the pairing token in the config, image, or Compose file.

Complete Windows instructions are available at
<https://docs.sndbox.app/windows>.

## Building the MSI

Requires WiX v4 (`dotnet tool install -g wix`) and the release binary at
`target\x86_64-pc-windows-msvc\release\sandbox-runner.exe` (build with
`cargo build --release --target x86_64-pc-windows-msvc --bin sandbox-server-runner`
and rename the output to `sandbox-runner.exe`).

```powershell
$env:SBX_VERSION = '0.7.8'
wix build sandbox-runner.wxs `
  -arch x64 `
  -define Version=$env:SBX_VERSION `
  -define BinaryPath=..\..\target\x86_64-pc-windows-msvc\release\sandbox-runner.exe `
  -define ConfigTemplatePath=config.example.toml `
  -out sandbox-runner-$env:SBX_VERSION-windows-x64.msi
signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 `
  sandbox-runner-$env:SBX_VERSION-windows-x64.msi
```

Repeat with `-arch arm64` and the aarch64 release binary for the ARM64 MSI.

## Troubleshooting

- runner installs but does not start: pair the runner first with
  `sandbox-runner pair`. The service refuses to start unpaired.
- `sc.exe start` returns `Access is denied`: run from an elevated PowerShell.
- service says the runner is not paired: pair as the operator account, not
  from an elevated `Administrator` shell; the identity is stored at
  `C:\ProgramData\sndbox-runner\identity.json`.
- configuration is invalid: replace all example IDs, URLs, signing keys, and
  allowlists, then run `sandbox-runner validate`.
- runner stays offline: check `Get-WinEvent -LogName 'sandbox-runner'`, HTTPS
  reachability, system time, fingerprint confirmation, and whether the runner
  is paused or draining.
