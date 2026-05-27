#!/usr/bin/env python3
"""Ship 1.3 — the ingestion firewall (plan B.5).

Validates every market's prices in pricing_market_prices against physical bounds,
inversions, material hierarchy, statistical outliers, and completeness. Markets
that fail keep/get status='pending' — claims can never be priced from a pending
market. This is the layer that would have stopped the E230 gutter corruption from
reaching a customer claim.

Reads the relational tables (not the JSON), so it validates exactly what the
pipeline will serve once Ships 2-7 cut reads over. Run it (a) now against the
patched import and (b) again after the post-Verisk re-import — same code, the
different outcomes prove the firewall works.

Usage:
    python3 backend/validate_market_prices.py            # report only
    python3 backend/validate_market_prices.py --commit    # flip failing markets -> pending
"""
from __future__ import annotations
import argparse, os, statistics, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))

# short_key rule constants (from the catalog seeded in Ship 1.2)
GUTTER_KSTYLE_AL   = "gutter_aluminum"
GUTTER_KSTYLE_CU   = "gutter_copper"
GUTTER_HALFROUND_AL = "gutter_half_round_aluminum"
GUTTER_CEILING = 25.00   # $/LF — k-style aluminum gutter physical ceiling
COPPER_FLOOR   = 5.00    # $/LF — copper gutter physical floor
OUTLIER_PCT    = 0.50    # >50% BELOW national median = below floor of physical possibility
UNDER_MIN_ITEMS = 2      # this many under-priced items = systematic mis-scaling (French-batch signature)

def _load_env():
    env = {}
    p = os.path.join(HERE, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return (os.environ.get("SUPABASE_URL") or env.get("SUPABASE_URL"),
            os.environ.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_SERVICE_KEY"))

def _fetch():
    from supabase import create_client
    url, key = _load_env()
    if not url or not key:
        print("FATAL: SUPABASE_URL / SUPABASE_SERVICE_KEY missing", file=sys.stderr); sys.exit(1)
    sb = create_client(url, key)
    # markets + their status
    markets = {m["market_id"]: m for m in sb.table("pricing_markets")
               .select("market_id,name,status").execute().data}
    # catalog: line_item_id -> (short_key, is_mandatory, status)
    cat = {r["line_item_id"]: r for r in sb.table("pricing_line_items")
           .select("line_item_id,short_key,is_mandatory,status").execute().data}
    # prices (paginate — >1000 rows)
    prices = []
    start = 0
    while True:
        chunk = (sb.table("pricing_market_prices")
                 .select("market_id,line_item_id,unit_price")
                 .range(start, start + 999).execute().data)
        if not chunk:
            break
        prices.extend(chunk)
        if len(chunk) < 1000:
            break
        start += 1000
    return sb, markets, cat, prices

def validate():
    sb, markets, cat, prices = _fetch()

    # market_id -> {short_key: price}
    by_market = defaultdict(dict)
    # short_key -> [prices across ACTIVE markets] (for national median)
    by_key_active = defaultdict(list)
    for p in prices:
        c = cat.get(p["line_item_id"])
        if not c:
            continue
        # Only ACTIVE catalog items are watched. inactive/draft items (e.g. unused
        # specialty roofing USARM never claims against) are kept for historical reads
        # but the firewall ignores them — and they never get priced onto a claim, so a
        # corrupt value can't ship. See the inactive-item refactor + lifecycle below.
        if c.get("status") != "active":
            continue
        sk = c["short_key"]; price = float(p["unit_price"]); mid = p["market_id"]
        by_market[mid][sk] = price
        if markets.get(mid, {}).get("status") == "active":
            by_key_active[sk].append(price)

    medians = {sk: statistics.median(v) for sk, v in by_key_active.items() if v}
    mandatory = [c["short_key"] for c in cat.values() if c.get("is_mandatory")]

    # Every rule below is a PHYSICAL-BOUNDS rule (not a "wrong-but-not-THAT-wrong"
    # severity tier): a price either is or isn't physically possible. Failures
    # keep the market pending (plan B.5).
    fails = {}   # market_id -> [issue strings]
    for mid, p in by_market.items():
        f = []
        ga, gc, gh = p.get(GUTTER_KSTYLE_AL), p.get(GUTTER_KSTYLE_CU), p.get(GUTTER_HALFROUND_AL)
        if ga is not None and ga > GUTTER_CEILING:
            f.append(f"gutter_aluminum ${ga:.2f}/LF > ${GUTTER_CEILING:.0f} ceiling")
        if gc is not None and gc < COPPER_FLOOR:
            f.append(f"gutter_copper ${gc:.2f}/LF < ${COPPER_FLOOR:.0f} floor")
        if gh is not None and ga is not None and gh < ga:
            f.append(f"half-round aluminum ${gh:.2f} < k-style ${ga:.2f} (inverted)")
        if gc is not None and ga is not None and gc <= ga:
            f.append(f"copper ${gc:.2f} <= aluminum ${ga:.2f} (hierarchy violation)")
        for sk in mandatory:
            if sk not in p:
                f.append(f"missing mandatory item {sk}")

        # OUTLIERS — DIRECTIONAL, not a symmetric band. These are INSTALLED prices
        # (labor + delivery + contractor markup + metro market dynamics), so being
        # ABOVE the national median is legitimate high-cost region — Manhattan/
        # Chicago genuinely cost 50-100%+ more — and is NEVER flagged, regardless
        # of magnitude. Being far BELOW median is the floor of physical possibility:
        # you cannot source installed work at <50% of the national rate. Multiple
        # such items is the French-batch mis-scaling signature (E230/E251). This is
        # the same shape as the gutter floor/ceiling — two opposite-direction
        # physical bounds. Empirically decisive: high-cost metros flag 100%
        # above-median / 0 below; corruption flags below-median (NYMN 49/0 above vs
        # TXHO 1/3 — direction is the discriminator, not magnitude).
        under = [(sk, price, medians[sk]) for sk, price in p.items()
                 if medians.get(sk) and (price - medians[sk]) / medians[sk] < -OUTLIER_PCT]
        if len(under) >= UNDER_MIN_ITEMS:
            for sk, price, med in sorted(under, key=lambda x: x[1]/x[2])[:5]:
                f.append(f"{sk} ${price:.2f} vs median ${med:.2f} ({(price-med)/med*100:+.0f}% UNDER)")

        if f:
            fails[mid] = f

    return sb, markets, fails, medians


# French-batch states whose corruption Shell B is re-extracting from Verisk
# (source_batch verisk_extract_2026_05_25). Flagged markets here are expected to
# clear on the post-Verisk re-import + re-validate.
VERISK_REIMPORT_STATES = {"TX", "MN", "MI"}

def categorize_pending(markets, pending_ids):
    """Bucket the pending set so '47 markets pending' reads as actionable, not scary."""
    clears, no_repl = [], []
    for mid in sorted(pending_ids):
        (clears if mid[:2] in VERISK_REIMPORT_STATES else no_repl).append(mid)
    return clears, no_repl

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="flip hard-fail markets -> status=pending")
    args = ap.parse_args()

    sb, markets, fails, medians = validate()
    n = len(markets)
    src_pending = sum(1 for m in markets.values() if m["status"] == "pending")

    print(f"\n=== validate_market_prices ({n} markets, {src_pending} already pending) ===")
    print(f"national medians computed for {len(medians)} line items (active markets)\n")

    active_fails = [mid for mid in fails if markets[mid]["status"] != "pending"]
    print(f"HARD FAILS: {len(fails)} markets ({len(active_fails)} currently active -> would flip to pending)")
    shown = 0
    for mid in sorted(fails):
        if shown >= 15:
            print(f"  ... and {len(fails)-shown} more"); break
        print(f"  {mid} [{markets[mid]['status']}]: {'; '.join(fails[mid][:2])}{' ...' if len(fails[mid])>2 else ''}")
        shown += 1
    if not fails:
        print("  (none — clean)")

    if args.commit:
        for mid in active_fails:
            sb.table("pricing_markets").update({"status": "pending"}).eq("market_id", mid).execute()
        print(f"\nCOMMIT: flipped {len(active_fails)} active markets -> pending")

    # Categorize the resulting pending set so it reads as actionable, not scary.
    final_pending = set(mid for mid, m in markets.items() if m["status"] == "pending")
    if args.commit:
        final_pending |= set(active_fails)
    clears, no_repl = categorize_pending(markets, final_pending)
    print(f"\n=== PENDING SET: {len(final_pending)} markets ===")
    print(f"  [{len(clears)}] expected to clear on Verisk re-import (TX/MN/MI French batch):")
    print(f"      {clears}")
    print(f"  [{len(no_repl)}] NO Verisk replacement queued — sized extraction work item:")
    print(f"      {no_repl}")
    if not args.commit:
        print(f"\n(report only — --commit flips {len(active_fails)} active markets to pending)")

if __name__ == "__main__":
    main()
