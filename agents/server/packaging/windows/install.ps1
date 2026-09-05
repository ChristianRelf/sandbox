<#
.SYNOPSIS
  Fallback installer for the sndbox Windows runner. Prefer the signed MSI in
  production; use this script only for unsigned test builds or air-gapped hosts
  where MSI installation is blocked.

.DESCRIPTION
  Installs the sandbox-runner binary to Program Files, provisions
  C:\ProgramData\sndbox-runner with a hardened ACL, and registers the
  sandbox-runner Windows service under the virtual account
  NT SERVICE\sandbox-runner.

  Preserves existing config, identity, data, and plugin cache on upgrade.
  Does not start the service; complete "sandbox-runner setup" and pairing first.

.PARAMETER Source
  Directory containing the extracted archive: sandbox-runner.exe and
  config.example.toml. Defaults to the script's own directory.

.EXAMPLE
  # From an elevated PowerShell:
  .\install.ps1
#>

[CmdletBinding()]
param(
  [string] $Source = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

function Fail($message) {
  Write-Error "sandbox-runner install: $message"
  exit 1
}

# Elevation guard.
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'run this installer from an elevated PowerShell (Run as Administrator).'
}

$installDir  = 'C:\Program Files\sndbox'
$dataDir     = 'C:\ProgramData\sndbox-runner'
$pluginDir   = Join-Path $dataDir 'plugins'
$configPath  = Join-Path $dataDir 'config.toml'
$binaryPath  = Join-Path $installDir 'sandbox-runner.exe'
$serviceName = 'sandbox-runner'

foreach ($file in 'sandbox-runner.exe','config.example.toml') {
  if (-not (Test-Path (Join-Path $Source $file))) {
    Fail "$file is missing from $Source"
  }
}

New-Item -ItemType Directory -Force -Path $installDir,$dataDir,$pluginDir | Out-Null

# Atomic binary replacement: copy to .new then Move-Item -Force.
$binaryTemp = "$binaryPath.new"
Copy-Item -Force (Join-Path $Source 'sandbox-runner.exe') $binaryTemp
Move-Item -Force $binaryTemp $binaryPath

# Preserve existing config; only install the placeholder when nothing is there.
if (-not (Test-Path $configPath)) {
  Copy-Item -Force (Join-Path $Source 'config.example.toml') $configPath
  Write-Host "Installed example configuration at $configPath"
} else {
  Write-Host "Preserved existing configuration at $configPath"
}

# Harden the ACL on ProgramData\sndbox-runner:
#   Administrators + NT SERVICE\sandbox-runner  = Full control
#   SYSTEM                                       = Read+Execute
#   Everything else                              = denied (inheritance disabled)
$acl = Get-Acl $dataDir
$acl.SetAccessRuleProtection($true, $false)   # disable inheritance, drop inherited rules
$acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
foreach ($rule in @(
    (New-Object System.Security.AccessControl.FileSystemAccessRule(
        'BUILTIN\Administrators','FullControl','ContainerInherit,ObjectInherit','None','Allow')),
    (New-Object System.Security.AccessControl.FileSystemAccessRule(
        'NT SERVICE\sandbox-runner','FullControl','ContainerInherit,ObjectInherit','None','Allow')),
    (New-Object System.Security.AccessControl.FileSystemAccessRule(
        'NT AUTHORITY\SYSTEM','ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))
)) {
  $acl.AddAccessRule($rule)
}
Set-Acl -Path $dataDir -AclObject $acl

# Register the service (or update its binPath in place).
$binPath = "`"$binaryPath`" --config `"$configPath`" run"
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  & sc.exe stop   $serviceName | Out-Null
  & sc.exe config $serviceName binPath= $binPath obj= 'NT SERVICE\sandbox-runner' | Out-Null
} else {
  & sc.exe create $serviceName `
      binPath= $binPath `
      DisplayName= 'sndbox runner' `
      start= demand `
      obj= 'NT SERVICE\sandbox-runner' | Out-Null
  & sc.exe description $serviceName 'Runs signed sndbox workflows as an unprivileged service.' | Out-Null
  & sc.exe failure     $serviceName reset= 86400 actions= restart/60000/restart/60000/`"`"/0 | Out-Null
}

Write-Host ''
Write-Host "Installed sandbox-runner at $binaryPath."
Write-Host 'Next: run "sandbox-runner" in a terminal for guided setup, pairing, and health checks.'
Write-Host 'Windows guide: https://docs.sndbox.app/windows'
