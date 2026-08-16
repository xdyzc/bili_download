[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$HostExe,

  [ValidateSet('Chrome', 'Edge')]
  [string[]]$Browser = @('Chrome'),

  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'BiliDownloadCompanion')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostPath = (Resolve-Path -LiteralPath $HostExe).Path
if ([IO.Path]::GetExtension($hostPath) -ne '.exe') {
  throw 'HostExe must be a built .exe native host. Do not register a shell wrapper.'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$templatePath = Join-Path $scriptDir 'com.bili_download.stream_companion.json.template'
if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
  throw 'Native host manifest template was not found next to this installer.'
}

$resolvedInstallDir = [IO.Path]::GetFullPath($InstallDir)
New-Item -ItemType Directory -Path $resolvedInstallDir -Force | Out-Null
$manifestPath = Join-Path $resolvedInstallDir 'com.bili_download.stream_companion.json'

# JSON needs escaped backslashes. The extension ID is constrained above, and
# HostExe has been resolved as an existing local .exe rather than treated as a
# shell command.
$escapedHostPath = $hostPath.Replace('\', '\\')
$template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
$manifest = $template.Replace('%HOST_PATH%', $escapedHostPath).Replace('%EXTENSION_ID%', $ExtensionId)
$manifest | ConvertFrom-Json | Out-Null
[IO.File]::WriteAllText($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))

$registryRoots = @{
  Chrome = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts'
  Edge = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'
}
$hostName = 'com.bili_download.stream_companion'
foreach ($browserName in $Browser) {
  $keyPath = Join-Path $registryRoots[$browserName] $hostName
  New-Item -Path $keyPath -Force | Out-Null
  Set-Item -Path $keyPath -Value $manifestPath
}

Write-Output "Registered $hostName for $($Browser -join ', ')"
Write-Output "Manifest: $manifestPath"
Write-Output "Host executable: $hostPath"
