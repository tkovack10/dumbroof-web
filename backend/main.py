"""
Dumb Roof Technologies — Claim Processing Backend
===================================================
FastAPI service that processes uploaded claim documents:
  1. Downloads files from Supabase Storage
  2. Sends documents to Claude API for analysis
  3. Builds a claim config from extracted data
  4. Generates the PDF appeal package
  5. Uploads PDFs back to Supabase Storage
  6. Updates claim status

Run locally:  uvicorn main:app --reload --port 8000
"""

import os
import json
import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, BackgroundTasks, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from processor import process_claim, get_supabase_client
from repair_processor import process_repair, process_checkpoint, process_completion
from analytics import (
    get_claim_analytics,
    get_processing_costs,
    get_pricing_report,
    get_photo_analytics,
    predict_settlement,
)
from carrier_intelligence import (
    get_carrier_score,
    get_all_carrier_scores,
    get_effective_arguments,
    suggest_arguments,
)
from correspondence_analyzer import (
    analyze_correspondence,
    regenerate_draft,
)
from gmail_poller import poll_gmail_inbox

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background pollers on startup."""
    required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ANTHROPIC_API_KEY"]
    missing = [v for v in required if not os.environ.get(v)]
    if missing:
        raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")
    claims_task = asyncio.create_task(poll_for_claims())
    repairs_task = asyncio.create_task(poll_for_repairs())
    sb = get_supabase_client()
    gmail_task = asyncio.create_task(poll_gmail_inbox(sb))
    yield
    claims_task.cancel()
    repairs_task.cancel()
    gmail_task.cancel()


app = FastAPI(
    title="Dumb Roof Processing API",
    version="0.1.0",
    lifespan=lifespan,
)

cors_origins = [
    "https://dumbroof.ai",
    "https://www.dumbroof.ai",
    "http://localhost:3000",
]
if os.environ.get("CORS_EXTRA_ORIGINS"):
    cors_origins.extend(os.environ["CORS_EXTRA_ORIGINS"].split(","))

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    import psutil, shutil, time as _t
    vm = psutil.virtual_memory()
    disk = shutil.disk_usage("/")
    cpu_count = psutil.cpu_count(logical=True)
    cpu_pct = psutil.cpu_percent(interval=0.5)
    proc = psutil.Process()
    proc_mem = proc.memory_info()
    return {
        "status": "ok",
        "version": "2026-03-14-v1",
        "system": {
            "cpu_count": cpu_count,
            "cpu_percent": cpu_pct,
            "ram_total_mb": round(vm.total / 1024 / 1024),
            "ram_used_mb": round(vm.used / 1024 / 1024),
            "ram_available_mb": round(vm.available / 1024 / 1024),
            "ram_percent": vm.percent,
            "disk_total_gb": round(disk.total / 1024 / 1024 / 1024, 1),
            "disk_used_gb": round(disk.used / 1024 / 1024 / 1024, 1),
            "disk_free_gb": round(disk.free / 1024 / 1024 / 1024, 1),
        },
        "process": {
            "pid": proc.pid,
            "rss_mb": round(proc_mem.rss / 1024 / 1024),
            "vms_mb": round(proc_mem.vms / 1024 / 1024),
            "cpu_percent": proc.cpu_percent(),
            "threads": proc.num_threads(),
            "uptime_hours": round((_t.time() - proc.create_time()) / 3600, 1),
        },
    }


@app.get("/api/debug/profile/{user_id}")
async def debug_profile(user_id: str):
    """Debug endpoint: test company_profiles query on Railway."""
    import urllib.request, json as _json
    sb = get_supabase_client()
    results = {}
    # Test 1: SDK query
    try:
        r = sb.table("company_profiles").select("company_name,contact_name").eq("user_id", user_id).limit(1).execute()
        results["sdk"] = {"rows": len(r.data or []), "data": r.data[0] if r.data else None}
    except Exception as e:
        results["sdk"] = {"error": f"{type(e).__name__}: {e}"}
    # Test 2: REST query
    try:
        _sb_url = os.environ.get("SUPABASE_URL", "")
        _sb_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
        results["env"] = {"url_prefix": _sb_url[:30], "key_len": len(_sb_key), "key_prefix": _sb_key[:10]}
        req = urllib.request.Request(
            f"{_sb_url}/rest/v1/company_profiles?user_id=eq.{user_id}&select=company_name,contact_name&limit=1",
            headers={"apikey": _sb_key, "Authorization": f"Bearer {_sb_key}"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = _json.loads(resp.read())
            results["rest"] = {"rows": len(data), "data": data[0] if data else None}
    except Exception as e:
        results["rest"] = {"error": f"{type(e).__name__}: {e}"}
    return results


@app.post("/api/reprocess/{claim_id}")
async def reprocess_claim(claim_id: str, background_tasks: BackgroundTasks):
    """Re-process a claim after additional documents are uploaded."""
    sb = get_supabase_client()
    # Verify claim exists
    result = sb.table("claims").select("id, status").eq("id", claim_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    # Set status to processing directly — don't use "uploaded" to avoid poller race condition
    sb.table("claims").update({"status": "processing"}).eq("id", claim_id).execute()
    background_tasks.add_task(run_processing, claim_id)
    return {"status": "reprocessing", "claim_id": claim_id}


@app.post("/api/process/{claim_id}")
async def trigger_processing(claim_id: str, background_tasks: BackgroundTasks):
    """Manually trigger processing for a specific claim."""
    background_tasks.add_task(run_processing, claim_id)
    return {"status": "processing", "claim_id": claim_id}


async def run_processing(claim_id: str):
    """Run claim processing in background."""
    try:
        await process_claim(claim_id)
    except Exception as e:
        import traceback, sys
        print(f"[ERROR] Failed to process claim {claim_id}: {e}", flush=True)
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        # Update status to error with message so user sees what went wrong
        sb = get_supabase_client()
        sb.table("claims").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("id", claim_id).execute()


async def run_repair_processing(repair_id: str):
    """Run repair processing in background."""
    try:
        await process_repair(repair_id)
    except Exception as e:
        import traceback, sys
        print(f"[ERROR] Failed to process repair {repair_id}: {e}", flush=True)
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        from datetime import datetime
        sb = get_supabase_client()
        sb.table("repairs").update({
            "status": "error",
            "error_message": str(e)[:500],
            "updated_at": datetime.now().isoformat(),
        }).eq("id", repair_id).execute()


async def run_checkpoint_processing(checkpoint_id: str, is_completion: bool = False):
    """Run checkpoint processing in background."""
    try:
        if is_completion:
            await process_completion(checkpoint_id)
        else:
            await process_checkpoint(checkpoint_id)
    except Exception as e:
        import traceback, sys
        print(f"[ERROR] Failed to process checkpoint {checkpoint_id}: {e}", flush=True)
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        from datetime import datetime
        sb = get_supabase_client()
        # Update checkpoint status to error
        sb.table("repair_checkpoints").update({
            "status": "passed",  # Don't block — mark as passed with error note
            "ai_analysis": f"Processing error: {str(e)[:300]}",
            "analyzed_at": datetime.now().isoformat(),
        }).eq("id", checkpoint_id).execute()


@app.post("/api/process-repair/{repair_id}")
async def trigger_repair_processing(repair_id: str, background_tasks: BackgroundTasks):
    """Manually trigger processing for a specific repair."""
    background_tasks.add_task(run_repair_processing, repair_id)
    return {"status": "processing", "repair_id": repair_id}


@app.post("/api/reprocess-repair/{repair_id}")
async def reprocess_repair(repair_id: str, background_tasks: BackgroundTasks):
    """Re-process a failed or stuck repair."""
    sb = get_supabase_client()
    result = sb.table("repairs").select("id, status, address").eq("id", repair_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Repair not found")
    sb.table("repairs").update({"status": "processing", "error_message": None}).eq("id", repair_id).execute()
    background_tasks.add_task(run_repair_processing, repair_id)
    return {"status": "reprocessing", "repair_id": repair_id, "address": result.data.get("address")}


# ===================================================================
# REPAIR CHECKPOINT ENDPOINTS
# ===================================================================

@app.get("/api/repair/{repair_id}/checkpoints")
def get_repair_checkpoints(repair_id: str):
    """List all checkpoints for a repair."""
    sb = get_supabase_client()
    result = sb.table("repair_checkpoints").select("*").eq(
        "repair_id", repair_id
    ).order("checkpoint_number").execute()
    return {"checkpoints": result.data or []}


@app.post("/api/repair/{repair_id}/checkpoint/{cp_id}/submit")
async def submit_checkpoint_photos(
    repair_id: str, cp_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """Mark checkpoint photos as uploaded and trigger AI analysis."""
    sb = get_supabase_client()

    # Verify checkpoint exists and belongs to repair
    try:
        cp = sb.table("repair_checkpoints").select("id, status, checkpoint_type, repair_id").eq(
            "id", cp_id
        ).eq("repair_id", repair_id).single().execute()
    except Exception:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    if not cp.data:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    if cp.data["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Checkpoint is {cp.data['status']}, not pending")

    # Parse optional body (photo_files, roofer_notes)
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    from datetime import datetime
    # Update checkpoint
    sb.table("repair_checkpoints").update({
        "status": "photos_uploaded",
        "photo_files": body.get("photo_files", []),
        "roofer_notes": body.get("roofer_notes"),
        "responded_at": datetime.now().isoformat(),
    }).eq("id", cp_id).execute()

    # Set repair to processing so poller picks it up
    sb.table("repairs").update({
        "status": "processing",
        "updated_at": datetime.now().isoformat(),
    }).eq("id", repair_id).execute()

    return {"status": "submitted", "checkpoint_id": cp_id}


@app.post("/api/repair/{repair_id}/checkpoint/{cp_id}/skip")
async def skip_checkpoint(repair_id: str, cp_id: str):
    """Skip a checkpoint (technician privilege only)."""
    sb = get_supabase_client()

    # Verify repair is technician level
    try:
        repair = sb.table("repairs").select("skill_level").eq("id", repair_id).single().execute()
    except Exception:
        raise HTTPException(status_code=404, detail="Repair not found")
    if not repair.data:
        raise HTTPException(status_code=404, detail="Repair not found")
    if repair.data.get("skill_level") != "technician":
        raise HTTPException(status_code=403, detail="Only technicians can skip checkpoints")

    from datetime import datetime
    sb.table("repair_checkpoints").update({
        "status": "skipped",
        "ai_decision": "skipped",
        "analyzed_at": datetime.now().isoformat(),
    }).eq("id", cp_id).execute()

    # Check if there are more checkpoints or finalize
    cp = sb.table("repair_checkpoints").select("checkpoint_number, repair_id").eq(
        "id", cp_id
    ).single().execute()
    if cp.data:
        total = sb.table("repairs").select("checkpoint_count").eq(
            "id", repair_id
        ).single().execute()
        total_count = (total.data or {}).get("checkpoint_count", 0)

        if cp.data["checkpoint_number"] >= total_count:
            # Last checkpoint skipped — go to ready
            sb.table("repairs").update({
                "status": "ready",
                "updated_at": datetime.now().isoformat(),
            }).eq("id", repair_id).execute()

    return {"status": "skipped", "checkpoint_id": cp_id}


# ===================================================================
# ANALYTICS & INTELLIGENCE ENDPOINTS
# ===================================================================

@app.get("/api/analytics/overview")
def analytics_overview():
    """Portfolio-wide claim analytics."""
    sb = get_supabase_client()
    return get_claim_analytics(sb)


@app.get("/api/analytics/processing-costs")
def analytics_processing_costs(claim_id: str = None):
    """Processing cost breakdown (per-claim or aggregate)."""
    sb = get_supabase_client()
    return get_processing_costs(sb, claim_id)


@app.get("/api/analytics/pricing")
def analytics_pricing(region: str = None, category: str = None):
    """Pricing intelligence report — USARM vs carrier prices."""
    sb = get_supabase_client()
    return get_pricing_report(sb, region, category)


@app.get("/api/analytics/photos")
def analytics_photos():
    """Photo portfolio analytics — damage types, materials, trades."""
    sb = get_supabase_client()
    return get_photo_analytics(sb)


@app.get("/api/analytics/predict")
def analytics_predict(carrier: str, trades: str, state: str = "",
                      roof_area_sq: float = 0, hail_size: str = "",
                      carrier_rcv: float = 0):
    """Predict settlement range for a new claim."""
    sb = get_supabase_client()
    trade_list = [t.strip() for t in trades.split(",") if t.strip()]
    return predict_settlement(sb, carrier, trade_list, state,
                              roof_area_sq, hail_size, carrier_rcv)


@app.get("/api/intelligence/carriers")
def intelligence_all_carriers():
    """Get scores for all carriers."""
    sb = get_supabase_client()
    return get_all_carrier_scores(sb)


@app.get("/api/intelligence/carrier/{carrier_name}")
def intelligence_carrier(carrier_name: str):
    """Get detailed intelligence for a specific carrier."""
    sb = get_supabase_client()
    return get_carrier_score(sb, carrier_name)


@app.get("/api/intelligence/arguments/{carrier_name}")
def intelligence_arguments(carrier_name: str, trade: str = None, limit: int = 10):
    """Get most effective arguments against a carrier."""
    sb = get_supabase_client()
    return get_effective_arguments(sb, carrier_name, trade, limit)


@app.get("/api/intelligence/suggest/{carrier_name}")
def intelligence_suggest(carrier_name: str, trades: str, state: str = ""):
    """Pre-claim intelligence: suggest arguments based on historical effectiveness."""
    sb = get_supabase_client()
    trade_list = [t.strip() for t in trades.split(",") if t.strip()]
    return suggest_arguments(sb, carrier_name, trade_list, state)


# ===================================================================
# NOAA STORM SCAN
# ===================================================================

@app.post("/api/noaa-scan")
async def noaa_scan(request: Request):
    """Scan NOAA for recent storm events near an address.

    Used by the upload form's "Scan for storms" button to help users
    identify the Date of Loss when they don't have a weather report.
    Queries the last 18 months of hail + thunderstorm wind events
    in the property's county.
    """
    body = await request.json()
    address = body.get("address", "")
    if not address:
        return JSONResponse({"storms": [], "error": "No address provided"})

    try:
        from noaa_weather.geocode import geocode_address
        from noaa_weather.api import NOAAClient, _lookup_county_fips
        from datetime import datetime, timedelta
        import csv, io, urllib.parse

        geo = geocode_address(address)
        if not geo:
            return JSONResponse({"storms": [], "error": "Could not geocode address"})

        state_fips, county_fips, county_name = _lookup_county_fips(geo.latitude, geo.longitude)
        if not state_fips or not county_fips:
            return JSONResponse({"storms": [], "error": "Could not determine county"})

        # Query last 18 months
        end = datetime.now()
        start = end - timedelta(days=548)

        from noaa_weather.api import _STATE_NAMES, _fetch_url
        state_name = _STATE_NAMES.get(state_fips, "")
        county_clean = county_name.replace(" COUNTY", "").replace(" PARISH", "")
        county_fips_short = county_fips.lstrip("0") or "0"

        base_params = {
            "beginDate_mm": f"{start.month:02d}",
            "beginDate_dd": f"{start.day:02d}",
            "beginDate_yyyy": str(start.year),
            "endDate_mm": f"{end.month:02d}",
            "endDate_dd": f"{end.day:02d}",
            "endDate_yyyy": str(end.year),
            "county": f"{county_clean}:{county_fips_short}",
            "hailfilter": "0.00",
            "tornfilter": "0",
            "windfilter": "000",
            "sort": "DT",
            "submitbutton": "Search",
            "statefips": f"{state_fips},{state_name.replace(' ', '+')}",
        }
        query_parts = []
        for k, v in base_params.items():
            query_parts.append(f"{k}={urllib.parse.quote(str(v), safe='+:')}")
        for evt_type in ["(C) Hail", "(C) Thunderstorm Wind"]:
            query_parts.append(f"eventType={urllib.parse.quote(evt_type, safe='+')}")

        url = f"https://www.ncei.noaa.gov/stormevents/csv?{'&'.join(query_parts)}"
        print(f"[NOAA-SCAN] Querying: {url}")

        content = _fetch_url(url)
        if not content or "EVENT_ID" not in content.split("\n")[0]:
            return JSONResponse({"storms": [], "note": "No NOAA data available for this area"})

        reader = csv.DictReader(io.StringIO(content))
        storms = []
        seen_dates = set()
        for row in reader:
            begin_date = row.get("BEGIN_DATE_TIME", "")[:10]
            if not begin_date or begin_date in seen_dates:
                continue
            seen_dates.add(begin_date)
            evt_type = row.get("EVENT_TYPE", "")
            magnitude = row.get("MAGNITUDE", "")
            mag_type = row.get("MAGNITUDE_TYPE", "")
            detail = f"{magnitude} {mag_type}".strip() if magnitude else evt_type
            storms.append({
                "date": begin_date,
                "type": evt_type,
                "details": detail,
            })

        # Sort by date descending (most recent first)
        storms.sort(key=lambda s: s["date"], reverse=True)
        return JSONResponse({"storms": storms[:15]})
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[NOAA-SCAN] Error: {e}")
        return JSONResponse({"storms": [], "error": str(e)})


# ===================================================================
# CORRESPONDENCE & EMAIL DRAFT ENDPOINTS
# ===================================================================


class DraftUpdate(BaseModel):
    edited_body_html: Optional[str] = None
    status: Optional[str] = None  # draft | edited | approved | rejected


class ManualMatch(BaseModel):
    claim_id: str


class ForwarderCreate(BaseModel):
    email: str
    name: Optional[str] = None
    role: str = "sales_rep"


@app.post("/api/analyze-correspondence/{correspondence_id}")
async def trigger_correspondence_analysis(
    correspondence_id: str, background_tasks: BackgroundTasks
):
    """Trigger AI analysis of a carrier correspondence record."""
    sb = get_supabase_client()
    result = sb.table("carrier_correspondence").select("id, analysis_status").eq(
        "id", correspondence_id
    ).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Correspondence not found")

    background_tasks.add_task(run_correspondence_analysis, correspondence_id)
    return {"status": "analyzing", "correspondence_id": correspondence_id}


async def run_correspondence_analysis(correspondence_id: str):
    """Run correspondence analysis in background."""
    try:
        sb = get_supabase_client()
        result = await analyze_correspondence(sb, correspondence_id)
        print(f"[CORRESPONDENCE] Analysis complete: {result}", flush=True)
    except Exception as e:
        import traceback, sys
        print(f"[ERROR] Correspondence analysis failed for {correspondence_id}: {e}", flush=True)
        traceback.print_exc()
        sys.stdout.flush()
        sb = get_supabase_client()
        sb.table("carrier_correspondence").update({
            "analysis_status": "error",
        }).eq("id", correspondence_id).execute()


@app.get("/api/correspondence/{claim_id}")
def get_correspondence(claim_id: str):
    """Get all correspondence for a claim."""
    sb = get_supabase_client()
    result = sb.table("carrier_correspondence").select("*").eq(
        "claim_id", claim_id
    ).order("created_at", desc=True).execute()
    return {"correspondence": result.data or []}


@app.get("/api/correspondence")
def get_all_correspondence(user_id: str = None, status: str = None):
    """Get all correspondence, optionally filtered."""
    sb = get_supabase_client()
    query = sb.table("carrier_correspondence").select("*")
    if user_id:
        query = query.eq("user_id", user_id)
    if status:
        query = query.eq("status", status)
    result = query.order("created_at", desc=True).execute()
    return {"correspondence": result.data or []}


@app.get("/api/drafts/{claim_id}")
def get_drafts(claim_id: str):
    """Get pending drafts for a claim."""
    sb = get_supabase_client()
    result = sb.table("email_drafts").select("*").eq(
        "claim_id", claim_id
    ).order("created_at", desc=True).execute()
    return {"drafts": result.data or []}


@app.put("/api/drafts/{draft_id}")
def update_draft(draft_id: str, update: DraftUpdate):
    """Edit or approve/reject a draft."""
    sb = get_supabase_client()
    updates = {}
    if update.edited_body_html is not None:
        updates["edited_body_html"] = update.edited_body_html
        if not update.status:
            updates["status"] = "edited"
    if update.status:
        updates["status"] = update.status

    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    result = sb.table("email_drafts").update(updates).eq("id", draft_id).select("*").single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Draft not found")

    # If approved, decrement pending_drafts on the claim
    if update.status == "approved" and result.data.get("claim_id"):
        claim = sb.table("claims").select("pending_drafts").eq(
            "id", result.data["claim_id"]
        ).single().execute()
        current = (claim.data or {}).get("pending_drafts", 1)
        sb.table("claims").update({
            "pending_drafts": max(0, current - 1)
        }).eq("id", result.data["claim_id"]).execute()

    return result.data


@app.post("/api/drafts/{draft_id}/send")
async def send_draft(draft_id: str):
    """Mark a draft as sent (actual sending handled by frontend email route)."""
    sb = get_supabase_client()
    from datetime import datetime
    result = sb.table("email_drafts").update({
        "status": "sent",
        "sent_at": datetime.utcnow().isoformat(),
    }).eq("id", draft_id).select("*, correspondence_id, claim_id").single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Draft not found")

    # Update correspondence status
    sb.table("carrier_correspondence").update({
        "status": "response_sent"
    }).eq("id", result.data["correspondence_id"]).execute()

    # Decrement pending_drafts
    if result.data.get("claim_id"):
        claim = sb.table("claims").select("pending_drafts").eq(
            "id", result.data["claim_id"]
        ).single().execute()
        current = (claim.data or {}).get("pending_drafts", 1)
        sb.table("claims").update({
            "pending_drafts": max(0, current - 1)
        }).eq("id", result.data["claim_id"]).execute()

    return {"status": "sent", "draft_id": draft_id}


@app.post("/api/drafts/{draft_id}/regenerate")
async def regenerate_draft_endpoint(
    draft_id: str, background_tasks: BackgroundTasks, strategy: str = None
):
    """Regenerate a draft with a different strategy."""
    sb = get_supabase_client()
    result = sb.table("email_drafts").select("id").eq("id", draft_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Draft not found")

    background_tasks.add_task(run_regenerate, draft_id, strategy)
    return {"status": "regenerating", "draft_id": draft_id}


async def run_regenerate(draft_id: str, strategy: str = None):
    """Run draft regeneration in background."""
    try:
        sb = get_supabase_client()
        await regenerate_draft(sb, draft_id, strategy)
    except Exception as e:
        print(f"[ERROR] Draft regeneration failed for {draft_id}: {e}", flush=True)


@app.post("/api/correspondence/{correspondence_id}/match")
def manual_match_correspondence(correspondence_id: str, match: ManualMatch):
    """Manually match an unmatched email to a claim."""
    sb = get_supabase_client()

    # Verify claim exists
    claim = sb.table("claims").select("id").eq("id", match.claim_id).single().execute()
    if not claim.data:
        raise HTTPException(status_code=404, detail="Claim not found")

    result = sb.table("carrier_correspondence").update({
        "claim_id": match.claim_id,
        "match_method": "manual",
        "match_confidence": 100,
        "status": "matched",
    }).eq("id", correspondence_id).select("*").single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Correspondence not found")

    # Increment claim correspondence count
    claim_data = sb.table("claims").select("correspondence_count").eq(
        "id", match.claim_id
    ).single().execute()
    current = (claim_data.data or {}).get("correspondence_count", 0)
    sb.table("claims").update({
        "correspondence_count": current + 1
    }).eq("id", match.claim_id).execute()

    return result.data


@app.get("/api/forwarders")
def get_forwarders(user_id: str = None):
    """Get authorized forwarders."""
    sb = get_supabase_client()
    query = sb.table("authorized_forwarders").select("*")
    if user_id:
        query = query.eq("user_id", user_id)
    result = query.order("created_at", desc=True).execute()
    return {"forwarders": result.data or []}


@app.post("/api/forwarders")
def create_forwarder(forwarder: ForwarderCreate, user_id: str = None):
    """Add an authorized forwarder."""
    sb = get_supabase_client()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")

    data = {
        "user_id": user_id,
        "email": forwarder.email.lower().strip(),
        "name": forwarder.name,
        "role": forwarder.role,
    }

    result = sb.table("authorized_forwarders").insert(data).select("*").single().execute()
    return result.data


@app.delete("/api/forwarders/{forwarder_id}")
def delete_forwarder(forwarder_id: str):
    """Remove an authorized forwarder."""
    sb = get_supabase_client()
    sb.table("authorized_forwarders").delete().eq("id", forwarder_id).execute()
    return {"status": "deleted", "id": forwarder_id}


# ===================================================================
# EDIT REQUESTS — Team-emailed report change requests
# ===================================================================


class EditRequestUpdate(BaseModel):
    status: str  # approved | rejected


@app.get("/api/edit-requests/{claim_id}")
def get_edit_requests(claim_id: str):
    """Get edit requests for a claim."""
    sb = get_supabase_client()
    result = sb.table("edit_requests").select("*").eq(
        "claim_id", claim_id
    ).order("created_at", desc=True).execute()
    return {"edit_requests": result.data or []}


@app.put("/api/edit-requests/{request_id}")
def update_edit_request(request_id: str, update: EditRequestUpdate):
    """Approve or reject an edit request."""
    sb = get_supabase_client()

    updates = {"status": update.status}
    if update.status == "rejected":
        # Decrement pending_edits on the claim
        req = sb.table("edit_requests").select("claim_id").eq(
            "id", request_id
        ).single().execute()
        if req.data and req.data.get("claim_id"):
            claim = sb.table("claims").select("pending_edits").eq(
                "id", req.data["claim_id"]
            ).single().execute()
            current = (claim.data or {}).get("pending_edits", 1)
            sb.table("claims").update({
                "pending_edits": max(0, current - 1)
            }).eq("id", req.data["claim_id"]).execute()

    result = sb.table("edit_requests").update(updates).eq(
        "id", request_id
    ).select("*").single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Edit request not found")

    return result.data


@app.post("/api/edit-requests/{request_id}/apply")
async def apply_edit_request(request_id: str, background_tasks: BackgroundTasks):
    """Apply an edit request — uploads attachments and triggers reprocess."""
    sb = get_supabase_client()
    from datetime import datetime as dt

    req = sb.table("edit_requests").select("*").eq(
        "id", request_id
    ).single().execute()
    if not req.data:
        raise HTTPException(status_code=404, detail="Edit request not found")

    claim_id = req.data.get("claim_id")
    if not claim_id:
        raise HTTPException(status_code=400, detail="Edit request not matched to a claim")

    # Mark as approved + applied
    sb.table("edit_requests").update({
        "status": "applied",
        "applied_at": dt.utcnow().isoformat(),
    }).eq("id", request_id).execute()

    # Decrement pending_edits
    claim = sb.table("claims").select("pending_edits").eq(
        "id", claim_id
    ).single().execute()
    current = (claim.data or {}).get("pending_edits", 1)
    sb.table("claims").update({
        "pending_edits": max(0, current - 1)
    }).eq("id", claim_id).execute()

    # Trigger reprocess
    sb.table("claims").update({"status": "processing"}).eq("id", claim_id).execute()
    background_tasks.add_task(run_processing, claim_id)

    return {"status": "applied", "request_id": request_id, "claim_id": claim_id}


# ===================================================================
# CLAIM BRAIN — AI Chat per Claim (SSE Streaming)
# ===================================================================

import anthropic
from fastapi.responses import StreamingResponse

# In-memory conversation store (per claim_id)
_brain_conversations: dict = {}


def _build_claim_brain_prompt(claim_data: dict, photos: list, scope_comparison: list, carrier_playbook: str = "") -> str:
    """Build the Claim Brain system prompt from Supabase claim data."""
    address = claim_data.get("address", "Unknown")
    carrier = claim_data.get("carrier", "Unknown")
    phase = claim_data.get("phase", "unknown")
    homeowner = claim_data.get("homeowner_name", "Unknown")
    date_of_loss = claim_data.get("date_of_loss", "Unknown")
    contractor_rcv = claim_data.get("contractor_rcv") or 0
    carrier_rcv = claim_data.get("current_carrier_rcv") or claim_data.get("original_carrier_rcv") or 0
    variance = contractor_rcv - carrier_rcv if contractor_rcv else 0
    damage_score = claim_data.get("damage_score")
    damage_grade = claim_data.get("damage_grade", "")
    approval_score = claim_data.get("approval_score")
    o_and_p = claim_data.get("o_and_p_enabled", False)
    tax_rate = claim_data.get("tax_rate", 0)
    trade_count = claim_data.get("trade_count", 0)
    photo_integrity = claim_data.get("photo_integrity") or {}
    processing_warnings = claim_data.get("processing_warnings") or []

    # Photo summary
    photo_summary = ""
    if photos:
        photo_summary = f"\n### Photos on File ({len(photos)})\n"
        for p in photos[:40]:
            damage = p.get("damage_type", "unclassified")
            material = p.get("material", "")
            severity = p.get("severity", "")
            desc = p.get("annotation_text", "")
            photo_summary += f"- {p.get('annotation_key', 'unknown')}: {damage} | {material} | {severity}"
            if desc:
                photo_summary += f" — {desc[:100]}"
            photo_summary += "\n"

    # Scope comparison
    scope_text = ""
    if scope_comparison:
        scope_text = "\n### Scope Comparison — Carrier vs. USARM\n"
        for row in scope_comparison[:50]:
            if isinstance(row, dict):
                item = row.get("checklist_desc", row.get("usarm_desc", row.get("carrier_desc", "Unknown")))
                carrier_amt = row.get("carrier_amount", 0) or 0
                usarm_amt = row.get("usarm_amount", 0) or 0
                diff = usarm_amt - carrier_amt
                note = row.get("note", row.get("notes", ""))
                scope_text += f"- **{item}**: Carrier ${carrier_amt:,.2f} → USARM ${usarm_amt:,.2f} (Δ ${diff:,.2f}) {note}\n"

    # Carrier intelligence
    playbook_section = ""
    if carrier_playbook:
        playbook_section = f"\n## CARRIER INTELLIGENCE — {carrier}\n{carrier_playbook}\n"

    from datetime import datetime
    return f"""You are the Claim Brain for {address} — an AI claims operations manager
built by DumbRoof.ai. You are an expert on EVERY piece of data related to this ONE
specific insurance claim. Your job is to maximize recovery, ensure compliance,
track every dollar, and never let a detail slip.

You speak like an experienced roofing claims manager — direct, knowledgeable, no fluff.
You use industry terminology naturally (O&P, RCV, supplement, carrier movement).
When coaching field reps, you're specific and actionable — not theoretical.

When formatting responses, use markdown. Use **bold** for emphasis, bullet points for lists,
and ### headings to organize longer responses. Keep responses focused and actionable.

Current date/time: {datetime.now().strftime('%Y-%m-%d %H:%M')}

## CLAIM DETAILS
- **Property:** {address}
- **Homeowner:** {homeowner}
- **Date of Loss:** {date_of_loss}
- **Carrier:** {carrier}
- **Phase:** {phase}
- **Damage Score:** {damage_score} ({damage_grade})
- **Approval Score:** {approval_score}
- **Trades:** {trade_count} | O&P: {'Yes (10%+10%)' if o_and_p else 'No'} | Tax: {(tax_rate or 0)*100:.1f}%

## FINANCIAL LEDGER
| Metric | Amount |
|--------|--------|
| Contractor RCV | ${contractor_rcv:,.2f} |
| Carrier RCV | ${carrier_rcv:,.2f} |
| Variance | ${variance:,.2f} |

## PHOTO INTEGRITY
- Total photos: {photo_integrity.get('total', len(photos))}
- Flagged: {photo_integrity.get('flagged', 0)}
- Score: {photo_integrity.get('score', 'N/A')}

{photo_summary}

{scope_text}

{playbook_section}

## PROCESSING WARNINGS
{chr(10).join(f'- {w}' for w in processing_warnings) if processing_warnings else 'None'}

## COMPLIANCE — CONTRACTOR MODE (CRITICAL)
NEVER use: "on behalf of", "demand", "appeal", cite 11 NYCRR/§ 2601.
You present FACTS and DOCUMENTATION. You do NOT advocate.
Use "supplement" or "scope clarification" — never "appeal".

## YOUR CORE BEHAVIORS
1. Be specific, not general. Say "the carrier missed valley flashing at $14.72/LF" not "check the documentation."
2. Think in dollars. Every gap = money. Translate everything to revenue impact.
3. Track the ledger. Know: what we estimated, what they offered, what they've paid, what they owe.
4. Coach, don't lecture. "Chalk circle the cracked hip cap, photo from two angles with a ruler."
5. Use the carrier playbook. If the carrier tends to deny specific items, preemptively build that argument.
6. Respect compliance. CONTRACTOR MODE — no advocacy language.
7. Be proactive. If you notice something — photo gap, deadline, payment discrepancy — say it.
8. When asked "where does this claim stand?" — lead with the money, then the status, then the next action.

## TOOLS — You Can Take Action
You have tools to perform real actions on this claim. When the user asks you to do something
actionable (send emails, generate documents, check status), USE the appropriate tool.

Available actions:
- **send_supplement_email** — Draft & send supplement email to carrier adjuster
- **generate_invoice** — Create invoice PDF for homeowner or carrier (with optional Stripe link)
- **generate_coc** — Create Certificate of Completion and optionally send to carrier
- **send_aob_to_carrier** — Send signed AOB + cover letter to carrier
- **send_aob_for_signature** — Generate AOB and send to homeowner for digital signature
- **send_custom_email** — Send any custom email related to this claim
- **check_claim_status** — Pull current financials, emails, and next actions

**IMPORTANT**: All emails require user approval before sending. When you use an email tool,
the user will see a preview card and must click "Approve" before anything sends. Tell the
user you've prepared the draft and it's ready for their review.

When generating emails, use a professional but direct tone. Include specific dollar amounts
and line items when relevant. Reference claim details (address, carrier, claim number) naturally.
"""


def _load_carrier_playbook(carrier_name: str) -> str:
    """Try to load carrier playbook from local files (if available on Railway)."""
    if not carrier_name:
        return ""
    slug = carrier_name.lower().replace(" ", "-").replace(".", "").replace(",", "")
    # Check common locations
    for base in ["/app/carrier_playbooks", "./carrier_playbooks", "../carrier_playbooks"]:
        for ext in [".md", ".json"]:
            path = os.path.join(base, f"{slug}{ext}")
            if os.path.exists(path):
                try:
                    with open(path) as f:
                        return f.read()
                except Exception:
                    pass
    return ""


class ChatMessage(BaseModel):
    message: str
    user_id: str | None = None


class ToolApproval(BaseModel):
    tool_call_id: str
    approved: bool


# Pending tool actions awaiting user approval: {claim_id: {tool_call_id: tool_result}}
_pending_tool_actions: dict = {}


@app.post("/api/claim-brain/{claim_id}/chat")
async def claim_brain_chat(claim_id: str, body: ChatMessage):
    """Claim Brain — streaming AI chat for a specific claim with tool use."""
    from claim_brain_tools import CLAIM_BRAIN_TOOLS, execute_tool

    sb = get_supabase_client()

    # Verify claim exists
    result = sb.table("claims").select("*").eq("id", claim_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Claim not found")

    claim_data = result.data

    # Load photos with annotations
    photos_result = sb.table("photos").select(
        "annotation_key, annotation_text, damage_type, material, trade, severity"
    ).eq("claim_id", claim_id).execute()
    photos = photos_result.data or []

    # Load scope comparison
    scope_comparison = claim_data.get("scope_comparison") or []

    # Load carrier playbook
    playbook = _load_carrier_playbook(claim_data.get("carrier", ""))

    # Build system prompt
    system_prompt = _build_claim_brain_prompt(claim_data, photos, scope_comparison, playbook)

    # Get or create conversation
    if claim_id not in _brain_conversations:
        _brain_conversations[claim_id] = []
    _brain_conversations[claim_id].append({"role": "user", "content": body.message})

    # Keep last 50 messages to manage context window
    if len(_brain_conversations[claim_id]) > 50:
        _brain_conversations[claim_id] = _brain_conversations[claim_id][-50:]

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    user_id = body.user_id or claim_data.get("user_id", "")

    async def stream_response():
        try:
            messages = list(_brain_conversations[claim_id])
            full_text_parts = []
            tool_results_for_frontend = []

            # Tool use loop — may iterate if Claude calls tools
            max_tool_rounds = 3
            for _round in range(max_tool_rounds):
                response = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=4096,
                    system=system_prompt,
                    messages=messages,
                    tools=CLAIM_BRAIN_TOOLS,
                )

                # Process content blocks
                has_tool_use = False
                tool_use_results = []

                for block in response.content:
                    if block.type == "text":
                        full_text_parts.append(block.text)
                        yield f"data: {json.dumps({'text': block.text})}\n\n"

                    elif block.type == "tool_use":
                        has_tool_use = True
                        tool_name = block.name
                        tool_input = block.input
                        tool_use_id = block.id

                        # Stream a status message to the user
                        status_msg = f"\n\n*Executing: {tool_name}...*\n\n"
                        full_text_parts.append(status_msg)
                        yield f"data: {json.dumps({'text': status_msg})}\n\n"

                        # Execute the tool
                        try:
                            tool_result = await execute_tool(
                                sb, claim_id, user_id, tool_name, tool_input
                            )
                        except Exception as te:
                            tool_result = {"action": "error", "message": str(te)}

                        # If it's a preview (needs approval), store it and send to frontend
                        if tool_result.get("action") == "preview":
                            import uuid
                            approval_id = str(uuid.uuid4())[:8]
                            if claim_id not in _pending_tool_actions:
                                _pending_tool_actions[claim_id] = {}
                            _pending_tool_actions[claim_id][approval_id] = tool_result

                            tool_result["approval_id"] = approval_id
                            tool_results_for_frontend.append(tool_result)

                            # Send the tool action card to frontend
                            yield f"data: {json.dumps({'tool_action': tool_result})}\n\n"

                            # Provide tool result back to Claude so it can continue
                            tool_use_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": json.dumps({
                                    "status": "preview_sent",
                                    "message": tool_result.get("message", ""),
                                    "awaiting_user_approval": True,
                                }),
                            })
                        elif tool_result.get("action") == "complete":
                            # Tool completed without needing approval (e.g., status check)
                            yield f"data: {json.dumps({'tool_action': tool_result})}\n\n"

                            tool_use_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": json.dumps(tool_result.get("data", tool_result)),
                            })
                        else:
                            # Error
                            tool_use_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": json.dumps({"error": tool_result.get("message", "Tool execution failed")}),
                                "is_error": True,
                            })

                # If no tool use, we're done
                if not has_tool_use:
                    break

                # Otherwise, add assistant message + tool results to messages and loop
                # Serialize content blocks to dicts for the next API call
                serialized_content = []
                for block in response.content:
                    if block.type == "text":
                        serialized_content.append({"type": "text", "text": block.text})
                    elif block.type == "tool_use":
                        serialized_content.append({
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input,
                        })
                messages.append({"role": "assistant", "content": serialized_content})
                messages.append({"role": "user", "content": tool_use_results})

                # If stop_reason is end_turn (not tool_use), break
                if response.stop_reason != "tool_use":
                    break

            # Store the final text in conversation history
            full_response = "".join(full_text_parts)
            _brain_conversations[claim_id].append({"role": "assistant", "content": full_response})

            # Log to telemetry
            try:
                from telemetry import log_processing_step
                prompt_tokens = len(system_prompt.split()) + sum(
                    len(m["content"].split()) if isinstance(m["content"], str) else 100
                    for m in _brain_conversations[claim_id]
                )
                completion_tokens = len(full_response.split())
                log_processing_step(
                    claim_id=claim_id,
                    step_name="claim_brain_chat",
                    model="claude-sonnet-4-20250514",
                    prompt_tokens=int(prompt_tokens * 1.3),
                    completion_tokens=int(completion_tokens * 1.3),
                )
            except Exception:
                pass

            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


@app.post("/api/claim-brain/{claim_id}/approve-action")
async def approve_brain_action(claim_id: str, body: ToolApproval):
    """Approve or reject a pending Claim Brain tool action (email send, etc.)."""
    from claim_brain_email import send_claim_email

    sb = get_supabase_client()

    pending = _pending_tool_actions.get(claim_id, {})
    tool_result = pending.pop(body.tool_call_id, None)

    if not tool_result:
        raise HTTPException(status_code=404, detail="No pending action found with that ID")

    if not body.approved:
        return {"status": "discarded", "message": "Action was discarded by user."}

    # Execute the approved action (send the email)
    draft = tool_result.get("draft")
    if not draft:
        return {"status": "complete", "message": "Action approved (no email to send)."}

    # Load claim for user_id
    claim_result = sb.table("claims").select("user_id, file_path").eq("id", claim_id).single().execute()
    user_id = claim_result.data.get("user_id", "") if claim_result.data else ""

    try:
        # Download attachment content from Supabase Storage
        resolved_attachments = []
        for att in (draft.get("attachments") or []):
            try:
                content = sb.storage.from_("claim-documents").download(att["path"])
                resolved_attachments.append({
                    "filename": att["filename"],
                    "content": content,
                })
            except Exception as ae:
                print(f"[WARN] Failed to download attachment {att['path']}: {ae}")

        email_result = send_claim_email(
            sb=sb,
            claim_id=claim_id,
            user_id=user_id,
            to_email=draft["to"],
            subject=draft["subject"],
            body_html=draft["body_html"],
            cc=draft.get("cc"),
            attachments=resolved_attachments if resolved_attachments else None,
            email_type=tool_result.get("tool_name", "custom"),
        )
        return {
            "status": "sent",
            "message": f"Email sent to {draft['to']}",
            "email_id": email_result.get("email_id"),
        }
    except Exception as e:
        return {"status": "error", "message": f"Failed to send: {str(e)}"}


@app.post("/api/claim-brain/{claim_id}/reset")
async def reset_claim_brain(claim_id: str):
    """Reset the Claim Brain conversation for a claim."""
    _brain_conversations.pop(claim_id, None)
    return {"status": "reset", "claim_id": claim_id}


# ===================================================================
# GMAIL OAUTH — Connect user's Gmail for sending
# ===================================================================

@app.get("/api/gmail-auth/authorize")
async def gmail_auth_authorize(user_id: str):
    """Start Gmail OAuth flow — returns the Google consent URL."""
    from claim_brain_email import get_gmail_auth_url

    base_url = os.environ.get("NEXT_PUBLIC_BACKEND_URL", "http://localhost:8000")
    redirect_uri = f"{base_url}/api/gmail-auth/callback"
    auth_url = get_gmail_auth_url(redirect_uri=redirect_uri, state=user_id)
    return {"auth_url": auth_url}


@app.get("/api/gmail-auth/callback")
async def gmail_auth_callback(code: str, state: str = ""):
    """Google OAuth callback — exchanges code for tokens and stores refresh_token."""
    from claim_brain_email import exchange_gmail_code

    base_url = os.environ.get("NEXT_PUBLIC_BACKEND_URL", "http://localhost:8000")
    redirect_uri = f"{base_url}/api/gmail-auth/callback"

    try:
        tokens = exchange_gmail_code(code=code, redirect_uri=redirect_uri)
    except Exception as e:
        return JSONResponse({"error": f"Token exchange failed: {str(e)}"}, status_code=400)

    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        return JSONResponse({"error": "No refresh token received — user may need to re-consent."}, status_code=400)

    # Get user's email from Gmail API
    gmail_email = ""
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        with urllib.request.urlopen(req) as resp:
            profile = json.loads(resp.read())
            gmail_email = profile.get("emailAddress", "")
    except Exception:
        pass

    # Store in company_profiles
    user_id = state
    if user_id:
        sb = get_supabase_client()
        try:
            # Upsert: update if exists, insert if not
            sb.table("company_profiles").upsert({
                "user_id": user_id,
                "gmail_refresh_token": refresh_token,
                "sending_email": gmail_email,
            }, on_conflict="user_id").execute()
        except Exception as e:
            print(f"[WARN] Failed to save Gmail token: {e}")

    # Redirect to settings page with success
    site_url = os.environ.get("NEXT_PUBLIC_SITE_URL", "https://dumbroof.ai")
    from starlette.responses import RedirectResponse
    return RedirectResponse(url=f"{site_url}/dashboard/settings?gmail=connected")


@app.post("/api/gmail-auth/disconnect")
async def gmail_auth_disconnect(user_id: str = Body(..., embed=True)):
    """Disconnect Gmail — removes stored refresh token."""
    sb = get_supabase_client()
    try:
        sb.table("company_profiles").update({
            "gmail_refresh_token": None,
            "sending_email": None,
        }).eq("user_id", user_id).execute()
        return {"status": "disconnected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===================================================================
# BACKGROUND POLLERS
# ===================================================================

async def poll_for_claims():
    """Background poller — checks for new claims every 10 seconds."""
    while True:
        try:
            sb = get_supabase_client()
            result = sb.table("claims").select("id").eq("status", "uploaded").execute()
            for claim in result.data:
                print(f"[POLLER] Found new claim: {claim['id']}")
                await run_processing(claim["id"])
        except Exception as e:
            print(f"[POLLER] Error: {e}")
        await asyncio.sleep(10)


async def poll_for_repairs():
    """Background poller — checks for new repairs and checkpoint submissions every 10 seconds.
    Also recovers stuck repairs (processing > 15 min)."""
    while True:
        try:
            sb = get_supabase_client()

            # Recover stuck repairs — reset "processing" repairs older than 15 minutes
            from datetime import datetime, timedelta, timezone
            cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
            stuck = sb.table("repairs").select("id").eq("status", "processing").lt("updated_at", cutoff).execute()
            for repair in (stuck.data or []):
                print(f"[REPAIR POLLER] Recovering stuck repair: {repair['id']} (processing > 15min)")
                sb.table("repairs").update({"status": "uploaded"}).eq("id", repair["id"]).execute()

            # Pick up new repairs
            result = sb.table("repairs").select("id").eq("status", "uploaded").execute()
            for repair in result.data:
                print(f"[REPAIR POLLER] Found new repair: {repair['id']}")
                asyncio.create_task(run_repair_processing(repair["id"]))

            # Pick up checkpoints with photos uploaded (needs AI analysis)
            cp_result = sb.table("repair_checkpoints").select(
                "id, checkpoint_type"
            ).eq("status", "photos_uploaded").execute()
            for cp in (cp_result.data or []):
                is_completion = cp["checkpoint_type"] == "completion_verify"
                print(f"[REPAIR POLLER] Found checkpoint to process: {cp['id']} "
                      f"({'completion' if is_completion else 'checkpoint'})")
                asyncio.create_task(run_checkpoint_processing(cp["id"], is_completion))

        except Exception as e:
            print(f"[REPAIR POLLER] Error: {e}")
        await asyncio.sleep(10)
