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
from repair_processor import process_repair
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
    return {"status": "ok"}


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
        sb = get_supabase_client()
        sb.table("repairs").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("id", repair_id).execute()


@app.post("/api/process-repair/{repair_id}")
async def trigger_repair_processing(repair_id: str, background_tasks: BackgroundTasks):
    """Manually trigger processing for a specific repair."""
    background_tasks.add_task(run_repair_processing, repair_id)
    return {"status": "processing", "repair_id": repair_id}


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
    """Background poller — checks for new repairs every 10 seconds."""
    while True:
        try:
            sb = get_supabase_client()
            result = sb.table("repairs").select("id").eq("status", "uploaded").execute()
            for repair in result.data:
                print(f"[REPAIR POLLER] Found new repair: {repair['id']}")
                await run_repair_processing(repair["id"])
        except Exception as e:
            print(f"[REPAIR POLLER] Error: {e}")
        await asyncio.sleep(10)
