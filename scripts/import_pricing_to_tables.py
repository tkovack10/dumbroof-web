#!/usr/bin/env python3
"""Ship 1.2 — one-shot importer: backend/pricing/all-markets.json -> relational
pricing_* tables (read-only alongside the JSON until Ships 2-7 cut reads over).

Builds:
  pricing_line_items     canonical catalog, keyed by stable short_key
  pricing_markets        one row per market (status, source_batch)
  pricing_market_prices  (market_id, line_item_id) -> unit_price

short_key comes from processor._DESC_TO_PRICING_KEY where a description matches
(via xactimate_lookup._clean_desc); otherwise a slug is generated so no item is
lost. Coverage (canonical vs generated) is reported. is_national_rate is set by
the enumerated labor/equipment/debris set (not guessed per-item).

Faithful mirror: every allItems price lands in pricing_market_prices per market
(including labor, which varies by market in the source). pricing_national_prices
is left for a later consolidation pass. validate_market_prices (Ship 1.3) flips
bad markets to status='pending' after import.

Usage:
    python3 scripts/import_pricing_to_tables.py            # DRY RUN (no writes)
    python3 scripts/import_pricing_to_tables.py --commit    # upsert to Supabase
"""
from __future__ import annotations
import argparse, json, os, re, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
sys.path.insert(0, BACKEND)

from xactimate_lookup import _clean_desc, XactRegistry  # noqa: E402
from processor import _DESC_TO_PRICING_KEY              # noqa: E402

ALL_MARKETS = os.path.join(BACKEND, "pricing", "all-markets.json")
SOURCE_BATCH = "all-markets-json-import-2026-05-26"

# Items whose rate is national, not market-specific (must be enumerated, not
# guessed — see plan B.1). Matched as substrings of the cleaned description.
NATIONAL_KEYWORDS = (
    "per hour", "roofer", "equipment operator", "dumpster", "debris",
    "general cleanup", "permit", "haul",
)

def _is_national(cleaned: str) -> bool:
    return any(k in cleaned for k in NATIONAL_KEYWORDS)

def _category(cleaned: str) -> str:
    if any(k in cleaned for k in ("gutter", "downspout")): return "GUTTERS"
    if any(k in cleaned for k in ("siding", "house wrap", "fanfold", "shutter", "window wrap")): return "SIDING"
    if any(k in cleaned for k in ("dumpster", "debris", "haul")): return "DEBRIS"
    if any(k in cleaned for k in ("shingle", "felt", "ridge", "drip", "starter", "flashing",
                                   "ice & water", "underlayment", "roof", "vent")): return "ROOFING"
    return "GENERAL"

def _slug(cleaned: str, action: str = "") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", cleaned.lower()).strip("_")
    base = ("gen_" + s)[:52]
    act = re.sub(r"[^a-z0-9]+", "", (action or "").lower())
    return f"{base}_{act}" if act else base

def build():
    am = json.load(open(ALL_MARKETS))
    markets = am.get("markets", {})

    # (cleaned_canonical_desc, action) -> short_key. MUST include action: _clean_desc
    # strips the Remove/Install/R&R prefix, so "Remove Wood shakes..." and "Wood
    # shakes..." (install) clean identically and would collapse to ONE short_key,
    # mislabeling the remove price as install and dropping the install price. This
    # mirrors get_market_prices' (cleaned, action) keying — the processor path we
    # must match for Ship 2 parity.
    canon = {}
    for desc, key in _DESC_TO_PRICING_KEY.items():
        canon[(_clean_desc(desc), XactRegistry._infer_action(desc))] = key

    catalog = {}            # short_key -> {description, unit, category, is_national_rate}
    prices = []             # (market_id, short_key, unit_price)
    market_rows = []        # (market_id, name, state, status, source_batch)
    canonical_hits = generated = 0

    for mcode, m in markets.items():
        state = mcode[:2]
        status = "pending" if m.get("pending") else "active"
        market_rows.append((mcode, m.get("name", ""), state, status))
        for it in (m.get("allItems") or []):
            desc = (it.get("description") or "").strip()
            price = it.get("price")
            if not desc or price is None:
                continue
            cleaned = _clean_desc(desc)
            if not cleaned:
                continue
            action = XactRegistry._infer_action(desc)
            key = canon.get((cleaned, action))
            if key:
                canonical_hits += 1
            else:
                key = _slug(cleaned, action)  # action in slug keeps remove/install distinct
                generated += 1
            catalog.setdefault(key, {
                "short_key": key,
                "description": desc,
                "unit": it.get("unit") or "",
                "category": _category(cleaned),
                "is_national_rate": _is_national(cleaned),
            })
            prices.append((mcode, key, round(float(price), 2)))

    return catalog, prices, market_rows, canonical_hits, generated

def report(catalog, prices, market_rows, canonical_hits, generated):
    print(f"\n=== IMPORT PLAN (dry run) ===")
    print(f"markets:        {len(market_rows)}  ({sum(1 for *_ ,s in [(r[0],r[3]) for r in market_rows] if s=='pending')} pending in source)")
    pend = sum(1 for r in market_rows if r[3] == "pending")
    print(f"  active={len(market_rows)-pend}  pending={pend}")
    print(f"catalog items:  {len(catalog)}  ({sum(1 for c in catalog.values() if c['is_national_rate'])} national-rate)")
    print(f"market prices:  {len(prices)}")
    tot = canonical_hits + generated
    print(f"short_key coverage: {canonical_hits}/{tot} canonical ({100*canonical_hits//max(tot,1)}%), {generated} auto-slugged")
    gen_keys = sorted({k for k, c in catalog.items() if k.startswith('gen_')})
    print(f"auto-slugged catalog items ({len(gen_keys)}): {gen_keys[:12]}{' ...' if len(gen_keys)>12 else ''}")

def _load_env():
    env = {}
    p = os.path.join(BACKEND, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = os.environ.get("SUPABASE_URL") or env.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_SERVICE_KEY")
    return url, key

def commit(catalog, prices, market_rows):
    from supabase import create_client
    url, key = _load_env()
    if not url or not key:
        print("FATAL: SUPABASE_URL / SUPABASE_SERVICE_KEY not found in env or backend/.env", file=sys.stderr)
        sys.exit(1)
    sb = create_client(url, key)

    # 1. catalog (upsert by short_key) — then read back to get line_item_id
    sb.table("pricing_line_items").upsert(
        [{"short_key": c["short_key"], "description": c["description"], "unit": c["unit"],
          "category": c["category"], "is_national_rate": c["is_national_rate"]}
         for c in catalog.values()],
        on_conflict="short_key",
    ).execute()
    rows = sb.table("pricing_line_items").select("line_item_id, short_key").execute().data
    key_to_id = {r["short_key"]: r["line_item_id"] for r in rows}
    print(f"  upserted {len(catalog)} catalog items; {len(key_to_id)} ids resolved")

    # 2. markets (upsert by market_id)
    sb.table("pricing_markets").upsert(
        [{"market_id": mc, "name": nm, "state": st, "status": stt, "source_batch": SOURCE_BATCH}
         for (mc, nm, st, stt) in market_rows],
        on_conflict="market_id",
    ).execute()
    print(f"  upserted {len(market_rows)} markets")

    # 3. market prices (batch upsert). Dedupe (market_id, line_item_id) first —
    # multiple source descriptions can collapse to the same short_key within a
    # market (standard/high-grade collapse, English+French variants). The PK
    # forbids the duplicate the JSON tolerated; first-write-wins matches
    # get_market_prices' setdefault behavior.
    seen = set()
    payload = []
    dropped = 0
    for (mc, k, p) in prices:
        lid = key_to_id.get(k)
        if lid is None:
            continue
        pk = (mc, lid)
        if pk in seen:
            dropped += 1
            continue
        seen.add(pk)
        payload.append({"market_id": mc, "line_item_id": lid, "unit_price": p,
                        "source_batch": SOURCE_BATCH})
    if dropped:
        print(f"  deduped {dropped} duplicate (market, line_item) prices (first-write-wins)")
    B = 500
    for i in range(0, len(payload), B):
        sb.table("pricing_market_prices").upsert(
            payload[i:i+B], on_conflict="market_id,line_item_id"
        ).execute()
    print(f"  upserted {len(payload)} market prices")
    print("COMMIT DONE.")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="write to Supabase (default: dry run)")
    args = ap.parse_args()
    catalog, prices, market_rows, ch, gen = build()
    report(catalog, prices, market_rows, ch, gen)
    if args.commit:
        print("\n=== COMMITTING ===")
        commit(catalog, prices, market_rows)
    else:
        print("\n(dry run — pass --commit to write)")
