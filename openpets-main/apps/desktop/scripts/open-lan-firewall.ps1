[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3787,

  [ValidateSet("Domain", "Private", "Public", "Any")]
  [string]$Profile = "Private"
)

$ruleName = "OpenPets LAN Coordinator TCP $Port"
$description = "Allows OpenPets LAN mode clients to reach the local coordinator."

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
  throw "Windows Defender Firewall cmdlets are not available on this machine."
}

if (-not (Test-IsAdministrator) -and -not $WhatIfPreference) {
  throw "Run this script from an elevated PowerShell prompt, or re-run with -WhatIf to preview the firewall rule."
}

$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingRule) {
  $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $existingRule
  if ($portFilter.Protocol -ne "TCP" -or [string]$portFilter.LocalPort -ne [string]$Port) {
    throw "A firewall rule named '$ruleName' already exists but does not match TCP port $Port. Remove or rename it before continuing."
  }

  if ($PSCmdlet.ShouldProcess($ruleName, "Enable OpenPets LAN firewall rule")) {
    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Action Allow -Direction Inbound -Profile $Profile
  }
  if ($WhatIfPreference) {
    Write-Host "Previewed existing OpenPets LAN firewall rule for TCP port $Port ($Profile profile)."
  } else {
    Write-Host "OpenPets LAN firewall rule already exists for TCP port $Port ($Profile profile)."
  }
  exit 0
}

if ($PSCmdlet.ShouldProcess($ruleName, "Create OpenPets LAN firewall rule")) {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile $Profile `
    -Description $description | Out-Null
}

if ($WhatIfPreference) {
  Write-Host "Previewed OpenPets LAN firewall rule for TCP port $Port ($Profile profile)."
} else {
  Write-Host "Created OpenPets LAN firewall rule for TCP port $Port ($Profile profile)."
}
