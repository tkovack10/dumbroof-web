"""
xactimate-worker — runs on cloud Windows VM, wraps Xactimate operations
behind a simple HTTPS API that dumbroof-web (Railway) and Claude Code (CLI)
can call from anywhere.

Two operation modes per endpoint:
  1. REST API mode — for read-heavy ops (pricelist export, project search).
     Hits xo-g0-prod.xactimate.com/v1 with the cached bearer token.
  2. Desktop control mode — for ops that require Xactimate Desktop UI
     (requesting new pricelist licenses, ESX advanced features).
     Uses pywin32 + COM automation. Windows-only.

Auth: every request must include `X-Worker-Secret: <env XACT_WORKER_SECRET>`.
HTTPS termination via Caddy reverse proxy (separate process).
"""
from __future__ import annotations

import base64
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# ─── Config ────────────────────────────────────────────────────────────────
WORKER_SECRET = os.environ.get("XACT_WORKER_SECRET")
if not WORKER_SECRET:
    raise SystemExit("XACT_WORKER_SECRET env var required")

TOKEN_FILE = Path(os.environ.get("XACT_TOKEN_FILE", "C:/xactimate/xact-api-token.json"))
INSTANCE = os.environ.get("XACT_INSTANCE", "121247")
API_BASE = "https://xo-g0-prod.xactimate.com/v1"

# Project GUIDs known from earlier work
TEMPLATE_GUID = "dd012744-a0f2-4136-83af-0e2bb8b31bf2"  # 99-item TEMPLATE on NYBI8X_MAR26
ALS_GUID = "fc7cf1f9-5d8c-4745-bd02-b6dabd2c36a4"        # ALS_TESTING_PRICE on SCRH8X_02MAY26

app = FastAPI(title="xactimate-worker", version="0.1.0")


# ─── Auth middleware ───────────────────────────────────────────────────────
@app.middleware("http")
async def require_worker_secret(request: Request, call_next):
    if request.url.path == "/healthz":
        return await call_next(request)
    secret = request.headers.get("x-worker-secret")
    if secret != WORKER_SECRET:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)


# ─── Token loading ─────────────────────────────────────────────────────────
def _load_token() -> str:
    if not TOKEN_FILE.exists():
        raise HTTPException(503, f"token file not found at {TOKEN_FILE}; run xact-capture-token.js")
    data = json.loads(TOKEN_FILE.read_text())
    token = data.get("token", "")
    if not token:
        raise HTTPException(503, "token field empty in token file")
    return token


# ─── Health ────────────────────────────────────────────────────────────────
@app.get("/healthz")
def healthz():
    token_exists = TOKEN_FILE.exists()
    return {
        "status": "ok",
        "now": datetime.now(timezone.utc).isoformat(),
        "token_file": str(TOKEN_FILE),
        "token_present": token_exists,
        "instance": INSTANCE,
    }


# ─── Project search ────────────────────────────────────────────────────────
@app.get("/projects")
def list_projects(pricelist: Optional[str] = None):
    """List all projects on the account. Optionally filter by pricelist code prefix."""
    token = _load_token()
    with httpx.Client(timeout=30) as client:
        r = client.post(
            f"{API_BASE}/instance/{INSTANCE}/project/search?pageNumber=1&pageSize=200",
            headers={"Authorization": token, "Content-Type": "application/json"},
            json={},
        )
        r.raise_for_status()
        plist = r.json().get("projectList", [])
        if pricelist:
            plist = [p for p in plist if (p.get("priceListCode") or "").startswith(pricelist)]
        return {"count": len(plist), "projects": plist}


# ─── Pricelist export ──────────────────────────────────────────────────────
class PriceListExportResponse(BaseModel):
    pricelist_code: str
    project_guid: str
    rows: list[dict]
    fetched_at: str


@app.get("/pricelist/{code}/export", response_model=PriceListExportResponse)
def export_pricelist(code: str):
    """
    Export the priced 99-item template against the requested pricelist.
    Strategy: find a project on this pricelist, hit excelExport, parse rows.
    If no project exists on this pricelist, return 404 (need Desktop to provision).
    """
    token = _load_token()
    with httpx.Client(timeout=30) as client:
        # Find any project on this pricelist
        ps = client.post(
            f"{API_BASE}/instance/{INSTANCE}/project/search?pageNumber=1&pageSize=200",
            headers={"Authorization": token, "Content-Type": "application/json"},
            json={},
        )
        ps.raise_for_status()
        candidates = [
            p for p in ps.json().get("projectList", [])
            if p.get("priceListCode") == code and (p.get("totalLineItems") or 0) > 50
        ]
        if not candidates:
            raise HTTPException(
                404,
                f"No populated project on pricelist {code}. "
                f"Provision via /pricelist/{code}/clone first.",
            )
        guid = candidates[0]["projectGuid"]
        profile = candidates[0].get("profileCode", "8D")
        # Hit excelExport
        ex = client.get(
            f"{API_BASE}/instance/{INSTANCE}/project/{guid}/profile/{profile}/excelExport",
            headers={"Authorization": token},
        )
        ex.raise_for_status()
        raw = ex.text
        # Strip JSON string wrapper if present
        if raw.startswith('"') and raw.endswith('"'):
            raw = raw[1:-1]
        xlsx_bytes = base64.b64decode(raw)

    # Parse xlsx (openpyxl is small enough to import lazily)
    import openpyxl, io
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True, read_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None) or ()
    col = {(h or "").lower(): i for i, h in enumerate(header)}
    out = []
    for row in rows_iter:
        if not row or len(row) < 12:
            continue
        desc = row[col.get("desc", 4)]
        if not desc:
            continue
        out.append({
            "category": row[col.get("cat", 22)],
            "code": row[col.get("sel", 23)],
            "description": desc,
            "unit": row[col.get("unit", 9)],
            "unit_price": row[col.get("unit cost", 11)],
        })

    return PriceListExportResponse(
        pricelist_code=code,
        project_guid=guid,
        rows=out,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )


# ─── Clone template to new pricelist ───────────────────────────────────────
class CloneRequest(BaseModel):
    pricelist_code: str = Field(..., description="Target pricelist e.g. TXHO8X_APR26")
    source_guid: str = Field(default=TEMPLATE_GUID, description="GUID of populated source template")
    new_project_code: Optional[str] = None


@app.post("/pricelist/{code}/clone")
def clone_to_pricelist(code: str, body: CloneRequest):
    """
    Create a new project on the target pricelist by cloning the 99-item template.
    Requires the target pricelist to be licensed on the account.
    """
    token = _load_token()
    project_code = body.new_project_code or f"AUTO_{code}_{int(time.time())}"

    with httpx.Client(timeout=60) as client:
        # Create the project on the target pricelist
        payload = {
            "profileCode": "8D",
            "projectType": 0,
            "projectCode": project_code,
            "priceListCode": code,
            "addresses": [{"type": "Property", "format": 0, "country": 1, "primary": True}],
        }
        r = client.post(
            f"{API_BASE}/instance/{INSTANCE}/project",
            headers={"Authorization": token, "Content-Type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        new_proj = r.json()
        new_guid = new_proj["projectGuid"]
        actual_pricelist = new_proj.get("priceListCode")

        # Verify the pricelist actually stuck (silent fallback to NYBI8X_MAR26 means not licensed)
        if actual_pricelist != code:
            client.delete(
                f"{API_BASE}/instance/{INSTANCE}/project/{new_guid}",
                headers={"Authorization": token, "Content-Type": "application/json"},
                content=json.dumps({"projectGuid": new_guid}),
            )
            raise HTTPException(
                422,
                f"Pricelist {code} not licensed on this account "
                f"(API silently substituted {actual_pricelist}). "
                f"Request the license via Xactimate Desktop → Preferences → Price Lists → Request.",
            )

        return {
            "project_guid": new_guid,
            "project_code": project_code,
            "pricelist": actual_pricelist,
            "note": "Empty project. Next step: import line items via ESX or copy from template.",
        }


# ─── Token refresh probe ───────────────────────────────────────────────────
@app.get("/token/status")
def token_status():
    """Check if the cached token is still valid by making a probe API call."""
    try:
        token = _load_token()
    except HTTPException as e:
        return {"valid": False, "reason": e.detail}
    with httpx.Client(timeout=10) as client:
        r = client.get(
            f"{API_BASE}/instance/{INSTANCE}",
            headers={"Authorization": token},
        )
    if r.status_code == 200:
        return {"valid": True, "instance_name": r.json().get("name")}
    return {"valid": False, "status_code": r.status_code, "reason": r.text[:200]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
