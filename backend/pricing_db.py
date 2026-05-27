#!/usr/bin/env python3
"""Ship 2 — the canonical relational price query (plan B.2).

get_prices_for_market(market_id) -> {short_key: unit_price} for ACTIVE catalog
items, COALESCE(market_price, national_price). This is THE single function that
owns (market, line_item) -> unit_price, replacing the all-markets.json +
_DESC_TO_PRICING_KEY inversion + per-state legacy JSON as the processor's price
source. An unpriceable item is simply absent from the dict (caller's _priced()
hardcoded fallback or the legacy-JSON fallback still applies during the parity
window) — there is no NY-baseline path.

Pure-read, cached per market_id. supabase-py can't express the COALESCE join, so
it's done in Python from three small selects (catalog ~131, market_prices ~80,
national ~6). Returns {} on any error so the caller's existing fallbacks hold —
pricing must never hard-fail a claim build on a transient DB blip.
"""
from __future__ import annotations
import os
import logging

logger = logging.getLogger(__name__)
_SB = None
_CACHE: dict[str, dict] = {}

def _get_sb():
    global _SB
    if _SB is not None:
        return _SB
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        # local/dev: fall back to backend/.env (gitignored)
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        if os.path.exists(env_path):
            for line in open(env_path):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    v = v.strip().strip('"').strip("'")
                    if k.strip() == "SUPABASE_URL" and not url:
                        url = v
                    elif k.strip() == "SUPABASE_SERVICE_KEY" and not key:
                        key = v
    if not (url and key):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not available")
    from supabase import create_client
    _SB = create_client(url, key)
    return _SB

def get_prices_for_market(market_id: str) -> dict:
    """Return {short_key: unit_price} for ACTIVE items in this market.

    COALESCE(market_price, national_price). Items with neither are omitted.
    Cached per market_id. Returns {} on error (caller keeps its fallbacks).
    """
    if not market_id:
        return {}
    if market_id in _CACHE:
        return _CACHE[market_id]
    try:
        sb = _get_sb()
        # active catalog: line_item_id -> (short_key, is_national_rate)
        cat = sb.table("pricing_line_items").select(
            "line_item_id,short_key,is_national_rate").eq("status", "active").execute().data
        by_id = {r["line_item_id"]: r for r in cat}
        # market prices for this market: line_item_id -> price
        mp = {}
        start = 0
        while True:
            chunk = (sb.table("pricing_market_prices").select("line_item_id,unit_price")
                     .eq("market_id", market_id).range(start, start + 999).execute().data)
            if not chunk:
                break
            for r in chunk:
                mp[r["line_item_id"]] = float(r["unit_price"])
            if len(chunk) < 1000:
                break
            start += 1000
        # national prices: line_item_id -> price
        np = {r["line_item_id"]: float(r["unit_price"])
              for r in sb.table("pricing_national_prices").select("line_item_id,unit_price").execute().data}
        # COALESCE(market, national) per active item
        out = {}
        for lid, c in by_id.items():
            price = mp.get(lid)
            if price is None:
                price = np.get(lid)
            if price is not None:
                out[c["short_key"]] = price
        _CACHE[market_id] = out
        return out
    except Exception as e:
        logger.warning("get_prices_for_market(%s) failed (%s) — caller falls back", market_id, e)
        return {}

def _reset_cache():
    _CACHE.clear()
