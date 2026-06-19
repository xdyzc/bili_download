param(
    [string]$Video = "",
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Downloader = Join-Path $ProjectRoot ".venv\Scripts\bili-download.exe"

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

Write-Host ""
Write-Host "Downloading to:"
Write-Host "  $DownloadDir"
Write-Host ""

& $Downloader download $InputText --output-dir $DownloadDir --overwrite
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
