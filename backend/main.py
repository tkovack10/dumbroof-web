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
    """Re-process a claim after additional documents are uploaded.

    Clears cached_photo_analysis so the photo narrative is regenerated
    fresh — otherwise stale DOL/address strings baked into the cache
    would survive DOL edits or address corrections.
    """
    sb = get_supabase_client()
    result = sb.table("claims").select("id, status").eq("id", claim_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Claim not found")
    sb.table("claims").update({
        "status": "processing",
        "cached_photo_analysis": None,
    }).eq("id", claim_id).execute()
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
        return JSONResponse({"storms": [], "reason": "no_address"})

    try:
        from noaa_weather.geocode import geocode_address
        from noaa_weather.api import NOAAClient, _lookup_county_fips
        from datetime import datetime, timedelta
        import csv, io, urllib.parse, time

        geo = geocode_address(address)
        if not geo:
            print(f"[NOAA-SCAN] Geocode failed for: {address}")
            return JSONResponse({"storms": [], "reason": "geocode_failed"})

        state_fips, county_fips, county_name = _lookup_county_fips(geo.latitude, geo.longitude)
        if not state_fips or not county_fips:
            print(f"[NOAA-SCAN] County FIPS lookup failed for ({geo.latitude}, {geo.longitude})")
            return JSONResponse({"storms": [], "reason": "county_failed"})

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
        print(f"[NOAA-SCAN] Querying {county_clean} County: {url}")

        # Retry once — NOAA Storm Events endpoint is intermittent
        content = None
        for attempt in range(2):
            try:
                content = _fetch_url(url)
                if content and "EVENT_ID" in content.split("\n")[0]:
                    break
                print(f"[NOAA-SCAN] Attempt {attempt+1}: got non-CSV response ({len(content or '')} bytes), retrying...")
                content = None
            except Exception as fetch_err:
                print(f"[NOAA-SCAN] Attempt {attempt+1} fetch failed: {fetch_err}")
                content = None
            if attempt == 0:
                time.sleep(2)

        if not content:
            print(f"[NOAA-SCAN] NOAA unavailable after 2 attempts for {county_clean} County")
            return JSONResponse({"storms": [], "reason": "noaa_unavailable"})

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
        reason = "no_events" if not storms else None
        return JSONResponse({"storms": storms[:15], "reason": reason})
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[NOAA-SCAN] Error: {e}")
        return JSONResponse({"storms": [], "reason": "noaa_unavailable"})


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
    # Adjuster + claim number — prefer direct columns, fall back to previous_carrier_data
    prev_data = claim_data.get("previous_carrier_data") or {}
    adjuster_name = claim_data.get("adjuster_name") or (prev_data.get("adjuster_name", "") if isinstance(prev_data, dict) else "")
    adjuster_email = claim_data.get("adjuster_email") or (prev_data.get("adjuster_email", "") if isinstance(prev_data, dict) else "")
    claim_number = claim_data.get("claim_number") or (prev_data.get("claim_number", "") if isinstance(prev_data, dict) else "")
    # Also check carrier_arguments for these (sometimes nested differently)
    if not claim_number:
        carrier_items = prev_data.get("carrier_line_items", []) if isinstance(prev_data, dict) else []
        # Claim number might be in scope_comparison rows
        for row in (scope_comparison or [])[:5]:
            if isinstance(row, dict) and row.get("carrier_desc", "").startswith("Claim"):
                break
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
- **Claim Number:** {claim_number or 'Not extracted yet'}
- **Adjuster:** {adjuster_name or 'Unknown'} {f'({adjuster_email})' if adjuster_email else ''}
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

## EMAIL RULES (CRITICAL)
- **Subject line: CLAIM NUMBER ONLY.** Every email to a carrier MUST have ONLY the claim number as the subject. Nothing else. Not "Supplement Request — 77 Cook St". Just the claim number: "0820085561". This is how carriers route emails internally.
- If you don't know the claim number, ASK the user before sending.
- Always use the adjuster email from the claim details. If unknown, ask the user.

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

### READ-ONLY INTELLIGENCE (no approval needed — use liberally to back up your answers)
- **get_scope_comparison** — Line-by-line deltas between carrier scope and contractor estimate. Pass `gaps_only: true` to surface only the items with variance. ALWAYS use this when asked about gaps, variance, or "what did the carrier miss".
- **get_carrier_playbook** — Pulls tactical intel on this carrier (denial patterns, winning arguments, inspector tendencies). CALL THIS BEFORE drafting any carrier-facing email.
- **lookup_xactimate_price** — Current price for a line item by description + state. Use when citing dollar amounts in supplement arguments.
- **get_noaa_weather** — Verified NOAA storm events near the property on/around the date of loss. Use when building causation arguments.
- **search_photos** — Filter photos by damage_type / material / trade / severity. Use when assembling evidence or answering "do we have X?"
- **get_damage_scores** — Returns the Damage Score (DS) and Technical Approval Score (TAS) with grades.
- **coach_photo_documentation** — Analyzes the current photo set and returns SPECIFIC coaching steps with exact techniques (test squares, chalk contrast, scale references, labeled overviews). Call this when the user asks "what photos am I missing?", "how do I document this better?", "how can I strengthen this claim?", OR proactively any time you see DS < 70 or the user is about to send something to the carrier with incomplete evidence. Returns concrete instructions — not "take more photos" but "mark a 10x10 test square with chalk, circle every hail hit, shoot from above with a quarter for scale."
- **find_photo** — Locate a specific photo by annotation_key ('p11_02'), position ('the 23rd photo', 'page 11 2nd photo'), or text content ('chimney flashing'). Call FIRST before edit_photo_annotation or exclude_photo_from_claim so you know the exact photo_id.
- **edit_photo_annotation** — Fix a bad AI annotation. User says "page 11, 2nd photo is wrong — it's not hail, it's wind damage" → find_photo('page 11 2nd photo') → edit_photo_annotation(photo_id, damage_type='wind', annotation_text='...', reason='...'). Edits survive reprocess via annotation_feedback training signal. REQUIRES APPROVAL.
- **exclude_photo_from_claim** — Drop a photo from the forensic report (duplicate, blurry, unrelated, wrong claim). Writes to claims.excluded_photos which survives reprocess. REQUIRES APPROVAL.

### FORENSIC PHOTO INTERPRETATION (when users SHOW you a photo)

If the user references or sends a photo, you should be able to TELL THEM what's in it. Key signatures:

**Digital microscope / macro shots at impact sites (hail):**
- **Crushed granules** (smaller but still solid particles) = HAIL ✅
- **Powdery residue / fine dust** = MAN-MADE (hammer/mallet) — DO NOT submit as hail. If the user is excited about a photo that looks powdery, call it out: this is fraud evidence, not hail evidence, and submitting it kills the whole claim.
- **White threads visible** = the fiberglass MAT is exposed. Normal after severe hail. Label it honestly.
- **Granules pressed INTO the mat** = downward-force signature. ONLY hail causes this naturally. Foot traffic = wrong angle, wind = no downward component. This is the strongest possible hail evidence.

**Blisters vs. hail hits (CRITICAL — the #1 adjuster tactic):**

Adjusters love to misidentify hail impacts as "asphalt blisters" to deny claims. They are scientifically OPPOSITE phenomena and must never be confused. Know the signatures cold:

| Feature | HAIL hit | BLISTER |
|---|---|---|
| Force direction | **Downward** (hail falling) | **Upward** (gas bubble rising) |
| Size range | Any size, often 1"+ | **1/3"–1/2" maximum**, never larger |
| Center appearance | Crushed granules OR exposed mat | **Crisp raised crust**, popped hollow |
| Granules in center | Often present, may be embedded | **Never** — bubble pushed them away before popping |
| Edge | Irregular crush pattern | Crisp circular ring |
| Surrounding granules | Loose displacement pattern | Undisturbed, clean boundary |

If the user sends a photo and the adjuster is calling it a blister:
- Is the damage **larger than 1/2 inch?** → Not a blister. Blisters physically can't get that big.
- Are **granules still visible** in the center of the pit? → Not a blister. Blisters eject granules before popping.
- Does it have a **crushed/bruised edge** vs a clean raised ring? → Hail has crushed edges, blisters have crisp rings.
- Is there **mat embedment**? → Hail only; blisters never push granules down.

When the user describes adjuster pushback, TELL THEM this directly so they can counter in their response. Blister misidentification is the single most common denial tactic on hail claims.

**Shingle exposure:**
- 5" exposure = discontinued product = matching argument for full replacement. Tape-measure photo changes spot-repair denials into full-replacement approvals.

**Nail heads on missing/creased shingles:**
- Shiny/unrusted = RECENT wind event. Kills "wear and tear" denial.
- Rusted = pre-existing, do not include as storm evidence.

**Soft metals with chalk:**
- Dents concentrated on one facade = storm direction.
- A/C condenser fin damage = 100% hail, no argument.
- Gutter dents + downspout dents matching = confirms hail size.

**Brittle test (bent shingle):**
- Cracks on 90° bend = brittle, spot repair is physically impossible.
- No crack = shingles can potentially be lifted; repair argument stays alive.

When the user says "what am I looking at?" or "is this good evidence?", interpret honestly. Do not talk them into submitting fraud — it's the fastest way to lose a claim.

### WRITE TOOLS (require user approval before anything ships)
- **send_supplement_email** — Draft & send supplement email to carrier adjuster
- **generate_invoice** — Create invoice PDF for homeowner or carrier (with optional Stripe link)
- **generate_coc** — Create Certificate of Completion and optionally send to carrier
- **send_aob_to_carrier** — Send signed AOB + cover letter to carrier
- **send_aob_for_signature** — Generate AOB and send to homeowner for digital signature
- **send_custom_email** — Send any custom email related to this claim
- **check_claim_status** — Pull current financials, emails, and next actions
- **check_carrier_emails** — Search user's Gmail for carrier emails matching the claim number (never touches personal email).

### FILE CLASSIFICATION (when the user drops something in chat)
- **classify_uploaded_file** — Claude Vision figures out what an uploaded file is (AOB / COC / CARRIER_SCOPE / EAGLEVIEW / SUPPLEMENT_RESPONSE / CONTRACT / PHOTO / OTHER). WHENEVER the user's message includes a storage_path attachment, CALL THIS FIRST for every file, then propose routing.

### AGENTIC WRITES (approval-gated, one confirm per action)
- **attach_to_claim** — Route an uploaded file into the correct slot on the claim (aob_files / coc_files / scope_files / measurement_files / other_files). Call ONLY after classify_uploaded_file returns confidence >= 0.90. If confidence is < 0.90, ASK THE USER to confirm the type before calling this tool.
- **trigger_reprocess** — Re-run the whole claim pipeline (photos → estimate → scope comparison → scores → PDFs). Use after a new CARRIER_SCOPE or EAGLEVIEW is attached. Takes ~90s.
- **send_to_carrier** — Generic carrier email with attachments. Subject is always the claim number (enforced server-side — don't fight it).
- **schedule_follow_up_cadence** — Write follow-up emails to claim_brain_cadence_sends. Typical AOB cadence: days=[3,7,14,21]. Supplement: days=[3,7,15]. A cron job sends each follow-up when the scheduled_at arrives.
- **cancel_cadence** — Kill all pending follow-ups on this claim. Use when the carrier has responded or the claim closed.

### LINE ITEM SURGERY (approval-gated)
- **list_line_items** — READ-ONLY. Call this FIRST before add/remove/modify so you know real line IDs and current qty/price. Filter by source='usarm' | 'carrier' | 'user_added'.
- **add_line_item** — Insert a user-added line into this claim's estimate. Use when something is missing from both the carrier's and the contractor's scope (typically after get_scope_comparison reveals a gap). ALWAYS pair with a clear `reason` that cites code, evidence, or measurement.
- **remove_line_item** — Exclude an existing line item by UUID. Use when the carrier scoped a duplicate, wrong material, or scope item that doesn't belong.
- **modify_line_item** — Change qty and/or unit_price on an existing line. Use for quantity disputes (e.g. carrier's 24 SQ → actual 28 SQ) or pricing corrections (ITEL pricing → NYBI26).
- **recompute_estimate** — After any add/remove/modify, call this so the contractor_rcv and variance reflect the new totals. Faster than trigger_reprocess (no PDF regen). Respects O&P + tax + excluded_line_items. If you need new PDFs reflecting the change, ALSO call trigger_reprocess.

**Typical line-item flow:**
  1. get_scope_comparison(gaps_only=true) → see gaps
  2. lookup_xactimate_price("step flashing", state) → get code + price
  3. list_line_items(source="usarm") → confirm what's already there
  4. add_line_item(description="R&R Step flashing", qty=30, unit="LF", unit_price=15.10, reason="R903.2.1 requires continuous flashing at roof-to-wall junctions; evidence photo p14_03 shows missing flashing")
  5. recompute_estimate() → new contractor_rcv and variance

### TRANSLATING NATURAL LANGUAGE LINE-ITEM REQUESTS

Users will NOT say "call add_line_item". They'll say things like:
  - "Add line item — remove extra layer of shingles"
  - "Add 2 pipe collars"
  - "Remove and replace 2 skylights"
  - "Add a line for drip edge"

**Your job is to translate these into the tool chain.** Rules:

1. **If the user specifies a quantity explicitly** ("2 pipe collars", "2 skylights"):
   use that qty. Don't ask again. Assume EA unit unless obvious otherwise (SF/LF/SQ).

2. **If the user does NOT specify a quantity** ("remove extra layer of shingles",
   "add drip edge"):
   - FIRST call `get_scope_comparison()` to find the roof area / perimeter
     already on the claim (the EagleView measurements live there).
   - Infer: shingle removal qty = roof area in SQ, drip edge = eave LF, etc.
   - If you can't find a reasonable quantity, ASK THE USER before proposing.
     Don't guess 1 and hope for the best.

3. **ALWAYS call `lookup_xactimate_price(description, state)` BEFORE add_line_item.**
   If the lookup returns no match or price 0, STOP. Either re-phrase the
   description (e.g. "step flashing" → "flashing - step 5in") and try again,
   or ask the user for the price. Never propose an add at $0.

4. **Check for duplicates.** Call `list_line_items(source='all')` and if a
   very similar item already exists, tell the user before proposing. The
   preview card will also surface this as a warning, but flagging it in
   your message builds trust. Example: *"I see there's already a 'Skylight
   replacement' line at 1 EA. Want me to bump that to 2 instead of adding
   a new line?"*

5. **Every add_line_item MUST have a specific `reason`** that cites one of:
   code (RCNYS section), evidence (photo key), measurement (EagleView
   linear footage), or carrier-tactic-specific argument. Generic "missing
   item" is not enough.

6. **When the user says "recompute" or asks for updated totals**, call
   `recompute_estimate` BEFORE reporting the new number. Don't pull a
   stale contractor_rcv from the claim state.

**Concrete examples:**

User: *"Add two pipe collars"*
→ lookup_xactimate_price("pipe jack") → add_line_item(description="R&R Pipe jack flashing", qty=2, unit="EA", unit_price=<looked up>, reason="two damaged pipe collars identified during inspection") → recompute_estimate

User: *"Remove and replace 2 skylights"*
→ list_line_items(source="all") → (if no dupe) lookup_xactimate_price("skylight remove replace") → add_line_item(qty=2, unit="EA", ...) → recompute_estimate

User: *"Add line item — remove extra layer of shingles"*
→ get_scope_comparison() → find roof area (let's say 24 SQ) → lookup_xactimate_price("add layer comp shingles remove") → add_line_item(qty=24, unit="SQ", unit_price=46.81, xactimate_code="RFG ADDRM>", reason="existing roof has two layers of shingles per photo p02_03; tear-off of secondary layer required by RCNYS R908.3") → recompute_estimate

**Agentic chain — "drop AOB → send to carrier with cadence" (Tom's flagship flow):**
  1. User drops AOB into chat → classify_uploaded_file → returns AOB, 0.98 confidence
  2. attach_to_claim(doc_type=AOB, confidence=0.98) → preview → user approves
  3. send_to_carrier(attachments=[aob_path]) → preview with claim number as subject → user approves
  4. schedule_follow_up_cadence(cadence_type=aob_submission, days=[3,7,14,21]) → preview → user approves
  Each step is a separate preview card. Propose them in sequence; don't bundle.

**Other chains:**
- Analyze → draft: get_scope_comparison → lookup_xactimate_price → get_carrier_playbook → send_supplement_email
- New carrier scope arrived: classify_uploaded_file → attach_to_claim(CARRIER_SCOPE) → trigger_reprocess → (after user confirms reprocess is done) get_scope_comparison to see deltas

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


class ChatAttachment(BaseModel):
    storage_path: str
    filename: str | None = None
    content_type: str | None = None


class ChatMessage(BaseModel):
    message: str
    user_id: str | None = None
    locale: str | None = "en"
    attachments: list[ChatAttachment] | None = None


class ToolApproval(BaseModel):
    tool_call_id: str
    approved: bool
    # Optional user edits to the preview/draft before shipping. Merged shallow
    # into either `draft` (for email-type approvals) or `preview` (for
    # attach/reprocess/send/cadence). Unknown keys ignored.
    overrides: dict | None = None


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

    # Spanish language mode
    if body.locale == "es":
        system_prompt += "\n\n## LANGUAGE: SPANISH\nThe user has selected Spanish. Respond ENTIRELY in Spanish. All explanations, recommendations, and coaching should be in Spanish. Technical terms (Xactimate codes, IRC sections, dollar amounts) stay in English. Email drafts should still be in English (carriers expect English).\n"

    # Get or create conversation
    if claim_id not in _brain_conversations:
        _brain_conversations[claim_id] = []

    # Build the user message content — text + any attachments the user dropped in chat.
    # Attachments arrive as Supabase storage paths and are surfaced to Claude as a
    # structured text block so it knows to call classify_uploaded_file on each one.
    user_content: Any = body.message
    if body.attachments:
        attach_lines = []
        for a in body.attachments:
            fname = a.filename or a.storage_path.rsplit("/", 1)[-1]
            attach_lines.append(f"- storage_path: {a.storage_path} | filename: {fname}")
        attach_block = (
            "\n\n[User dropped " + str(len(body.attachments)) + " file(s) into this chat. "
            "Call classify_uploaded_file on each before proposing next steps.]\n"
            + "\n".join(attach_lines)
        )
        user_content = (body.message or "") + attach_block

    _brain_conversations[claim_id].append({"role": "user", "content": user_content})

    # Keep last 50 messages to manage context window
    if len(_brain_conversations[claim_id]) > 50:
        _brain_conversations[claim_id] = _brain_conversations[claim_id][-50:]

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    user_id = body.user_id or claim_data.get("user_id", "")

    # Persist user message to Supabase for richard-trainer + history rehydration
    try:
        sb.table("claim_brain_messages").insert({
            "claim_id": claim_id,
            "user_id": user_id or None,
            "role": "user",
            "content": body.message[:10000],
        }).execute()
    except Exception as e:
        print(f"[BRAIN] Failed to persist user message (non-fatal): {e}")

    async def stream_response():
        try:
            messages = list(_brain_conversations[claim_id])
            full_text_parts = []
            tool_results_for_frontend = []

            # Tool use loop — may iterate if Claude calls tools.
            # Rounds, not individual tool calls — Claude can fire multiple tools per round.
            # Bumped from 3 to 10 to support agentic multi-step plans (R1+R2 spec).
            max_tool_rounds = 10
            total_tool_calls = 0
            max_total_tool_calls = 20  # hard cap across the whole turn
            for _round in range(max_tool_rounds):
                response = client.messages.create(
                    model="claude-opus-4-6",
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

                        # Enforce hard cap — refuse rather than run away.
                        if total_tool_calls >= max_total_tool_calls:
                            tool_use_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": json.dumps({
                                    "error": f"Tool call limit reached ({max_total_tool_calls} per turn). "
                                             "Summarize what you've found and stop calling tools."
                                }),
                                "is_error": True,
                            })
                            continue
                        total_tool_calls += 1

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
            prompt_tokens = None
            completion_tokens = None
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
                    model="claude-opus-4-6",
                    prompt_tokens=int(prompt_tokens * 1.3),
                    completion_tokens=int(completion_tokens * 1.3),
                )
            except Exception:
                pass

            # Persist assistant response for richard-trainer + history rehydration
            try:
                tool_calls_json = [{"name": t.get("name"), "result_preview": str(t.get("result", ""))[:200]} for t in tool_results_for_frontend] if tool_results_for_frontend else None
                sb.table("claim_brain_messages").insert({
                    "claim_id": claim_id,
                    "user_id": user_id or None,
                    "role": "assistant",
                    "content": full_response[:10000],
                    "tool_calls": tool_calls_json,
                    "model": "claude-sonnet-4-20250514",
                    "tokens_in": int(prompt_tokens * 1.3) if prompt_tokens else None,
                    "tokens_out": int(completion_tokens * 1.3) if completion_tokens else None,
                }).execute()
            except Exception as e:
                print(f"[BRAIN] Failed to persist assistant message (non-fatal): {e}")

            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


@app.post("/api/claim-brain/{claim_id}/approve-action")
async def approve_brain_action(claim_id: str, body: ToolApproval, background_tasks: BackgroundTasks):
    """Approve or reject a pending Claim Brain tool action.

    Dispatches by tool_name. Each write tool has its own execute path:
      - email tools (send_supplement_email, send_aob_*, send_custom_email,
        generate_invoice, generate_coc): ships the draft via send_claim_email.
      - attach_to_claim: append to the claim's {doc_type}_files JSONB column.
      - trigger_reprocess: enqueue /reprocess (idempotent).
      - send_to_carrier: same as the email tools but with explicit claim-number
        subject + multi-attachment support.
      - schedule_follow_up_cadence: insert rows into claim_brain_cadence_sends.
      - cancel_cadence: mark pending rows cancelled.
    """
    from datetime import datetime, timedelta
    from claim_brain_email import send_claim_email
    from claim_brain_tools import _audit_log

    sb = get_supabase_client()

    pending = _pending_tool_actions.get(claim_id, {})
    tool_result = pending.pop(body.tool_call_id, None)

    if not tool_result:
        raise HTTPException(status_code=404, detail="No pending action found with that ID")

    tool_name = tool_result.get("tool_name", "")

    # Load claim (always needed)
    claim_result = sb.table("claims").select("*").eq("id", claim_id).single().execute()
    claim_row = claim_result.data or {}
    user_id = claim_row.get("user_id", "")

    if not body.approved:
        _audit_log(sb, claim_id, user_id, tool_name, {"approval_id": body.tool_call_id}, {"action": "discarded", "message": "user discarded"}, 0)
        return {"status": "discarded", "message": "Action was discarded by user."}

    # Apply user overrides BEFORE executing. Shallow merge into the draft
    # (email tools) or preview (attach/reprocess/send/cadence). Allows the
    # inline edit UI to tweak to/cc/subject/body/days without rebuilding the
    # whole preview. Only known keys per shape are accepted; extras ignored.
    if body.overrides:
        overrides = body.overrides
        draft = tool_result.get("draft")
        preview = tool_result.get("preview")
        if isinstance(draft, dict):
            for key in ("to", "cc", "subject", "body_html"):
                if key in overrides and overrides[key] is not None:
                    draft[key] = overrides[key]
            tool_result["draft"] = draft
        if isinstance(preview, dict):
            for key in (
                "to_email", "cc", "subject", "body_html",
                "doc_type", "reason", "cadence_type", "days",
                "schedule", "attachment_paths",
            ):
                if key in overrides and overrides[key] is not None:
                    preview[key] = overrides[key]
            # If the user edited days[], rebuild the schedule from today +
            # offsets. Otherwise the cadence dispatcher would insert with the
            # original (now stale) schedule rows. Null signal came from FE.
            if "days" in overrides and (overrides.get("schedule") is None or not preview.get("schedule")):
                from datetime import timezone as _tz
                _now = datetime.now(_tz.utc)
                raw_days = overrides["days"]
                if isinstance(raw_days, list):
                    preview["schedule"] = [
                        {
                            "followup_number": i + 1,
                            "offset_days": int(d),
                            "scheduled_at": (_now + timedelta(days=int(d))).isoformat(),
                        }
                        for i, d in enumerate(raw_days)
                    ]
            tool_result["preview"] = preview
        _audit_log(sb, claim_id, user_id, tool_name, {"approval_id": body.tool_call_id, "overrides_applied": list(overrides.keys())}, {"action": "overrides", "message": f"user edited {len(overrides)} field(s) before approving"}, 0)

    # Dry-run mode — per-user flag on company_profiles. When true, every
    # destructive path short-circuits here. Preview was already shown, so the
    # user sees "DRY RUN" as the approval result.
    # Fail-closed: if we can't confirm dry_run=False (e.g. Supabase outage),
    # treat as dry_run=True so we never accidentally ship emails during an
    # infrastructure hiccup.
    dry_run = False
    profile_read_ok = False
    try:
        if user_id:
            prof_res = sb.table("company_profiles").select("richard_dry_run").eq("user_id", user_id).limit(1).execute()
            prof_rows = prof_res.data or []
            dry_run = bool(prof_rows and prof_rows[0].get("richard_dry_run"))
            profile_read_ok = True
    except Exception as e:
        print(f"[dry-run] profile lookup failed — defaulting to dry_run=True (fail-closed): {e}")
        dry_run = True
    # If there's no user_id at all we can't check the flag — treat as NOT dry-run
    # because that's the pre-dry-run behavior and the only path without a user_id
    # is internal/test calls.
    if not user_id:
        dry_run = False
        profile_read_ok = True

    if dry_run:
        summary = f"DRY RUN — would have executed {tool_name}"
        _audit_log(sb, claim_id, user_id, tool_name, {"approval_id": body.tool_call_id, "dry_run": True}, {"action": "dry_run", "message": summary}, 0)
        return {"status": "dry_run", "message": summary, "dry_run": True}

    try:
        # ─── Email-type draft (supplement / AOB / custom / invoice / coc-with-send) ───
        draft = tool_result.get("draft")
        if draft:
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
                email_type=tool_name or "custom",
            )
            _audit_log(sb, claim_id, user_id, tool_name, {"approval_id": body.tool_call_id}, {"action": "sent", "message": f"email sent to {draft['to']}"}, 0)
            return {
                "status": "sent",
                "message": f"Email sent to {draft['to']}",
                "email_id": email_result.get("email_id"),
            }

        # ─── R3: attach_to_claim ───
        # processor.py reads these columns as lists of BARE FILENAMES and expects
        # each file to live at `{claim.file_path}/{canonical_subfolder}/{filename}`.
        # Chat uploads land in `{claim.file_path}/chat-uploads/...`, so we must
        # COPY the file into the canonical subfolder BEFORE writing the column.
        if tool_name == "attach_to_claim":
            from claim_brain_tools import _DOC_TYPE_TO_COLUMN
            preview = tool_result.get("preview") or {}
            doc_type = (preview.get("doc_type") or "").upper()
            storage_path = preview.get("storage_path")
            filename = preview.get("filename") or (storage_path.rsplit("/", 1)[-1] if storage_path else "")
            column = _DOC_TYPE_TO_COLUMN.get(doc_type)
            if not column or not storage_path or not filename:
                raise ValueError("Invalid attach preview — missing column, storage_path, or filename.")

            _DOC_TYPE_TO_SUBFOLDER = {
                "AOB": "aob",
                "COC": "coc",
                "CARRIER_SCOPE": "scope",
                "EAGLEVIEW": "measurements",
                "CONTRACT": "other",
                "PHOTO": "photos",
                "SUPPLEMENT_RESPONSE": "other",
                "OTHER": "other",
            }
            subfolder = _DOC_TYPE_TO_SUBFOLDER.get(doc_type, "other")

            claim_file_path = (claim_row.get("file_path") or "").rstrip("/")
            if not claim_file_path:
                raise ValueError("Claim has no file_path — cannot attach.")

            canonical_storage_path = f"{claim_file_path}/{subfolder}/{filename}"

            # Copy chat upload into canonical subfolder so processor can find it.
            if storage_path != canonical_storage_path:
                try:
                    content = sb.storage.from_("claim-documents").download(storage_path)
                    sb.storage.from_("claim-documents").upload(
                        canonical_storage_path, content,
                        {"content-type": "application/octet-stream", "upsert": "true"},
                    )
                except Exception as copy_err:
                    raise RuntimeError(f"Failed to copy file to {canonical_storage_path}: {copy_err}")

            # Append bare filename to column (matches processor.py contract).
            import json as _json
            raw_existing = claim_row.get(column)
            if isinstance(raw_existing, str):
                try:
                    raw_existing = _json.loads(raw_existing)
                except Exception:
                    raw_existing = []
            existing: list = list(raw_existing) if isinstance(raw_existing, list) else []
            if filename not in existing:
                existing.append(filename)
            sb.table("claims").update({column: existing}).eq("id", claim_id).execute()

            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"attached to {column}"}, 0)
            return {
                "status": "sent",
                "message": f"{filename} attached as {doc_type}.",
                "column": column,
                "canonical_path": canonical_storage_path,
            }

        # ─── R3: trigger_reprocess ───
        # Mirrors POST /api/reprocess/{claim_id}: flip status + clear cached analysis,
        # then enqueue processor in background.
        if tool_name == "trigger_reprocess":
            preview = tool_result.get("preview") or {}
            sb.table("claims").update({
                "status": "processing",
                "cached_photo_analysis": None,
            }).eq("id", claim_id).execute()
            background_tasks.add_task(run_processing, claim_id)
            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"reprocess requested ({preview.get('reason', '')})"}, 0)
            return {"status": "sent", "message": "Reprocess requested — you'll see updated results in 1-2 minutes."}

        # ─── R4: send_to_carrier ───
        # If the user approved a send with N attachments and even one fails to
        # download, refuse rather than silently ship an email with missing files.
        # Adjusters won't know an AOB was "included" but actually absent.
        if tool_name == "send_to_carrier":
            preview = tool_result.get("preview") or {}
            requested = list(preview.get("attachment_paths") or [])
            resolved_attachments = []
            failed_paths: list[str] = []
            for path in requested:
                try:
                    content = sb.storage.from_("claim-documents").download(path)
                    resolved_attachments.append({
                        "filename": path.rsplit("/", 1)[-1],
                        "content": content,
                    })
                except Exception as ae:
                    print(f"[WARN] Attach download failed {path}: {ae}")
                    failed_paths.append(path)

            if failed_paths:
                err = f"Refusing to send — {len(failed_paths)}/{len(requested)} attachment(s) failed to download: {failed_paths}"
                _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "error", "message": err}, 0, error=err)
                return {"status": "error", "message": err}

            email_result = send_claim_email(
                sb=sb,
                claim_id=claim_id,
                user_id=user_id,
                to_email=preview["to_email"],
                subject=preview["subject"],
                body_html=preview["body_html"],
                cc=preview.get("cc"),
                attachments=resolved_attachments if resolved_attachments else None,
                email_type="carrier_custom",
            )
            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"sent to {preview['to_email']}"}, 0)
            return {"status": "sent", "message": f"Sent to {preview['to_email']}.", "email_id": email_result.get("email_id")}

        # ─── R4: schedule_follow_up_cadence ───
        # Capture the most recent carrier-facing send so each follow-up can
        # quote the original body (adjusters need the context).
        if tool_name == "schedule_follow_up_cadence":
            preview = tool_result.get("preview") or {}
            previous_body_html = None
            previous_subject = None
            previous_sent_at = None
            try:
                prev_res = sb.table("claim_emails").select(
                    "subject, body_html, sent_at, email_type"
                ).eq("claim_id", claim_id).in_(
                    "email_type",
                    ["carrier_custom", "supplement", "aob", "coc", "send_supplement_email", "send_aob_to_carrier"],
                ).order("sent_at", desc=True).limit(1).execute()
                prev = (prev_res.data or [{}])[0] if prev_res.data else {}
                previous_body_html = prev.get("body_html")
                previous_subject = prev.get("subject")
                previous_sent_at = prev.get("sent_at")
            except Exception as e:
                print(f"[cadence] prev-send lookup failed (non-fatal): {e}")

            rows_to_insert = []
            for item in preview.get("schedule", []):
                rows_to_insert.append({
                    "claim_id": claim_id,
                    "user_id": user_id or None,
                    "cadence_type": preview.get("cadence_type"),
                    "followup_number": item.get("followup_number"),
                    "scheduled_at": item.get("scheduled_at"),
                    "to_email": preview.get("to_email"),
                    "cc": preview.get("cc"),
                    "subject": preview.get("subject"),
                    "body_html": _build_cadence_body_html(claim_row, preview, item, previous_body_html, previous_subject, previous_sent_at),
                    "attachment_paths": preview.get("attachment_paths") or [],
                    "previous_body_html": previous_body_html,
                    "previous_subject": previous_subject,
                    "previous_sent_at": previous_sent_at,
                    "status": "pending",
                })
            if rows_to_insert:
                sb.table("claim_brain_cadence_sends").insert(rows_to_insert).execute()
            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"scheduled {len(rows_to_insert)} follow-ups"}, 0)
            return {
                "status": "sent",
                "message": f"Scheduled {len(rows_to_insert)} follow-up{'s' if len(rows_to_insert) != 1 else ''}.",
                "scheduled_count": len(rows_to_insert),
            }

        # ─── Photo annotation edit ───
        # Writes to annotation_feedback (survives reprocess as training signal)
        # AND updates photos table directly so the user sees the change immediately.
        if tool_name == "edit_photo_annotation":
            preview = tool_result.get("preview") or {}
            photo_id = preview.get("photo_id")
            if not photo_id:
                raise ValueError("photo_id missing from preview")

            update_payload: dict = {}
            if preview.get("new_annotation") is not None:
                update_payload["annotation_text"] = preview["new_annotation"]
            if preview.get("new_damage_type") is not None:
                update_payload["damage_type"] = preview["new_damage_type"]
            if preview.get("new_material") is not None:
                update_payload["material"] = preview["new_material"]
            if preview.get("new_severity") is not None:
                update_payload["severity"] = preview["new_severity"]

            if update_payload:
                sb.table("photos").update(update_payload).eq("id", photo_id).eq("claim_id", claim_id).execute()

            # Write to annotation_feedback so the correction survives reprocess.
            original_tags = {
                "damage_type": preview.get("original_damage_type"),
                "material": preview.get("original_material"),
                "severity": preview.get("original_severity"),
            }
            corrected_tags = {
                "damage_type": preview.get("new_damage_type") or preview.get("original_damage_type"),
                "material": preview.get("new_material") or preview.get("original_material"),
                "severity": preview.get("new_severity") or preview.get("original_severity"),
            }
            try:
                sb.table("annotation_feedback").upsert({
                    "photo_id": photo_id,
                    "claim_id": claim_id,
                    "status": "corrected",
                    "original_annotation": preview.get("original_annotation"),
                    "corrected_annotation": preview.get("new_annotation") or preview.get("original_annotation"),
                    "original_tags": original_tags,
                    "corrected_tags": corrected_tags,
                    "notes": preview.get("reason"),
                }, on_conflict="photo_id").execute()
            except Exception as e:
                # Non-fatal — direct update already took effect
                print(f"[photo edit] annotation_feedback upsert failed: {e}")

            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"edited {preview.get('annotation_key')}"}, 0)
            return {"status": "sent", "message": f"Updated {preview.get('annotation_key')}. Correction will persist through reprocess."}

        # ─── Photo exclude ───
        # Adds annotation_key to claims.excluded_photos (JSONB). processor.py
        # already respects this on every reprocess.
        if tool_name == "exclude_photo_from_claim":
            preview = tool_result.get("preview") or {}
            excl_key = preview.get("annotation_key")
            if not excl_key:
                raise ValueError("annotation_key missing from preview")

            existing_res = sb.table("claims").select("excluded_photos").eq("id", claim_id).single().execute()
            existing = (existing_res.data or {}).get("excluded_photos") or []
            if not isinstance(existing, list):
                existing = []
            if excl_key not in existing:
                existing.append(excl_key)
            sb.table("claims").update({"excluded_photos": existing}).eq("id", claim_id).execute()

            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"excluded {excl_key}"}, 0)
            return {"status": "sent", "message": f"Excluded {excl_key} from the forensic report. Reprocess to regenerate PDFs without it."}

        # ─── Line item surgery ───
        if tool_name == "add_line_item":
            preview = tool_result.get("preview") or {}
            qty = float(preview.get("qty") or 0)
            unit_price = float(preview.get("unit_price") or 0)
            new_row = {
                "claim_id": claim_id,
                "category": preview.get("category") or "GENERAL",
                "description": preview.get("description"),
                "qty": qty,
                "unit": preview.get("unit"),
                "unit_price": unit_price,
                "total": qty * unit_price,
                "xactimate_code": preview.get("xactimate_code"),
                "trade": preview.get("trade"),
                "source": "user_added",
                "variance_note": preview.get("reason"),
            }
            insert = sb.table("line_items").insert(new_row).execute()
            inserted = (insert.data or [{}])[0]
            _recompute_and_write_contractor_rcv(sb, claim_id)
            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"added: {preview.get('description')}"}, 0)
            return {"status": "sent", "message": f"Added {preview.get('description')}.", "line_item_id": inserted.get("id")}

        if tool_name == "remove_line_item":
            preview = tool_result.get("preview") or {}
            line_item_id = preview.get("line_item_id")
            # Push into claims.excluded_line_items (JSONB array) — survives reprocess.
            existing_res = sb.table("claims").select("excluded_line_items").eq("id", claim_id).single().execute()
            existing = (existing_res.data or {}).get("excluded_line_items") or []
            if not isinstance(existing, list):
                existing = []
            if line_item_id not in existing:
                existing.append(line_item_id)
            sb.table("claims").update({"excluded_line_items": existing}).eq("id", claim_id).execute()
            # Also record the exclusion reason in line_item_feedback for training
            try:
                sb.table("line_item_feedback").insert({
                    "claim_id": claim_id,
                    "user_id": user_id or None,
                    "line_item_id": line_item_id,
                    "original_description": preview.get("description"),
                    "status": "excluded",
                    "reason": preview.get("reason"),
                }).execute()
            except Exception as e:
                print(f"[LINE ITEM REMOVE] feedback insert failed (non-fatal): {e}")
            _recompute_and_write_contractor_rcv(sb, claim_id, excluded_ids=set(existing))
            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"excluded: {preview.get('description')}"}, 0)
            return {"status": "sent", "message": f"Excluded {preview.get('description')}."}

        if tool_name == "modify_line_item":
            preview = tool_result.get("preview") or {}
            line_item_id = preview.get("line_item_id")
            # Update the line_items row directly AND record in line_item_feedback
            # so the correction survives reprocess.
            new_qty = float(preview.get("new_qty") or 0)
            new_price = float(preview.get("new_unit_price") or 0)
            sb.table("line_items").update({
                "qty": new_qty,
                "unit_price": new_price,
                "total": new_qty * new_price,
                "variance_note": preview.get("reason"),
            }).eq("id", line_item_id).eq("claim_id", claim_id).execute()
            try:
                sb.table("line_item_feedback").insert({
                    "claim_id": claim_id,
                    "user_id": user_id or None,
                    "line_item_id": line_item_id,
                    "original_description": preview.get("description"),
                    "corrected_qty": new_qty,
                    "corrected_unit_price": new_price,
                    "status": "modified",
                    "reason": preview.get("reason"),
                }).execute()
            except Exception as e:
                print(f"[LINE ITEM MODIFY] feedback insert failed (non-fatal): {e}")
            _recompute_and_write_contractor_rcv(sb, claim_id)
            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"modified: {preview.get('description')}"}, 0)
            return {"status": "sent", "message": f"Updated {preview.get('description')}."}

        if tool_name == "recompute_estimate":
            preview = tool_result.get("preview") or {}
            new_rcv = _recompute_and_write_contractor_rcv(sb, claim_id)
            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"recomputed: ${new_rcv:,.2f}"}, 0)
            return {"status": "sent", "message": f"Recomputed contractor_rcv: ${new_rcv:,.2f}."}

        # ─── R4: cancel_cadence ───
        # supabase-py's .update().execute() return shape for .data is unreliable
        # across SDK versions. Count pending rows FIRST, then update — the count
        # query is authoritative.
        if tool_name == "cancel_cadence":
            preview = tool_result.get("preview") or {}
            count_res = sb.table("claim_brain_cadence_sends").select("id", count="exact").eq("claim_id", claim_id).eq("status", "pending").execute()
            cancelled = count_res.count or 0
            if cancelled > 0:
                sb.table("claim_brain_cadence_sends").update({
                    "status": "cancelled",
                    "cancelled_at": datetime.utcnow().isoformat() + "Z",
                    "cancellation_reason": preview.get("reason"),
                }).eq("claim_id", claim_id).eq("status", "pending").execute()
            _audit_log(sb, claim_id, user_id, tool_name, preview, {"action": "sent", "message": f"cancelled {cancelled} pending follow-ups"}, 0)
            return {"status": "sent", "message": f"Cancelled {cancelled} pending follow-up{'s' if cancelled != 1 else ''}."}

        # Unknown tool or preview-but-no-draft fallthrough
        return {"status": "complete", "message": "Action approved."}

    except Exception as e:
        _audit_log(sb, claim_id, user_id, tool_name, tool_result.get("preview") or {}, {"action": "error", "message": str(e)}, 0, error=str(e))
        return {"status": "error", "message": f"Failed: {str(e)}"}


def _recompute_and_write_contractor_rcv(sb, claim_id: str, excluded_ids: Optional[set] = None) -> float:
    """Fast recompute of claims.contractor_rcv from line_items.

    Avoids the full reprocess (PDFs + photos + scope compare) when the user
    is just tweaking line items. Honors claims.o_and_p_enabled + tax_rate +
    excluded_line_items.
    """
    try:
        claim_res = sb.table("claims").select(
            "contractor_rcv, o_and_p_enabled, tax_rate, excluded_line_items"
        ).eq("id", claim_id).single().execute()
        claim = claim_res.data or {}

        if excluded_ids is None:
            excluded_raw = claim.get("excluded_line_items") or []
            excluded_ids = set(excluded_raw) if isinstance(excluded_raw, list) else set()

        items_res = sb.table("line_items").select("id, qty, unit_price, total").eq("claim_id", claim_id).execute()
        items = items_res.data or []

        line_total = 0.0
        for item in items:
            if item.get("id") in excluded_ids:
                continue
            t = item.get("total")
            if t is None:
                t = float(item.get("qty") or 0) * float(item.get("unit_price") or 0)
            line_total += float(t or 0)

        tax_rate = float(claim.get("tax_rate") or 0)
        op_enabled = bool(claim.get("o_and_p_enabled"))
        tax = line_total * tax_rate
        op = line_total * 0.21 if op_enabled else 0.0
        new_rcv = round(line_total + tax + op, 2)

        sb.table("claims").update({"contractor_rcv": new_rcv}).eq("id", claim_id).execute()
        return new_rcv
    except Exception as e:
        print(f"[RECOMPUTE] failed (non-fatal): {e}")
        return 0.0


def _build_cadence_body_html(
    claim_row: dict,
    preview: dict,
    item: dict,
    previous_body_html: Optional[str] = None,
    previous_subject: Optional[str] = None,
    previous_sent_at: Optional[str] = None,
) -> str:
    """Build the follow-up email body for a single cadence send.

    When a prior carrier-facing send exists, each follow-up inlines it as a
    Gmail-style quoted block so the adjuster has full context. Without that
    quote, follow-ups read as disconnected stubs.
    """
    followup_number = item.get("followup_number", 1)
    days = item.get("offset_days", 0)
    cadence_type = preview.get("cadence_type", "")
    address = claim_row.get("address") or "the subject property"
    carrier = claim_row.get("carrier") or "your office"
    claim_number = preview.get("subject") or claim_row.get("claim_number") or ""

    tone_map = {
        1: "professional follow-up",
        2: "firmer follow-up requesting acknowledgment",
        3: "urgent follow-up flagging the delay",
        4: "final follow-up before escalation",
    }
    tone_label = tone_map.get(followup_number, f"follow-up {followup_number}")

    top = (
        f"<p>Following up on our prior correspondence regarding the claim at <strong>{address}</strong> "
        f"(claim number <strong>{claim_number}</strong>).</p>"
        f"<p>It has been approximately {days} days and we have not yet received a response from {carrier}. "
        f"Please confirm receipt and provide a status update at your earliest convenience.</p>"
        f"<p>The attached documentation remains available for your review.</p>"
    )

    if previous_body_html:
        import html as _html
        # Escape the subject — it's a plain string that ends up inside <strong>;
        # a stray `<` or `</strong>` in the subject would break layout.
        safe_subject = _html.escape(previous_subject) if previous_subject else ""
        sent_line = f" on {previous_sent_at[:10]}" if previous_sent_at else ""
        subj_line = f" — Subject: <strong>{safe_subject}</strong>" if safe_subject else ""
        # previous_body_html is trusted (comes from our own claim_emails table) but
        # we still wrap it in a sandbox-ish blockquote so malformed HTML from odd
        # carrier clients can't escape and break the outer layout.
        top += (
            f"<hr style='border:none;border-top:1px solid #ddd;margin:24px 0 12px' />"
            f"<p style='color:#666;font-size:12px;margin-bottom:8px'>"
            f"On our original correspondence{sent_line}{subj_line}, we wrote:"
            f"</p>"
            f"<blockquote style='margin:0;padding:0 12px;border-left:3px solid #ccc;color:#555'>"
            f"{previous_body_html}"
            f"</blockquote>"
        )

    return top + f"<!-- Richard {cadence_type} {tone_label} -->"


@app.post("/api/claim-brain/{claim_id}/reset")
async def reset_claim_brain(claim_id: str):
    """Reset the Claim Brain conversation for a claim."""
    _brain_conversations.pop(claim_id, None)
    try:
        sb = get_supabase_client()
        sb.table("claim_brain_messages").delete().eq("claim_id", claim_id).execute()
    except Exception as e:
        print(f"[BRAIN] Failed to delete persisted messages (non-fatal): {e}")
    return {"status": "reset", "claim_id": claim_id}


# ===================================================================
# DIRECT EMAIL SEND — For Supplement Composer (bypasses Claim Brain chat)
# ===================================================================

class DirectEmailRequest(BaseModel):
    claim_id: str
    user_id: str | None = None
    to_email: str
    subject: str
    body_html: str
    cc: str | None = None
    attachment_paths: list[str] | None = None  # Supabase storage paths to attach
    email_type: str = "supplement"  # supplement | install_supplement | coc | aob | invoice


@app.get("/api/claim-brain/{claim_id}/suggestions")
async def claim_brain_suggestions(claim_id: str):
    """Proactive nudges Richard can surface when the user opens a claim.

    Computed from scope_comparison (biggest gaps), pending cadences, recent
    carrier emails, and missing docs. Frontend shows them as tappable cards.
    Each suggestion has a `prompt` the chat can auto-send.
    """
    sb = get_supabase_client()
    result = sb.table("claims").select(
        "address, carrier, claim_number, phase, status, scope_comparison, scope_files, aob_files"
    ).eq("id", claim_id).single().execute()
    claim = result.data or {}

    suggestions: list[dict] = []

    # 1. Top scope-comparison gaps — highest dollar deltas
    scope_rows = claim.get("scope_comparison") or []
    gaps = []
    for r in scope_rows:
        if not isinstance(r, dict):
            continue
        carrier_amt = float(r.get("carrier_amount") or 0)
        usarm_amt = float(r.get("usarm_amount") or 0)
        delta = usarm_amt - carrier_amt
        if delta > 50:  # ignore trivial deltas
            gaps.append({
                "item": r.get("checklist_desc") or r.get("usarm_desc") or r.get("carrier_desc") or "item",
                "delta": delta,
            })
    gaps.sort(key=lambda g: g["delta"], reverse=True)
    for g in gaps[:3]:
        suggestions.append({
            "type": "scope_gap",
            "icon": "📐",
            "title": f"Carrier underscoped {g['item']}",
            "description": f"${g['delta']:,.0f} gap — want me to draft a supplement?",
            "prompt": f"Draft a supplement argument for the {g['item']} line item — carrier was short by ${g['delta']:,.0f}. Use the playbook and cite Xactimate pricing.",
        })

    # 2. Pending cadences — show a note about what's queued up
    try:
        cad_res = sb.table("claim_brain_cadence_sends").select(
            "followup_number, scheduled_at, cadence_type", count="exact"
        ).eq("claim_id", claim_id).eq("status", "pending").order("scheduled_at", desc=False).limit(3).execute()
        pending = cad_res.data or []
        if pending:
            next_at = pending[0].get("scheduled_at") or ""
            suggestions.append({
                "type": "cadence_pending",
                "icon": "⏱️",
                "title": f"{len(pending)} follow-up{'s' if len(pending) != 1 else ''} queued",
                "description": f"Next: {next_at[:10]}. Review or cancel?",
                "prompt": "Show me all pending follow-ups on this claim.",
            })
    except Exception as e:
        print(f"[suggestions] cadence lookup failed (non-fatal): {e}")

    # 3. Missing carrier scope — can't run comparison without it
    if not scope_rows and not claim.get("scope_files"):
        suggestions.append({
            "type": "missing_scope",
            "icon": "📥",
            "title": "No carrier scope attached yet",
            "description": "Drop the adjuster report when you get it and I'll run the comparison.",
            "prompt": "What should I be doing before the carrier scope comes in?",
        })

    # 4. No AOB attached — reminder if claim is in progress
    if not claim.get("aob_files") and claim.get("phase") in ("pre_scope", "inspection", "post_scope"):
        suggestions.append({
            "type": "missing_aob",
            "icon": "✍️",
            "title": "No AOB on file",
            "description": "Want me to generate one and send for signature?",
            "prompt": "Generate an AOB for the homeowner to sign.",
        })

    # 5. Weak documentation — surface photo coaching proactively when DS is low
    damage_score = claim.get("damage_score")
    if isinstance(damage_score, (int, float)) and damage_score < 70:
        suggestions.append({
            "type": "weak_documentation",
            "icon": "📷",
            "title": f"Damage score is {int(damage_score)} — evidence can be stronger",
            "description": "Let me tell you exactly which photos to take (test squares, chalk, scale refs).",
            "prompt": "What photos am I missing? How can I strengthen the documentation?",
        })

    return {"suggestions": suggestions[:4]}


@app.get("/api/claim-brain/{claim_id}/history")
async def claim_brain_history(claim_id: str):
    """Fetch persisted Claim Brain messages for frontend rehydration."""
    sb = get_supabase_client()
    result = sb.table("claim_brain_messages") \
        .select("role, content") \
        .eq("claim_id", claim_id) \
        .in_("role", ["user", "assistant"]) \
        .order("created_at", desc=False) \
        .limit(50) \
        .execute()
    return {"messages": result.data or []}


@app.post("/api/supplement-email/send")
async def send_supplement_email_direct(body: DirectEmailRequest):
    """Send an email with optional file attachments from Supabase Storage."""
    from claim_brain_email import send_claim_email

    sb = get_supabase_client()

    # Get user_id from claim if not provided
    user_id = body.user_id
    if not user_id:
        claim_result = sb.table("claims").select("user_id").eq("id", body.claim_id).limit(1).execute()
        user_id = claim_result.data[0]["user_id"] if claim_result.data else ""

    if not user_id:
        return {"status": "error", "message": "Could not determine user"}

    # Download attachments from Supabase Storage (compress images for email)
    attachments = []
    if body.attachment_paths:
        for path in body.attachment_paths:
            try:
                data = sb.storage.from_("claim-documents").download(path)
                if not data:
                    continue
                filename = path.split("/")[-1]
                ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

                # Compress images to max 1200px wide, 80% JPEG quality (keeps email under 25MB)
                if ext in ("jpg", "jpeg", "png", "heic", "heif", "webp"):
                    try:
                        from PIL import Image
                        import io as _io
                        img = Image.open(_io.BytesIO(data))
                        # Auto-rotate based on EXIF
                        from PIL import ImageOps
                        img = ImageOps.exif_transpose(img)
                        # Resize if wider than 1200px
                        max_width = 1200
                        if img.width > max_width:
                            ratio = max_width / img.width
                            new_size = (max_width, int(img.height * ratio))
                            img = img.resize(new_size, Image.LANCZOS)
                        # Convert to JPEG
                        buf = _io.BytesIO()
                        img = img.convert("RGB")
                        img.save(buf, format="JPEG", quality=80, optimize=True)
                        compressed = buf.getvalue()
                        original_kb = len(data) / 1024
                        compressed_kb = len(compressed) / 1024
                        print(f"[EMAIL] Compressed {filename}: {original_kb:.0f}KB → {compressed_kb:.0f}KB", flush=True)
                        # Use compressed version, change extension to .jpg
                        jpg_name = filename.rsplit(".", 1)[0] + ".jpg" if "." in filename else filename + ".jpg"
                        attachments.append({"filename": jpg_name, "content": compressed})
                        continue
                    except Exception as ce:
                        print(f"[EMAIL] Image compression failed for {filename}, using original: {ce}", flush=True)

                # Non-image files (PDFs, etc.) — attach as-is
                attachments.append({"filename": filename, "content": data})
                print(f"[EMAIL] Attached: {filename} ({len(data) / 1024:.0f}KB)", flush=True)
            except Exception as e:
                print(f"[EMAIL] Failed to download attachment {path}: {e}", flush=True)

    try:
        result = send_claim_email(
            sb=sb,
            user_id=user_id,
            claim_id=body.claim_id,
            to_email=body.to_email,
            subject=body.subject,
            body_html=body.body_html,
            cc=body.cc,
            email_type=body.email_type,
            attachments=attachments if attachments else None,
        )
        return result
    except Exception as e:
        print(f"[EMAIL ERROR] {e}", flush=True)
        return {"status": "error", "message": str(e)}


# ===================================================================
# CERTIFICATE OF COMPLETION — Generate & Send
# ===================================================================

class CocRequest(BaseModel):
    claim_id: str
    user_id: str | None = None
    completion_date: str | None = None
    work_description: str | None = None
    warranty_terms: str | None = None

class CocSendRequest(BaseModel):
    claim_id: str
    user_id: str | None = None
    pdf_path: str
    to_email: str
    cc: str | None = None

class GenerateAobRequest(BaseModel):
    claim_id: str
    user_id: str | None = None
    document_type: str = "aob"
    homeowner_name: str | None = None

@app.post("/api/generate-aob")
async def generate_aob_endpoint(body: GenerateAobRequest):
    """Generate an unsigned AOB/contingency PDF and upload to storage."""
    from claim_brain_aob import generate_aob_pdf

    sb = get_supabase_client()

    # Get claim data
    claim_result = sb.table("claims").select("*").eq("id", body.claim_id).limit(1).execute()
    if not claim_result.data:
        return {"status": "error", "message": "Claim not found"}
    claim_data = claim_result.data[0]

    user_id = body.user_id or claim_data.get("user_id", "")

    # Resolve company profile (admin cascade)
    company_profile = {}
    try:
        cp_result = sb.table("company_profiles").select("*").eq("user_id", user_id).limit(1).execute()
        profile = cp_result.data[0] if cp_result.data else None

        # If not admin, look up admin profile
        if profile and not profile.get("is_admin"):
            company_id = profile.get("company_id")
            if company_id:
                admin_result = sb.table("company_profiles").select("*").eq("company_id", company_id).eq("is_admin", True).limit(1).execute()
                if admin_result.data:
                    profile = admin_result.data[0]

        if profile:
            company_profile = {
                "company_name": profile.get("company_name", ""),
                "address": profile.get("address", ""),
                "city_state_zip": profile.get("city_state_zip", ""),
                "phone": profile.get("phone", ""),
                "email": profile.get("email", ""),
                "license_number": profile.get("license_number", ""),
                "contact_name": profile.get("contact_name", ""),
            }
    except Exception:
        pass

    # Override homeowner name if provided
    if body.homeowner_name:
        claim_data["homeowner_name"] = body.homeowner_name

    try:
        pdf_bytes = generate_aob_pdf(claim_data, company_profile)

        from datetime import datetime
        file_path = f"{claim_data.get('file_path', body.claim_id)}/aob/unsigned_{body.document_type}_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        sb.storage.from_("claim-documents").upload(file_path, pdf_bytes, {"content-type": "application/pdf"})

        return {"status": "ok", "pdf_path": file_path}
    except Exception as e:
        print(f"[AOB GENERATE ERROR] {e}", flush=True)
        return {"status": "error", "message": str(e)}


@app.post("/api/coc/generate")
async def generate_coc_endpoint(body: CocRequest):
    """Generate a Certificate of Completion PDF and upload to storage."""
    from claim_brain_pdfs import generate_coc_pdf

    sb = get_supabase_client()

    # Get claim data
    claim_result = sb.table("claims").select("*").eq("id", body.claim_id).limit(1).execute()
    if not claim_result.data:
        return {"status": "error", "message": "Claim not found"}
    claim_data = claim_result.data[0]

    user_id = body.user_id or claim_data.get("user_id", "")

    # Get company profile
    company_profile = {}
    try:
        cp_result = sb.table("company_profiles").select("*").eq("user_id", user_id).limit(1).execute()
        if cp_result.data:
            cp = cp_result.data[0]
            company_profile = {
                "company_name": cp.get("company_name", ""),
                "address": cp.get("address", ""),
                "city_state_zip": cp.get("city_state_zip", ""),
                "phone": cp.get("phone", ""),
                "email": cp.get("email", ""),
                "license_number": cp.get("license_number", ""),
                "contact_name": cp.get("contact_name", ""),
            }
    except Exception:
        pass

    try:
        pdf_bytes = generate_coc_pdf(
            claim_data, company_profile,
            completion_date=body.completion_date,
            work_description=body.work_description,
            warranty_terms=body.warranty_terms,
        )

        from datetime import datetime
        file_path = f"{claim_data.get('file_path', body.claim_id)}/brain/coc_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        sb.storage.from_("claim-documents").upload(file_path, pdf_bytes, {"content-type": "application/pdf"})

        # Get signed URL for download
        signed = sb.storage.from_("claim-documents").create_signed_url(file_path, 3600)
        download_url = signed.get("signedURL") or signed.get("signedUrl") or ""

        return {
            "status": "ok",
            "pdf_path": file_path,
            "download_url": download_url,
        }
    except Exception as e:
        print(f"[COC ERROR] {e}", flush=True)
        return {"status": "error", "message": str(e)}


@app.post("/api/coc/send")
async def send_coc_endpoint(body: CocSendRequest):
    """Send the COC PDF via email to carrier/homeowner."""
    from claim_brain_email import send_claim_email

    sb = get_supabase_client()

    user_id = body.user_id
    if not user_id:
        claim_result = sb.table("claims").select("user_id, address, carrier").eq("id", body.claim_id).limit(1).execute()
        if claim_result.data:
            user_id = claim_result.data[0]["user_id"]
            address = claim_result.data[0].get("address", "the property")
            carrier = claim_result.data[0].get("carrier", "Insurance Carrier")
        else:
            return {"status": "error", "message": "Claim not found"}
    else:
        claim_result = sb.table("claims").select("address, carrier").eq("id", body.claim_id).limit(1).execute()
        address = claim_result.data[0].get("address", "the property") if claim_result.data else "the property"
        carrier = claim_result.data[0].get("carrier", "Insurance Carrier") if claim_result.data else "Insurance Carrier"

    # Get company name
    company_name = "Your Roofing Company"
    try:
        cp_result = sb.table("company_profiles").select("company_name").eq("user_id", user_id).limit(1).execute()
        if cp_result.data:
            company_name = cp_result.data[0].get("company_name", company_name)
    except Exception:
        pass

    body_html = (
        f"<p>Dear {carrier} Claims Department,</p>"
        f"<p>Please find attached the Certificate of Completion for storm damage restoration "
        f"work at {address}. All work has been completed in accordance with the approved scope "
        f"and applicable building codes.</p>"
        f"<p>Please process final payment at your earliest convenience.</p>"
        f"<p>Respectfully,<br/>{company_name}</p>"
    )

    try:
        result = send_claim_email(
            sb=sb,
            user_id=user_id,
            claim_id=body.claim_id,
            to_email=body.to_email,
            subject=f"Certificate of Completion — {address}",
            body_html=body_html,
            cc=body.cc,
            email_type="coc",
            attachments=[{"path": body.pdf_path, "filename": "Certificate_of_Completion.pdf"}],
        )

        # Update lifecycle phase
        sb.table("claims").update({
            "lifecycle_phase": "completed",
        }).eq("id", body.claim_id).execute()

        return result
    except Exception as e:
        print(f"[COC SEND ERROR] {e}", flush=True)
        return {"status": "error", "message": str(e)}


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
# CRM INTEGRATIONS
# ===================================================================

class IntegrationConnectRequest(BaseModel):
    provider: str  # "acculynx" or "companycam"
    api_key: str
    user_id: str

class IntegrationDisconnectRequest(BaseModel):
    provider: str
    user_id: str


@app.post("/api/integrations/connect")
async def integration_connect(req: IntegrationConnectRequest):
    """Connect a CRM integration — test the key, then save to company_profiles."""
    from integrations.acculynx import AccuLynxClient
    from integrations.companycam import CompanyCamClient
    from datetime import datetime, timezone

    if req.provider == "acculynx":
        client = AccuLynxClient(req.api_key)
        ok, msg = await client.test_connection()
        key_col, ts_col = "acculynx_api_key", "acculynx_connected_at"
    elif req.provider == "companycam":
        client = CompanyCamClient(req.api_key)
        ok, msg = await client.test_connection()
        key_col, ts_col = "companycam_api_key", "companycam_connected_at"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")

    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "message": msg})

    sb = get_supabase_client()
    try:
        sb.table("company_profiles").upsert({
            "user_id": req.user_id,
            key_col: req.api_key,
            ts_col: datetime.now(timezone.utc).isoformat(),
        }, on_conflict="user_id").execute()
        return {"ok": True, "message": msg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/integrations/disconnect")
async def integration_disconnect(req: IntegrationDisconnectRequest):
    """Disconnect a CRM integration — clear the API key."""
    if req.provider == "acculynx":
        key_col, ts_col = "acculynx_api_key", "acculynx_connected_at"
    elif req.provider == "companycam":
        key_col, ts_col = "companycam_api_key", "companycam_connected_at"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")

    sb = get_supabase_client()
    try:
        sb.table("company_profiles").update({
            key_col: None,
            ts_col: None,
        }).eq("user_id", req.user_id).execute()
        return {"ok": True, "message": f"{req.provider} disconnected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/integrations/status")
async def integration_status(user_id: str):
    """Check which CRM integrations are connected for a user.
    Cascades to company admin profile if user doesn't have their own keys."""
    sb = get_supabase_client()
    try:
        # Get user's own profile
        result = sb.table("company_profiles").select(
            "acculynx_api_key, acculynx_connected_at, "
            "companycam_api_key, companycam_connected_at, "
            "company_id, is_admin"
        ).eq("user_id", user_id).limit(1).execute()

        profile = result.data[0] if result.data else None

        # If user has keys, return them directly
        if profile and (profile.get("acculynx_api_key") or profile.get("companycam_api_key")):
            return {
                "acculynx": bool(profile.get("acculynx_api_key")),
                "acculynx_connected_at": profile.get("acculynx_connected_at"),
                "companycam": bool(profile.get("companycam_api_key")),
                "companycam_connected_at": profile.get("companycam_connected_at"),
            }

        # Cascade: look up company admin's profile
        admin_profile = None

        # Try company_id first — find an admin who actually has keys
        if profile and profile.get("company_id"):
            admin_result = sb.table("company_profiles").select(
                "acculynx_api_key, acculynx_connected_at, "
                "companycam_api_key, companycam_connected_at"
            ).eq("company_id", profile["company_id"]).eq("is_admin", True).execute()
            for candidate in (admin_result.data or []):
                if candidate.get("acculynx_api_key") or candidate.get("companycam_api_key"):
                    admin_profile = candidate
                    break

        # Try domain matching — get user's email from their profile or auth
        if not admin_profile:
            user_email = None
            # First try: get email from the user's own profile
            if profile and profile.get("email"):
                user_email = profile["email"]
            # Second try: check company_profiles by user_id for email
            if not user_email:
                try:
                    email_result = sb.table("company_profiles").select("email").eq("user_id", user_id).limit(1).execute()
                    if email_result.data and email_result.data[0].get("email"):
                        user_email = email_result.data[0]["email"]
                except Exception:
                    pass
            # Third try: get from auth.users
            if not user_email:
                try:
                    user_result = sb.auth.admin.get_user_by_id(user_id)
                    if hasattr(user_result, 'user') and user_result.user:
                        user_email = user_result.user.email
                except Exception:
                    pass

            if user_email and "@" in user_email:
                domain = user_email.split("@")[-1].lower()
                admin_profiles_result = sb.table("company_profiles").select(
                    "acculynx_api_key, acculynx_connected_at, "
                    "companycam_api_key, companycam_connected_at, email"
                ).eq("is_admin", True).execute()
                for ap in (admin_profiles_result.data or []):
                    ap_email = (ap.get("email") or "").lower()
                    if ap_email.endswith(f"@{domain}") and (ap.get("acculynx_api_key") or ap.get("companycam_api_key")):
                        admin_profile = ap
                        break

        if admin_profile:
            return {
                "acculynx": bool(admin_profile.get("acculynx_api_key")),
                "acculynx_connected_at": admin_profile.get("acculynx_connected_at"),
                "companycam": bool(admin_profile.get("companycam_api_key")),
                "companycam_connected_at": admin_profile.get("companycam_connected_at"),
            }

        return {"acculynx": False, "companycam": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _get_user_integration_client(user_id: str, provider: str):
    """Helper: fetch the user's API key, falling back to company admin's key via company_id or domain."""
    from integrations.acculynx import AccuLynxClient
    from integrations.companycam import CompanyCamClient

    sb = get_supabase_client()
    col = f"{provider}_api_key"

    # Try user's own profile first
    result = sb.table("company_profiles").select(f"{col}, company_id, email").eq("user_id", user_id).limit(1).execute()
    profile = result.data[0] if result.data else None
    api_key = profile.get(col) if profile else None

    # Fall back 1: company_id → admin profile (find one that actually has the key)
    if not api_key and profile and profile.get("company_id"):
        company_id = profile["company_id"]
        admin_result = sb.table("company_profiles").select(col).eq("company_id", company_id).eq("is_admin", True).execute()
        for candidate in (admin_result.data or []):
            if candidate.get(col):
                api_key = candidate[col]
                break

    # Fall back 2: domain matching → find admin with same email domain who has the key
    if not api_key:
        user_email = profile.get("email") if profile else None
        if not user_email:
            try:
                user_result = sb.auth.admin.get_user_by_id(user_id)
                if hasattr(user_result, 'user') and user_result.user:
                    user_email = user_result.user.email
            except Exception:
                pass
        if user_email and "@" in user_email:
            domain = user_email.split("@")[-1].lower()
            admin_profiles = sb.table("company_profiles").select(f"{col}, email").eq("is_admin", True).execute()
            for ap in (admin_profiles.data or []):
                ap_email = (ap.get("email") or "").lower()
                if ap_email.endswith(f"@{domain}") and ap.get(col):
                    api_key = ap[col]
                    break

    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider} not connected. Ask your company admin to connect it in Settings.")

    if provider == "acculynx":
        return AccuLynxClient(api_key)
    return CompanyCamClient(api_key)


@app.get("/api/integrations/acculynx/jobs")
async def acculynx_jobs(user_id: str, search: str = ""):
    """Search/list jobs from the user's AccuLynx account.

    Paginates v2 API and filters by address/city/state client-side.
    AccuLynx search= param is unreliable (doesn't filter by address).
    """
    client = await _get_user_integration_client(user_id, "acculynx")
    jobs = await client.search_jobs(query=search)
    return {"jobs": jobs}


@app.get("/api/integrations/acculynx/jobs/{job_id}")
async def acculynx_job_detail(job_id: str, user_id: str):
    """Get full job details including contacts and insurance."""
    client = await _get_user_integration_client(user_id, "acculynx")
    job = await client.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Try to get primary contact name via contact _link
    homeowner = ""
    contact_link = job.get("contactLink", "")
    if contact_link:
        contact = await client.get_contact(contact_link)
        if contact:
            parts = [contact.get("firstName", ""), contact.get("lastName", "")]
            homeowner = " ".join(p for p in parts if p).strip()

    # Try to get insurance info
    insurance = await client.get_job_insurance(job_id)
    carrier = ""
    if insurance and isinstance(insurance, dict):
        carrier = insurance.get("insuranceCompany", "") or insurance.get("company", "")

    return {
        "job": job,
        "homeowner": homeowner,
        "carrier": carrier,
        "insurance": insurance,
    }


@app.get("/api/integrations/companycam/projects")
async def companycam_projects(user_id: str, query: str = "", page: int = 1):
    """Search CompanyCam projects by address."""
    client = await _get_user_integration_client(user_id, "companycam")
    projects = await client.search_projects(query=query, page=page)
    return {"projects": projects}


@app.get("/api/integrations/companycam/projects/{project_id}/photos")
async def companycam_photos(project_id: str, user_id: str):
    """Get all photos for a CompanyCam project."""
    from integrations.companycam import CompanyCamClient
    client = await _get_user_integration_client(user_id, "companycam")
    photos = await client.get_all_project_photos(project_id)

    # Enrich with download URL + thumbnail URL for each photo
    enriched = []
    for photo in photos:
        url = CompanyCamClient.get_photo_url(photo, size="web")
        thumb = CompanyCamClient.get_photo_url(photo, size="thumb") or CompanyCamClient.get_photo_url(photo, size="small") or url
        enriched.append({
            "id": photo.get("id"),
            "url": url,
            "created_at": photo.get("created_at"),
            "coordinates": photo.get("coordinates"),
            "photo_url": thumb,
        })
    return {"photos": enriched}


@app.post("/api/integrations/companycam/projects/{project_id}/import")
async def companycam_import(
    project_id: str,
    user_id: str = Body(...),
    slug: str = Body(...),
    selected_indices: list[int] | None = Body(None),
    target_path: str | None = Body(None),
    target_folder: str | None = Body(None),
):
    """Download photos from CompanyCam and upload to Supabase storage.

    If selected_indices is provided, only those photos are imported.
    Otherwise imports up to 100 photos.
    target_path: override full storage base path (e.g., "user_id/claim-slug/")
    target_folder: subfolder within target_path (e.g., "install-photos", "completion-photos")
    """
    from integrations.companycam import CompanyCamClient

    client = await _get_user_integration_client(user_id, "companycam")
    photos = await client.get_all_project_photos(project_id)

    # Filter to selected photos if indices provided
    if selected_indices is not None:
        photos = [photos[i] for i in selected_indices if i < len(photos)]
    else:
        photos = photos[:100]

    sb = get_supabase_client()
    uploaded = []

    for i, photo in enumerate(photos):
        url = CompanyCamClient.get_photo_url(photo)
        if not url:
            continue
        try:
            data = await client.download_photo(url)
            if not data:
                continue
            # Generate safe filename
            ext = ".jpg"
            if url.lower().endswith(".png"):
                ext = ".png"
            fname = f"companycam_{i+1:03d}{ext}"
            # Use target_path override if provided (for install supplements, COC, etc.)
            if target_path:
                folder = target_folder or "photos"
                storage_path = f"{target_path}/{folder}/{fname}"
            else:
                storage_path = f"{user_id}/{slug}/photos/{fname}"
            sb.storage.from_("claim-documents").upload(
                storage_path, data,
                file_options={"content-type": f"image/{ext.strip('.')}", "upsert": "true"}
            )
            uploaded.append({"name": fname, "path": storage_path})
        except Exception as e:
            print(f"[CRM-IMPORT] Failed to import photo {i}: {e}")
            continue

    return {"uploaded": uploaded, "count": len(uploaded), "paths": [u["path"] for u in uploaded]}


@app.post("/api/integrations/acculynx/jobs/{job_id}/import")
async def acculynx_import(job_id: str, user_id: str = Body(...), slug: str = Body(...)):
    """Fetch job details from AccuLynx and return metadata for claim form.

    Note: AccuLynx v2 API does NOT support document/photo download (D-022).
    This endpoint returns job metadata only (address, homeowner, carrier).
    Users must upload EagleViews and photos separately.
    """
    client = await _get_user_integration_client(user_id, "acculynx")

    # Fetch normalized job
    job = await client.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Get homeowner name from contact _link
    homeowner = ""
    contact_link = job.get("contactLink", "")
    if contact_link:
        contact = await client.get_contact(contact_link)
        if contact:
            parts = [contact.get("firstName", ""), contact.get("lastName", "")]
            homeowner = " ".join(p for p in parts if p).strip()

    # Get carrier from insurance
    carrier = ""
    insurance = await client.get_job_insurance(job_id)
    if insurance and isinstance(insurance, dict):
        ins_co = insurance.get("insuranceCompany")
        if isinstance(ins_co, dict):
            carrier = ins_co.get("name", "")
        elif isinstance(ins_co, str):
            carrier = ins_co

    address = ", ".join(filter(None, [
        job.get("streetAddress", ""),
        job.get("city", ""),
        job.get("state", ""),
        job.get("zip", ""),
    ]))

    return {
        "address": address,
        "homeowner": homeowner,
        "carrier": carrier,
        "photo_count": 0,  # v2 API can't download photos
        "job": job,
    }


# ===================================================================
# BACKGROUND POLLERS
# ===================================================================

async def poll_for_claims():
    """Background poller — checks for new claims every 10 seconds.
    Uses atomic status update to prevent duplicate processing across workers.
    """
    while True:
        try:
            sb = get_supabase_client()
            result = sb.table("claims").select("id").eq("status", "uploaded").execute()
            for claim in result.data:
                # Atomically claim this job by setting status to processing.
                # If another worker already claimed it, the update returns 0 rows.
                lock = sb.table("claims").update(
                    {"status": "processing"}
                ).eq("id", claim["id"]).eq("status", "uploaded").execute()
                if not lock.data:
                    continue  # Another worker already claimed it
                print(f"[POLLER] Claimed and processing: {claim['id']}")
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
