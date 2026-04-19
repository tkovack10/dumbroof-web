"""
Processing Telemetry — Logs every Claude API call to Supabase processing_logs table.
==================================================================================
Wraps _call_claude_with_retry to capture: model, tokens, cost, duration, success/failure.
Also provides warehouse write functions for photos, line_items, carrier_tactics, claim_outcomes, pricing_benchmarks.
"""

from __future__ import annotations

import os
import time
import json
from datetime import datetime, date
from typing import Optional

import anthropic

# Cost per 1M tokens (as of March 2026 — verified against anthropic.com/pricing)
MODEL_COSTS = {
    "claude-opus-4-6":   {"input": 5.00, "output": 25.00},
    "claude-sonnet-4-6": {"input": 3.00,  "output": 15.00},
    "claude-haiku-4-5-20251001": {"input": 1.00, "output": 5.00},
    # Legacy models (hail_detection, damage_scoring CLI)
    "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00},
}

# Cache token pricing multipliers (relative to input price)
CACHE_WRITE_MULTIPLIER = 1.25  # cache_creation_input_tokens cost 1.25x input
CACHE_READ_MULTIPLIER = 0.10   # cache_read_input_tokens cost 0.1x input

# Fallback for unknown models
DEFAULT_COST = {"input": 3.00, "output": 15.00}


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int,
                    cache_creation_tokens: int = 0, cache_read_tokens: int = 0) -> float:
    """Estimate cost including cached token pricing."""
    costs = MODEL_COSTS.get(model, DEFAULT_COST)
    input_price = costs["input"]
    base_cost = (prompt_tokens * input_price + completion_tokens * costs["output"]) / 1_000_000
    cache_cost = (
        cache_creation_tokens * input_price * CACHE_WRITE_MULTIPLIER +
        cache_read_tokens * input_price * CACHE_READ_MULTIPLIER
    ) / 1_000_000
    return base_cost + cache_cost


def call_claude_logged(
    client: anthropic.Anthropic,
    sb,
    claim_id: Optional[str],
    step_name: str,
    max_retries: int = 3,
    metadata: Optional[dict] = None,
    **kwargs,
) -> anthropic.types.Message:
    """Call Claude API with retry + telemetry logging to processing_logs table.

    Drop-in replacement for _call_claude_with_retry that also logs to Supabase.
    """
    model = kwargs.get("model", "claude-opus-4-6")
    start_ms = time.time() * 1000
    last_error = None

    for attempt in range(max_retries):
        attempt_start = time.time() * 1000
        try:
            response = client.messages.create(**kwargs)

            # Extract token counts from response (including cache tokens)
            usage = response.usage
            prompt_tokens = usage.input_tokens
            completion_tokens = usage.output_tokens
            cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
            cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
            duration_ms = int(time.time() * 1000 - start_ms)
            cost = _estimate_cost(model, prompt_tokens, completion_tokens,
                                  cache_creation, cache_read)

            # Log success (include cache info in metadata)
            log_meta = dict(metadata or {})
            if cache_creation or cache_read:
                log_meta["cache_creation_tokens"] = cache_creation
                log_meta["cache_read_tokens"] = cache_read
            if attempt > 0:
                log_meta["retry_attempt"] = attempt

            _log_to_db(sb, claim_id, step_name, model, prompt_tokens,
                       completion_tokens, cost, duration_ms, True, None, log_meta)

            return response

        except anthropic.RateLimitError as e:
            last_error = str(e)
            # Log the failed attempt so consumed tokens aren't lost
            attempt_duration = int(time.time() * 1000 - attempt_start)
            _log_to_db(sb, claim_id, f"{step_name}_retry_{attempt}", model, 0, 0, 0,
                       attempt_duration, False, f"rate_limit (attempt {attempt + 1})", metadata)
            if attempt < max_retries - 1:
                wait = 60 * (attempt + 1)
                print(f"[RATE LIMIT] Waiting {wait}s before retry {attempt + 2}/{max_retries}...")
                time.sleep(wait)
            else:
                duration_ms = int(time.time() * 1000 - start_ms)
                _log_to_db(sb, claim_id, step_name, model, 0, 0, 0,
                           duration_ms, False, last_error, metadata)
                raise e

        except Exception as e:
            duration_ms = int(time.time() * 1000 - start_ms)
            _log_to_db(sb, claim_id, step_name, model, 0, 0, 0,
                       duration_ms, False, str(e), metadata)
            raise e

    # Should not reach here, but just in case
    duration_ms = int(time.time() * 1000 - start_ms)
    _log_to_db(sb, claim_id, step_name, model, 0, 0, 0,
               duration_ms, False, last_error or "max retries exceeded", metadata)
    raise RuntimeError(f"Claude call failed after {max_retries} retries: {last_error}")


def _log_to_db(sb, claim_id, step_name, model, prompt_tokens, completion_tokens,
               cost, duration_ms, success, error_message, metadata):
    """Write a processing log entry to Supabase. Non-fatal on failure."""
    if not sb:
        return
    try:
        row = {
            "step_name": step_name,
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_cost": round(cost, 6),
            "duration_ms": duration_ms,
            "success": success,
            "metadata": metadata or {},
        }
        if claim_id:
            row["claim_id"] = claim_id
        if error_message:
            row["error_message"] = error_message[:500]

        sb.table("processing_logs").insert(row).execute()
    except Exception as e:
        print(f"[TELEMETRY] Log write failed (non-fatal): {e}")


# ===================================================================
# WAREHOUSE WRITE FUNCTIONS
# ===================================================================

def _json_serial(obj):
    """JSON serializer for objects not serializable by default."""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


def write_photos(sb, claim_id: str, photo_analysis: dict, photo_integrity: dict = None,
                  photo_filenames: list = None, exif_metadata: dict = None):
    """Write photo records to the photos table from analyze_photos() output.

    exif_metadata (optional): dict keyed by annotation_key OR filename; values are
    dicts with any of: gps_lat, gps_lon, heading, altitude, focal_length_mm.
    Feeds the photo→slope mapping pipeline.
    """
    if not sb or not claim_id:
        return 0

    annotations = photo_analysis.get("photo_annotations", {})
    photo_tags = photo_analysis.get("photo_tags", {})  # New structured tags
    exif_metadata = exif_metadata or {}
    integrity_findings = {}
    if photo_integrity:
        for finding in photo_integrity.get("findings", []):
            # Map findings to photos if possible
            photo_ref = finding.get("photo", "")
            if photo_ref:
                integrity_findings[photo_ref] = finding

    rows = []
    for key, annotation in annotations.items():
        tags = photo_tags.get(key, {})
        # Map annotation key (photo_01) to actual filename from photo_filenames list
        fname = None
        if photo_filenames:
            idx = int(key.replace("photo_", "")) - 1
            if 0 <= idx < len(photo_filenames):
                fname = photo_filenames[idx]
        row = {
            "claim_id": claim_id,
            "file_path": tags.get("file_path", key),
            "annotation_key": key,
            "annotation_text": annotation[:2000] if annotation else None,
            "damage_type": tags.get("damage_type"),
            "material": tags.get("material"),
            "trade": tags.get("trade"),
            "elevation": tags.get("elevation"),
            "severity": tags.get("severity"),
            "filename": fname,
        }

        # EXIF metadata — lookup by annotation_key, fall back to filename
        exif = exif_metadata.get(key) or (exif_metadata.get(fname) if fname else None) or {}
        for exif_col in ("gps_lat", "gps_lon", "heading", "altitude", "focal_length_mm"):
            val = exif.get(exif_col)
            if val is not None:
                row[exif_col] = val

        # Add integrity data if available
        integrity = integrity_findings.get(key, {})
        if integrity:
            row["fraud_score"] = integrity.get("fraud_score", 0)
            row["fraud_flags"] = integrity.get("flags", [])

        rows.append(row)

    if not rows:
        return 0

    try:
        sb.table("photos").insert(rows).execute()
        return len(rows)
    except Exception as e:
        print(f"[WAREHOUSE] Photos write failed (non-fatal): {e}")
        return 0


def write_line_items(sb, claim_id: str, items: list, source: str = "usarm",
                     price_list: str = None, region: str = None):
    """Write line items to the line_items table."""
    if not sb or not claim_id or not items:
        return 0

    rows = []
    for idx, item in enumerate(items):
        # Carrier items use "carrier_desc"/"item" fields, USARM uses "description"
        desc = (item.get("description") or item.get("carrier_desc") or item.get("item") or "")[:500]
        qty = item.get("qty", 0)
        unit_price = item.get("unit_price", 0)
        row = {
            "claim_id": claim_id,
            "category": item.get("category", "GENERAL"),
            "description": desc,
            "qty": qty,
            "unit": item.get("unit", "EA"),
            "unit_price": unit_price,
            "xactimate_code": item.get("code") or item.get("xact_code"),
            "trade": item.get("trade"),
            "source": source,
            "variance_note": item.get("note") or item.get("variance_note"),
            "evidence_photos": item.get("evidence_photos") or item.get("photo_refs"),
            "price_list": price_list,
            "region": region,
            "structure": item.get("structure"),
        }
        # New XactRegistry fields for compound learning
        supp_arg = item.get("supplement_argument", "")
        if supp_arg:
            row["variance_note"] = f"{row.get('variance_note', '') or ''}. {supp_arg}".strip(". ")
        rows.append(row)

    try:
        # Batch insert in chunks of 50
        inserted = 0
        for i in range(0, len(rows), 50):
            batch = rows[i:i+50]
            sb.table("line_items").insert(batch).execute()
            inserted += len(batch)
        return inserted
    except Exception as e:
        print(f"[WAREHOUSE] Line items write failed (non-fatal): {e}")
        return 0


def write_carrier_tactics(sb, claim_id: str, carrier: str, carrier_data: dict,
                          config: dict, revision_data: dict = None):
    """Write carrier tactics from carrier arguments and revision diffs."""
    if not sb or not claim_id or not carrier:
        return 0

    rows = []
    region = config.get("property", {}).get("state", "")

    # Record carrier's arguments/tactics from their scope
    for arg in carrier_data.get("carrier_arguments", []):
        row = {
            "claim_id": claim_id,
            "carrier": carrier,
            "tactic_type": _classify_tactic(arg),
            "description": arg[:500],
            "region": region,
        }
        rows.append(row)

    # If we have revision data, record which arguments were effective
    if revision_data:
        for mapping in revision_data.get("argument_mapping", []):
            row = {
                "claim_id": claim_id,
                "carrier": carrier,
                "tactic_type": "counter_argument",
                "description": mapping.get("change", "")[:500],
                "counter_argument": mapping.get("likely_argument", "")[:500],
                "effective": mapping.get("confidence", "").upper() in ("HIGH", "MEDIUM"),
                "trade": mapping.get("trade"),
                "region": region,
            }
            # Estimate dollar impact from the change description
            import re
            dollar_match = re.search(r'\$[\d,]+(?:\.\d{2})?', mapping.get("change", ""))
            if dollar_match:
                try:
                    amount = float(dollar_match.group().replace("$", "").replace(",", ""))
                    row["settlement_impact"] = amount
                except ValueError:
                    pass
            rows.append(row)

    if not rows:
        return 0

    try:
        sb.table("carrier_tactics").insert(rows).execute()
        return len(rows)
    except Exception as e:
        print(f"[WAREHOUSE] Carrier tactics write failed (non-fatal): {e}")
        return 0


def _classify_tactic(argument: str) -> str:
    """Classify a carrier argument into a tactic type."""
    arg_lower = argument.lower()
    if any(w in arg_lower for w in ["deny", "denied", "denial", "not covered"]):
        return "denial"
    if any(w in arg_lower for w in ["spot repair", "repair only", "patch"]):
        return "spot_repair"
    if any(w in arg_lower for w in ["partial", "one elevation", "single elevation"]):
        return "partial_scope"
    if any(w in arg_lower for w in ["deprec", "wear", "age", "pre-existing"]):
        return "depreciation"
    if any(w in arg_lower for w in ["match", "color", "discontinue"]):
        return "material_mismatch"
    if any(w in arg_lower for w in ["code", "irc", "building"]):
        return "code_dispute"
    return "underpayment"


def write_claim_outcome(sb, claim_id: str, config: dict, financials: dict,
                        carrier_data: dict = None, revision_data: dict = None):
    """Write or upsert a claim outcome record."""
    if not sb or not claim_id:
        return False

    carrier = config.get("carrier", {}).get("name", "")
    state = config.get("property", {}).get("state", "")
    trades = config.get("scope", {}).get("trades", [])
    dashboard = config.get("dashboard", {})

    structures = config.get("structures", [{}])
    roof_area = sum(s.get("roof_area_sq", 0) for s in structures)
    wall_area = config.get("measurements", {}).get("total_wall_area_sf", 0)

    original_rcv = dashboard.get("carrier_1st_scope", 0) or config.get("carrier", {}).get("carrier_rcv", 0)
    current_rcv = dashboard.get("carrier_current", 0) or config.get("carrier", {}).get("carrier_rcv", 0)
    usarm_rcv = financials.get("total", 0)

    is_win = dashboard.get("status") == "won"
    settlement = dashboard.get("carrier_current", 0) if is_win else 0
    movement = current_rcv - original_rcv if original_rcv else 0
    movement_pct = (movement / original_rcv * 100) if original_rcv and original_rcv > 0 else 0

    # Parse date_of_loss
    dol_str = config.get("dates", {}).get("date_of_loss", "")
    dol = None
    if dol_str:
        for fmt in ("%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y"):
            try:
                dol = datetime.strptime(dol_str, fmt).date()
                break
            except (ValueError, TypeError):
                continue

    row = {
        "claim_id": claim_id,
        "carrier": carrier,
        "region": f"{config.get('property', {}).get('city', '')}, {state}".strip(", "),
        "state": state,
        "trades": trades,
        "trade_count": len(trades),
        "roof_area_sq": roof_area,
        "wall_area_sf": wall_area,
        "hail_size": config.get("weather", {}).get("hail_size", ""),
        "original_carrier_rcv": original_rcv,
        "current_carrier_rcv": current_rcv,
        "usarm_rcv": usarm_rcv,
        "settlement_amount": settlement,
        "movement_amount": round(movement, 2),
        "movement_pct": round(movement_pct, 1),
        "deductible": financials.get("deductible", 0),
        "o_and_p": config.get("scope", {}).get("o_and_p", False),
        "win": is_win,
        "source": "web",
    }
    if dol:
        row["date_of_loss"] = dol.isoformat()

    try:
        # Try upsert first (handles reprocessing of same claim)
        sb.table("claim_outcomes").upsert(row, on_conflict="claim_id").execute()
        return True
    except Exception as e:
        print(f"[WAREHOUSE] Claim outcome upsert failed: {e}")
        # Fallback: delete existing row and insert fresh (handles legacy NULL claim_id conflicts)
        try:
            sb.table("claim_outcomes").delete().eq("claim_id", claim_id).execute()
            sb.table("claim_outcomes").insert(row).execute()
            print(f"[WAREHOUSE] Claim outcome written via delete+insert fallback")
            return True
        except Exception as e2:
            print(f"[WAREHOUSE] Claim outcome write FAILED (both upsert and insert): {e2}")
            return False


def write_pricing_benchmarks(sb, claim_id: str, items: list, source: str,
                             price_list: str = None, region: str = None):
    """Write pricing data points from line items."""
    if not sb or not items:
        return 0

    rows = []
    for item in items:
        unit_price = item.get("unit_price") or item.get("carrier_amount", 0)
        if not unit_price:
            continue

        # For carrier items, try to extract unit price from description
        if source == "carrier" and "carrier_desc" in item:
            import re
            price_match = re.search(r'\$(\d+(?:\.\d{2})?)/\w+', item.get("carrier_desc", ""))
            if price_match:
                try:
                    unit_price = float(price_match.group(1))
                except ValueError:
                    pass

        description = item.get("description") or item.get("item", "")
        row = {
            "claim_id": claim_id,
            "region": region or "",
            "price_list": price_list,
            "description": description[:500],
            "xactimate_code": item.get("code_OPTIONAL") or item.get("code") or item.get("xactimate_code"),
            "unit": item.get("unit", "EA"),
            "unit_price": unit_price,
            "source": source,
            "category": item.get("category"),
        }
        rows.append(row)

    if not rows:
        return 0

    try:
        # Batch insert
        inserted = 0
        for i in range(0, len(rows), 50):
            batch = rows[i:i+50]
            sb.table("pricing_benchmarks").insert(batch).execute()
            inserted += len(batch)
        return inserted
    except Exception as e:
        print(f"[WAREHOUSE] Pricing benchmarks write failed (non-fatal): {e}")
        return 0


from datetime import datetime
