# xactimate-worker

A small FastAPI service that runs on a cloud Windows VM and wraps Xactimate operations
behind an HTTPS API. Lets dumbroof-web (Railway) and Claude Code (CLI) drive Xactimate
from anywhere without needing to run Windows themselves.

## Architecture

```
Claude Code CLI  ─┐
                  ├─→  HTTPS  ─→  Paperspace Windows VM
dumbroof-web     ─┘                ├─ xactimate-worker (FastAPI :8080)
                                   ├─ Xactimate Desktop (interactive RDP for license requests)
                                   └─ Caddy reverse proxy (HTTPS :443 → :8080)
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Liveness probe (no auth) |
| GET | `/token/status` | Check if cached Xactimate JWT is still valid |
| GET | `/projects` | List all projects on the account |
| GET | `/projects?pricelist=NYBI` | Filter by pricelist code prefix |
| GET | `/pricelist/{code}/export` | Export priced 99-item template for any licensed pricelist |
| POST | `/pricelist/{code}/clone` | Provision a new empty project on a target pricelist |

All endpoints except `/healthz` require header `X-Worker-Secret: <env XACT_WORKER_SECRET>`.

## Deployment

On the freshly-provisioned Paperspace Windows VM, run from PowerShell as Admin:

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
iex (irm https://<your-host>/install-on-windows.ps1)
```

This:
1. Installs Python 3.12 silently
2. Installs nssm (Windows service manager)
3. Creates venv + installs FastAPI, uvicorn, httpx, openpyxl, pywin32
4. Prompts for `XACT_WORKER_SECRET`
5. Registers `xactimate-worker` as a Windows Service set to auto-start
6. Starts the service

After Caddy + DNS are wired up, test from anywhere:
```bash
curl -H "X-Worker-Secret: $XACT_WORKER_SECRET" \
  https://xact-worker.yourdomain.com/healthz
```

## Token refresh

The worker reads the cached Xactimate JWT from `C:\xactimate\xact-api-token.json`.
That token expires every ~12 hours. Refresh by running `xact-capture-token.js` on the
Windows VM (Tom logs in once + Gmail MFA), or build an automated refresh cron later.

## Integration with dumbroof-web

Add to `dumbroof-web` env vars:
```
XACTIMATE_WORKER_URL=https://xact-worker.yourdomain.com
XACTIMATE_WORKER_SECRET=<shared-with-VM>
```

Then in Python backend:
```python
from xactimate_worker_client import fetch_pricelist
prices = fetch_pricelist("TXHO8X_APR26")
```
