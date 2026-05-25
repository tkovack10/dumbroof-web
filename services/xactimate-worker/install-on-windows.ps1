# install-on-windows.ps1
# Run this on the freshly-provisioned Paperspace Windows machine
# to set up the xactimate-worker as a Windows Service.
#
# Usage (from PowerShell as Admin):
#   Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
#   iex (irm https://<your-host>/install-on-windows.ps1)

$ErrorActionPreference = "Stop"

$INSTALL_DIR = "C:\xactimate-worker"
$VENV_DIR = "$INSTALL_DIR\.venv"
$SERVICE_NAME = "xactimate-worker"
$LOG_DIR = "C:\xactimate-worker\logs"

Write-Host "[1/8] Creating directories..."
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
New-Item -ItemType Directory -Force -Path "C:\xactimate" | Out-Null

Write-Host "[2/8] Installing Python 3.12 (if not present)..."
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    $py = "$env:TEMP\python-installer.exe"
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe" -OutFile $py
    Start-Process -Wait -FilePath $py -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1", "Include_pip=1"
}

Write-Host "[3/8] Installing nssm (Non-Sucking Service Manager)..."
$nssm = "$INSTALL_DIR\nssm.exe"
if (-not (Test-Path $nssm)) {
    $zip = "$env:TEMP\nssm.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath "$env:TEMP\nssm" -Force
    Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" $nssm
}

Write-Host "[4/8] Creating venv + installing requirements..."
& python -m venv $VENV_DIR
& "$VENV_DIR\Scripts\pip.exe" install --upgrade pip
& "$VENV_DIR\Scripts\pip.exe" install fastapi "uvicorn[standard]" httpx openpyxl pydantic pywin32

Write-Host "[5/8] Reading XACT_WORKER_SECRET from prompt..."
if (-not $env:XACT_WORKER_SECRET) {
    $secure = Read-Host "Enter XACT_WORKER_SECRET (shared with dumbroof-web)" -AsSecureString
    $env:XACT_WORKER_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    [Environment]::SetEnvironmentVariable("XACT_WORKER_SECRET", $env:XACT_WORKER_SECRET, "Machine")
}

Write-Host "[6/8] Stopping existing service if running..."
& $nssm stop $SERVICE_NAME 2>$null
& $nssm remove $SERVICE_NAME confirm 2>$null

Write-Host "[7/8] Installing service..."
& $nssm install $SERVICE_NAME "$VENV_DIR\Scripts\python.exe" `
    "-m" "uvicorn" "main:app" "--host" "0.0.0.0" "--port" "8080"
& $nssm set $SERVICE_NAME AppDirectory $INSTALL_DIR
& $nssm set $SERVICE_NAME AppEnvironmentExtra "XACT_WORKER_SECRET=$env:XACT_WORKER_SECRET"
& $nssm set $SERVICE_NAME AppStdout "$LOG_DIR\stdout.log"
& $nssm set $SERVICE_NAME AppStderr "$LOG_DIR\stderr.log"
& $nssm set $SERVICE_NAME Start SERVICE_AUTO_START

Write-Host "[8/8] Starting service..."
& $nssm start $SERVICE_NAME

Write-Host ""
Write-Host "✅ xactimate-worker installed."
Write-Host "   Service: $SERVICE_NAME (autostart)"
Write-Host "   Logs:    $LOG_DIR\stdout.log"
Write-Host "   Health:  curl http://localhost:8080/healthz"
Write-Host ""
Write-Host "NEXT: install Caddy for HTTPS reverse proxy, configure DNS, open firewall port 443."
