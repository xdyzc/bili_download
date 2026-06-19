param(
    [string]$Video = "",
    [string]$Quality = "",
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Downloader = Join-Path $ProjectRoot ".venv\Scripts\bili-download.exe"
$CookieFile = Join-Path $ProjectRoot "bili.json"

Write-Host ""
Write-Host "Bili Download"
Write-Host "============="
Write-Host ""

if (-not (Test-Path $Downloader)) {
    Write-Host "Downloader command was not found:"
    Write-Host "  $Downloader"
    Write-Host ""
    Write-Host "Run this once from the project directory first:"
    Write-Host "  python -m venv .venv"
    Write-Host "  .\.venv\Scripts\python.exe -m pip install -e . pytest"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($Video)) {
    $InputText = Read-Host "Enter BV id or Bilibili video URL"
} else {
    $InputText = $Video
}
$InputText = $InputText.Trim()

if ([string]::IsNullOrWhiteSpace($InputText)) {
    Write-Host "No input provided."
    if (-not $NoPause) {
        Read-Host "Press Enter to exit"
    }
    exit 1
}

$DownloadDir = Join-Path $ProjectRoot "downloads"
New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null

$CookieArgs = @()
if (Test-Path $CookieFile) {
    $CookieArgs = @("--cookie-file", $CookieFile)
    Write-Host "Using cookie file:"
    Write-Host "  $CookieFile"
    Write-Host ""
    Write-Host "Account status:"
    & $Downloader @CookieArgs account
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Could not verify cookie login status."
    }
    Write-Host ""
}

Write-Host "Available qualities:"
& $Downloader @CookieArgs qualities $InputText
if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not list qualities. You can still try the default download."
}
Write-Host ""

if ([string]::IsNullOrWhiteSpace($Quality) -and -not $NoPause) {
    $Quality = Read-Host "Enter quality code, or press Enter for default"
}
$Quality = $Quality.Trim()

Write-Host ""
Write-Host "Downloading to:"
Write-Host "  $DownloadDir"
Write-Host ""

$CommandArgs = $CookieArgs + @("download", $InputText, "--output-dir", $DownloadDir, "--overwrite", "--progress")
if (-not [string]::IsNullOrWhiteSpace($Quality)) {
    $CommandArgs += @("--quality", $Quality)
}

& $Downloader @CommandArgs
$ExitCode = $LASTEXITCODE

Write-Host ""
if ($ExitCode -eq 0) {
    Write-Host "Done."
} else {
    Write-Host "Download failed. Exit code: $ExitCode"
}

if (-not $NoPause) {
    Read-Host "Press Enter to exit"
}
exit $ExitCode
