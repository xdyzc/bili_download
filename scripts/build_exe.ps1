$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Host "Virtual environment was not found. Creating .venv..."
    python -m venv .venv
}

Write-Host "Installing project and build dependencies..."
& $Python -m pip install -e ".[build]" pytest

Write-Host "Running tests..."
& $Python -m pytest

Write-Host "Building GUI executable..."
& $Python -m PyInstaller `
    --onefile `
    --windowed `
    --name BiliDownload `
    --clean `
    --noconfirm `
    --collect-all imageio_ffmpeg `
    --hidden-import imageio_ffmpeg `
    packaging\entrypoint.py

Write-Host "Building CLI executable..."
& $Python -m PyInstaller `
    --onefile `
    --console `
    --name BiliDownloadCLI `
    --clean `
    --noconfirm `
    --collect-all imageio_ffmpeg `
    --hidden-import imageio_ffmpeg `
    packaging\cli_entrypoint.py

$ReleaseDir = Join-Path $ProjectRoot "release"
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
Copy-Item -Force (Join-Path $ProjectRoot "dist\BiliDownload.exe") (Join-Path $ReleaseDir "BiliDownload.exe")
Copy-Item -Force (Join-Path $ProjectRoot "dist\BiliDownloadCLI.exe") (Join-Path $ReleaseDir "BiliDownloadCLI.exe")

Write-Host ""
Write-Host "Built:"
Write-Host "  $ReleaseDir\BiliDownload.exe"
Write-Host "  $ReleaseDir\BiliDownloadCLI.exe"
Write-Host ""
Write-Host "Put bili.json next to BiliDownload.exe before sharing or running with cookies."
