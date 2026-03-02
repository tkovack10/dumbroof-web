#!/usr/bin/env python3
"""
Backfill Data Warehouse — Migrate 26 existing claims into Supabase analytics tables.
=====================================================================================
Reads all claim_config.json files from the USARM-Claims-Platform and populates:
  - photos, line_items, carrier_tactics, claim_outcomes, pricing_benchmarks

Usage:
    python3 scripts/backfill_warehouse.py                  # Dry run — print summary
    python3 scripts/backfill_warehouse.py --execute        # Actually write to Supabase
    python3 scripts/backfill_warehouse.py --execute --clear # Clear tables first, then backfill
"""

from __future__ import annotations

import os
import sys
import json
import glob
import argparse
from datetime import datetime

# Add backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

from supabase import create_client

CLAIMS_DIR = os.path.expanduser("~/USARM-Claims-Platform/claims")

# Mapping from dashboard status to win boolean
STATUS_WIN_MAP = {"won": True, "pending": False, "denied": False, "appraisal": False}


def get_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env")
        sys.exit(1)
    return create_client(url, key)


def load_all_configs() -> list[tuple[str, dict]]:
    """Load all claim_config.json files. Returns list of (slug, config) tuples."""
    configs = []
    pattern = os.path.join(CLAIMS_DIR, "*/claim_config.json")
    for path in sorted(glob.glob(pattern)):
        slug = os.path.basename(os.path.dirname(path))
        try:
            with open(path) as f:
                config = json.load(f)
            configs.append((slug, config))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  SKIP {slug}: {e}")
    return configs


def build_photo_rows(slug: str, config: dict) -> list[dict]:
    """Extract photo records from a claim config."""
    rows = []
    annotations = config.get("photo_annotations", {})
    photo_map = config.get("photo_map", {})

    for key, annotation in annotations.items():
        row = {
            "file_path": photo_map.get(key, key),
            "annotation_key": key,
            "annotation_text": annotation[:2000] if annotation else None,
        }
        # Try to infer tags from annotation text
        tags = _infer_photo_tags(annotation)
        row.update(tags)
        rows.append(row)

    return rows


def build_line_item_rows(config: dict) -> tuple[list[dict], list[dict]]:
    """Extract USARM and carrier line items. Returns (usarm_items, carrier_items)."""
    price_list = config.get("financials", {}).get("price_list", "NYBI26")
    state = config.get("property", {}).get("state", "")
    city = config.get("property", {}).get("city", "")
    region = f"{city}, {state}".strip(", ") if city or state else ""

    usarm_rows = []
    for item in config.get("line_items", []):
        usarm_rows.append({
            "category": item.get("category", "GENERAL"),
            "description": item.get("description", "")[:500],
            "qty": item.get("qty", 0),
            "unit": item.get("unit", "EA"),
            "unit_price": item.get("unit_price", 0),
            "xactimate_code": item.get("code_OPTIONAL") or item.get("code"),
            "trade": item.get("trade_OPTIONAL") or item.get("trade"),
            "source": "usarm",
            "evidence_photos": item.get("evidence_photos_OPTIONAL") or item.get("evidence_photos"),
            "price_list": price_list,
            "region": region,
        })

    def _clean_numeric(val, default=0):
        """Clean a value that might be a dollar string like '$287.00' into a float."""
        if val is None:
            return default
        if isinstance(val, (int, float)):
            return float(val)
        s = str(val).strip().replace("$", "").replace(",", "")
        try:
            return float(s) if s else default
        except ValueError:
            return default

    carrier_rows = []
    for item in config.get("carrier", {}).get("carrier_line_items", []):
        # Handle both old and new carrier line item formats
        if isinstance(item, dict):
            desc = str(item.get("item") or item.get("description") or "")
            amount = _clean_numeric(item.get("carrier_amount") or item.get("amount", 0))
            note = item.get("note") or item.get("usarm_desc", "")

            # Try to extract qty/unit/price from carrier_desc
            qty, unit, unit_price = _parse_carrier_desc(str(item.get("carrier_desc", "")))
            if not unit_price:
                unit_price = amount
            else:
                unit_price = _clean_numeric(unit_price)

            carrier_rows.append({
                "category": item.get("category", "GENERAL"),
                "description": desc[:500],
                "qty": _clean_numeric(qty) or 1,
                "unit": str(unit or "EA"),
                "unit_price": unit_price,
                "source": "carrier",
                "variance_note": str(note)[:500] if note else None,
                "price_list": price_list,
                "region": region,
            })

    return usarm_rows, carrier_rows


def build_carrier_tactics_rows(config: dict) -> list[dict]:
    """Extract carrier tactics from arguments and revision data."""
    carrier = config.get("carrier", {}).get("name", "")
    if not carrier:
        return []

    state = config.get("property", {}).get("state", "")
    rows = []

    # Carrier's arguments (their tactics)
    for arg in config.get("carrier", {}).get("carrier_arguments", []):
        rows.append({
            "carrier": carrier,
            "tactic_type": _classify_tactic(arg),
            "description": arg[:500],
            "region": state,
        })

    # If there are scope revisions, extract proven arguments
    for revision in config.get("scope_revisions", []):
        for mapping in revision.get("argument_mapping", []):
            confidence = mapping.get("confidence", "").upper()
            rows.append({
                "carrier": carrier,
                "tactic_type": "counter_argument",
                "description": mapping.get("change", "")[:500],
                "counter_argument": mapping.get("likely_argument", "")[:500],
                "effective": confidence in ("HIGH", "MEDIUM"),
                "trade": mapping.get("trade"),
                "region": state,
                "settlement_impact": _extract_dollar_amount(mapping.get("change", "")),
            })

    return rows


def build_claim_outcome_row(slug: str, config: dict) -> dict:
    """Build a claim outcome record."""
    carrier = config.get("carrier", {}).get("name", "")
    state = config.get("property", {}).get("state", "")
    city = config.get("property", {}).get("city", "")
    trades = config.get("scope", {}).get("trades", [])
    dashboard = config.get("dashboard", {})

    structures = config.get("structures", [{}])
    roof_area = sum(s.get("roof_area_sq", 0) for s in structures if isinstance(s, dict))

    # Compute financials
    line_total = sum(
        item.get("qty", 0) * item.get("unit_price", 0)
        for item in config.get("line_items", [])
    )
    tax_rate = config.get("financials", {}).get("tax_rate", 0.08)
    tax = line_total * tax_rate
    rcv = line_total + tax
    o_and_p = line_total * 0.20 if config.get("scope", {}).get("o_and_p") else 0
    usarm_total = rcv + o_and_p
    deductible = config.get("financials", {}).get("deductible", 0)

    original_rcv = dashboard.get("carrier_1st_scope", 0) or config.get("carrier", {}).get("carrier_rcv", 0)
    current_rcv = dashboard.get("carrier_current", 0) or config.get("carrier", {}).get("carrier_rcv", 0)
    is_win = dashboard.get("status") == "won"
    settlement = current_rcv if is_win else 0
    movement = current_rcv - original_rcv if original_rcv else 0
    movement_pct = (movement / original_rcv * 100) if original_rcv and original_rcv > 0 else 0

    # Parse date_of_loss
    dol_str = config.get("dates", {}).get("date_of_loss", "")
    dol = None
    if dol_str:
        for fmt in ("%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y"):
            try:
                dol = datetime.strptime(dol_str, fmt).strftime("%Y-%m-%d")
                break
            except (ValueError, TypeError):
                continue

    row = {
        "slug": slug,
        "carrier": carrier,
        "region": f"{city}, {state}".strip(", "),
        "state": state,
        "trades": trades,
        "trade_count": len(trades),
        "roof_area_sq": roof_area,
        "hail_size": config.get("weather", {}).get("hail_size", ""),
        "original_carrier_rcv": round(original_rcv, 2),
        "current_carrier_rcv": round(current_rcv, 2),
        "usarm_rcv": round(usarm_total, 2),
        "settlement_amount": round(settlement, 2),
        "movement_amount": round(movement, 2),
        "movement_pct": round(movement_pct, 1),
        "deductible": round(deductible, 2),
        "o_and_p": config.get("scope", {}).get("o_and_p", False),
        "win": is_win,
        "went_to_appraisal": dashboard.get("phase") == "Appraisal",
        "source": "cli",
    }
    if dol:
        row["date_of_loss"] = dol

    return row


def build_pricing_rows(config: dict) -> list[dict]:
    """Build pricing benchmark rows from both USARM and carrier line items."""
    price_list = config.get("financials", {}).get("price_list", "NYBI26")
    state = config.get("property", {}).get("state", "")
    city = config.get("property", {}).get("city", "")
    region = f"{city}, {state}".strip(", ")

    rows = []

    def _to_float(val, default=0):
        try:
            return float(val) if val else default
        except (ValueError, TypeError):
            return default

    # USARM prices
    for item in config.get("line_items", []):
        up = _to_float(item.get("unit_price", 0))
        if up <= 0:
            continue
        rows.append({
            "region": region,
            "price_list": price_list,
            "description": str(item.get("description", ""))[:500],
            "xactimate_code": item.get("code_OPTIONAL") or item.get("code"),
            "unit": str(item.get("unit", "EA")),
            "unit_price": up,
            "source": "usarm",
            "category": item.get("category"),
        })

    # Carrier prices
    for item in config.get("carrier", {}).get("carrier_line_items", []):
        if isinstance(item, dict):
            desc = str(item.get("item") or item.get("description") or "")
            # Try to extract per-unit price from carrier_desc
            carrier_desc = item.get("carrier_desc", "")
            _, unit, unit_price = _parse_carrier_desc(str(carrier_desc))
            if not unit_price:
                unit_price = _to_float(item.get("carrier_amount") or item.get("amount", 0))
            else:
                unit_price = _to_float(unit_price)
            if unit_price <= 0:
                continue

            rows.append({
                "region": region,
                "price_list": price_list,
                "description": desc[:500],
                "unit": unit or "EA",
                "unit_price": unit_price,
                "source": "carrier",
                "category": item.get("category"),
            })

    return rows


# ===================================================================
# HELPERS
# ===================================================================

def _infer_photo_tags(annotation: str) -> dict:
    """Infer damage_type, material, trade, elevation from annotation text."""
    tags = {}
    if not annotation:
        return tags

    ann_lower = annotation.lower()

    # Damage type
    if any(w in ann_lower for w in ["chalk", "chalk test", "chalk line"]):
        tags["damage_type"] = "chalk_test"
    elif any(w in ann_lower for w in ["hail dent", "hail impact", "hail damage", "indentation"]):
        tags["damage_type"] = "hail_dent"
    elif any(w in ann_lower for w in ["crack", "fracture", "split"]):
        tags["damage_type"] = "crack"
    elif any(w in ann_lower for w in ["missing", "absent", "torn off", "blown off"]):
        tags["damage_type"] = "missing"
    elif any(w in ann_lower for w in ["granule loss", "granule displacement"]):
        tags["damage_type"] = "granule_loss"
    elif any(w in ann_lower for w in ["lifted", "curled", "unsealed"]):
        tags["damage_type"] = "lifted_tab"
    elif any(w in ann_lower for w in ["wind crease", "wind damage"]):
        tags["damage_type"] = "wind_crease"
    elif any(w in ann_lower for w in ["rust", "corrosion", "oxidation"]):
        tags["damage_type"] = "corrosion"
    elif any(w in ann_lower for w in ["overview", "aerial", "satellite", "full view"]):
        tags["damage_type"] = "overview"

    # Material
    if any(w in ann_lower for w in ["aluminum siding", "aluminum .024", "alumin"]):
        tags["material"] = "aluminum_siding"
    elif any(w in ann_lower for w in ["vinyl siding"]):
        tags["material"] = "vinyl_siding"
    elif any(w in ann_lower for w in ["laminated", "architectural", "comp shingle"]):
        tags["material"] = "comp_shingle_laminated"
    elif any(w in ann_lower for w in ["3-tab", "three tab", "3 tab"]):
        tags["material"] = "comp_shingle_3tab"
    elif any(w in ann_lower for w in ["slate"]):
        tags["material"] = "slate"
    elif any(w in ann_lower for w in ["copper"]):
        tags["material"] = "copper"
    elif any(w in ann_lower for w in ["gutter", "downspout"]):
        tags["material"] = "aluminum_gutter"
    elif any(w in ann_lower for w in ["flashing", "step flash", "counter flash"]):
        tags["material"] = "metal_flashing"
    elif any(w in ann_lower for w in ["window wrap", "window trim", "j-channel"]):
        tags["material"] = "aluminum_trim"
    elif any(w in ann_lower for w in ["vent", "exhaust", "pipe boot", "pipe collar"]):
        tags["material"] = "metal_vent"

    # Trade
    if any(w in ann_lower for w in ["siding", "wall", "elevation", "house wrap"]):
        tags["trade"] = "siding"
    elif any(w in ann_lower for w in ["gutter", "downspout"]):
        tags["trade"] = "gutters"
    elif any(w in ann_lower for w in ["window wrap", "window trim"]):
        tags["trade"] = "window_wraps"
    elif any(w in ann_lower for w in ["shingle", "roof", "ridge", "valley", "flashing", "vent", "pipe"]):
        tags["trade"] = "roofing"

    # Elevation
    if any(w in ann_lower for w in ["front elevation", "front of"]):
        tags["elevation"] = "front"
    elif any(w in ann_lower for w in ["rear elevation", "rear of", "back elevation", "back of"]):
        tags["elevation"] = "rear"
    elif any(w in ann_lower for w in ["left elevation", "left side"]):
        tags["elevation"] = "left"
    elif any(w in ann_lower for w in ["right elevation", "right side"]):
        tags["elevation"] = "right"
    elif any(w in ann_lower for w in ["roof", "slope", "shingle"]):
        tags["elevation"] = "roof"
    elif any(w in ann_lower for w in ["close-up", "closeup", "detail", "macro"]):
        tags["elevation"] = "detail"

    return tags


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


def _extract_dollar_amount(text: str) -> float:
    """Extract first dollar amount from text."""
    import re
    match = re.search(r'\$[\d,]+(?:\.\d{2})?', text)
    if match:
        try:
            return float(match.group().replace("$", "").replace(",", ""))
        except ValueError:
            pass
    return 0


def _parse_carrier_desc(desc: str) -> tuple:
    """Parse carrier description like '15.19 SQ @ $74.75/SQ = $1,226.29'
    Returns (qty, unit, unit_price) or (None, None, None)."""
    import re
    match = re.match(r'([\d.]+)\s*(\w+)\s*@\s*\$([\d,.]+)/\w+', desc)
    if match:
        try:
            return (
                float(match.group(1)),
                match.group(2),
                float(match.group(3).replace(",", "")),
            )
        except ValueError:
            pass
    return (None, None, None)


# ===================================================================
# MAIN
# ===================================================================

def main():
    parser = argparse.ArgumentParser(description="Backfill data warehouse from existing claims")
    parser.add_argument("--execute", action="store_true", help="Actually write to Supabase (default is dry run)")
    parser.add_argument("--clear", action="store_true", help="Clear warehouse tables before backfill")
    args = parser.parse_args()

    print(f"{'=' * 60}")
    print(f"DumbRoof Data Warehouse Backfill")
    print(f"{'=' * 60}")

    configs = load_all_configs()
    print(f"\nLoaded {len(configs)} claim configs from {CLAIMS_DIR}\n")

    # Collect all rows
    all_photos = []
    all_usarm_items = []
    all_carrier_items = []
    all_tactics = []
    all_outcomes = []
    all_pricing = []

    for slug, config in configs:
        address = config.get("property", {}).get("address", slug)
        carrier = config.get("carrier", {}).get("name", "?")
        status = config.get("dashboard", {}).get("status", "?")

        photos = build_photo_rows(slug, config)
        usarm_items, carrier_items = build_line_item_rows(config)
        tactics = build_carrier_tactics_rows(config)
        outcome = build_claim_outcome_row(slug, config)
        pricing = build_pricing_rows(config)

        all_photos.extend(photos)
        all_usarm_items.extend(usarm_items)
        all_carrier_items.extend(carrier_items)
        all_tactics.extend(tactics)
        all_outcomes.append(outcome)
        all_pricing.extend(pricing)

        print(f"  {address:<40} | {carrier:<15} | {status:<8} | "
              f"{len(photos):>3} photos | {len(usarm_items):>3} USARM items | "
              f"{len(carrier_items):>3} carrier items | {len(tactics):>2} tactics")

    print(f"\n{'=' * 60}")
    print(f"TOTALS:")
    print(f"  Photos:             {len(all_photos):>6}")
    print(f"  USARM Line Items:   {len(all_usarm_items):>6}")
    print(f"  Carrier Line Items: {len(all_carrier_items):>6}")
    print(f"  Carrier Tactics:    {len(all_tactics):>6}")
    print(f"  Claim Outcomes:     {len(all_outcomes):>6}")
    print(f"  Pricing Benchmarks: {len(all_pricing):>6}")
    print(f"{'=' * 60}")

    if not args.execute:
        print("\nDRY RUN — use --execute to write to Supabase")
        return

    # Write to Supabase
    print("\nConnecting to Supabase...")
    sb = get_supabase()

    if args.clear:
        print("Clearing warehouse tables...")
        for table in ["photos", "line_items", "carrier_tactics", "claim_outcomes", "pricing_benchmarks"]:
            try:
                # Delete all rows (Supabase requires a filter — use created_at > epoch)
                sb.table(table).delete().gte("created_at", "1970-01-01").execute()
                print(f"  Cleared {table}")
            except Exception as e:
                print(f"  Could not clear {table}: {e}")

    # We can't set claim_id for backfill from CLI claims (they don't have Supabase IDs)
    # So we skip claim_id foreign key — these are historical records

    def _batch_insert(table: str, rows: list, batch_size: int = 50):
        """Insert rows in batches."""
        if not rows:
            return 0
        inserted = 0
        errors = 0
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            try:
                sb.table(table).insert(batch).execute()
                inserted += len(batch)
            except Exception as e:
                errors += 1
                print(f"  ERROR inserting batch {i // batch_size + 1} into {table}: {e}")
                # Try individual inserts
                for row in batch:
                    try:
                        sb.table(table).insert(row).execute()
                        inserted += 1
                    except Exception:
                        pass
        print(f"  {table}: {inserted}/{len(rows)} rows inserted ({errors} batch errors)")
        return inserted

    print("\nWriting photos...")
    _batch_insert("photos", all_photos)

    print("Writing USARM line items...")
    _batch_insert("line_items", all_usarm_items)

    print("Writing carrier line items...")
    _batch_insert("line_items", all_carrier_items)

    print("Writing carrier tactics...")
    _batch_insert("carrier_tactics", all_tactics)

    print("Writing claim outcomes...")
    _batch_insert("claim_outcomes", all_outcomes)

    print("Writing pricing benchmarks...")
    _batch_insert("pricing_benchmarks", all_pricing)

    print(f"\n{'=' * 60}")
    print(f"BACKFILL COMPLETE")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
