#!/usr/bin/env python3
"""Ship 3 parity gate — THE gate before the generator overlay stops re-pricing
via JSON fuzzy lookup and instead trusts the frozen relational price.

Ship 3 deletes, in usarm_pdf_generator.py:_resolve_and_overlay_prices, the
`reg.load_market_prices()` + `reg.lookup_price(desc)` re-pricing path and trusts
the frozen line_item unit_price (which build_line_items set via
`_priced(get_prices_for_market(market), short_key, fallback)`).

The risk is NOT JSON-vs-relational price drift (Ship 2 proved those equal for the
consumed keys, ex-slate). The risk is that the overlay's DESCRIPTION-FUZZY path
(`lookup_price(emitted_desc)`) resolves a build-emitted description to a DIFFERENT
price than the SHORT_KEY the build actually used — because build emits a
human-readable description (e.g. "Laminated comp shingle roofing - w/out felt")
while pricing by short_key ("laminated_install"), and the _DESC_TO_PRICING_KEY
canonical form is a third string ("Laminated - comp. shingle rfg. - w/out felt").

So this gate compares, for every description build_line_items actually emits, in
every real production market:

  A = reg.lookup_price(emitted_desc)            # JSON fuzzy path Ship 3 DELETES
  B = _priced(get_prices_for_market(mkt), key)  # relational frozen price Ship 3 KEEPS

Pass criterion: every (desc, market) MATCHes after rounding to cents, EXCEPT the
slate carve-out (slate_install / slate_remove — deferred to Ship 16). A clean run
means Ship 3 is an output-IDENTICAL deletion: the overlay's re-price already
agrees with the frozen price, so deleting it changes nothing on the PDF.

Read-only: imports the modules, hits Supabase (read), touches NO production code.

Usage: python3 scripts/parity_harness_ship3.py [--verbose] [--all-markets]
"""
from __future__ import annotations
import os, sys, re, inspect, argparse
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
sys.path.insert(0, BACKEND)

import processor
from processor import build_line_items
from pricing_db import get_prices_for_market
from xactimate_lookup import XactRegistry, _get_all_markets

# Slate install/remove kept on the all-markets/legacy path until Ship 16
# (preserves $1780/$198.75). Mismatches on these keys are EXPECTED, not failures.
SLATE_DEFERRED = {"slate_install", "slate_remove"}

# The real markets production claims actually resolve to (distinct market_codes
# observed across recent web claims — spans 8 states, cross-state routes, the PA
# labor-override market, and the Commit-3 new-state markets).
DEFAULT_MARKETS_UNDER_TEST = [
    "TXHO8X_APR26",   # Houston (Brandi class)
    "TXAU8X_APR26",   # Austin
    "OHDT8X_APR26",   # OH/KY/IN cross-state route
    "OHCI8X_APR26",   # Cincinnati
    "NYBI8X_MAR26",   # Binghamton (the legacy NY baseline market)
    "ILES8X_APR26",   # IL/MO (St Louis metro) cross-state route
    "ILSP8X_APR26",   # Springfield IL
    "KSKC8X_02MAY26", # Kansas City (Commit 3)
    "KSWI8X_02MAY26", # Wichita (Commit 3)
    "SCCO8X_02MAY26", # Columbia SC (Commit 3)
    "PAPH8X_MAR26",   # Philadelphia (PA labor overrides)
    "MDBA8X_MAR26",   # Baltimore (FL cross-state route lands here)
]

# Match an items.append(...) emitted description tied to one-or-more _priced keys.
_DESC_RE = re.compile(r'"description":\s*"((?:[^"\\]|\\.)*)"')
_PRICED_RE = re.compile(r'_priced\(\s*PRICING\s*,\s*"([^"]+)"\s*,\s*([0-9.]+)\)')


def extract_emitted_triples():
    """Parse build_line_items source → list of (emitted_desc, [(short_key, fallback)...]).

    A line with one _priced is a standard line; a line with 2+ (e.g. combined R&R
    where unit_price = _priced(remove)+_priced(install)) is summed on the B side.
    Lines whose description is a variable/f-string (no quoted literal on the same
    statement) are skipped and counted — they can't be statically resolved.
    """
    src = inspect.getsource(build_line_items)
    triples, skipped_var_desc = [], 0
    for line in src.splitlines():
        if "_priced(PRICING" not in line:
            continue
        priced = _PRICED_RE.findall(line)
        if not priced:
            continue
        dm = _DESC_RE.search(line)
        if not dm:
            # _priced present but description is a variable (e.g. ridge-cap `desc`)
            # or it's an assignment like slate_rr_price = _priced(...) + _priced(...)
            if '"description"' not in line and "items.append" not in line:
                continue  # assignment helper, not an emitted line
            skipped_var_desc += 1
            continue
        desc = dm.group(1).replace('\\"', '"')
        keys = [(k, float(fb)) for k, fb in priced]
        triples.append((desc, keys))
    # de-dup identical (desc, keys) emitted in multiple roof-type branches
    seen, uniq = set(), []
    for desc, keys in triples:
        sig = (desc, tuple(keys))
        if sig in seen:
            continue
        seen.add(sig)
        uniq.append((desc, keys))
    return uniq, skipped_var_desc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--all-markets", action="store_true",
                    help="test every market in all-markets.json (default: the real-claim markets)")
    args = ap.parse_args()

    triples, skipped = extract_emitted_triples()
    if args.all_markets:
        markets = list(_get_all_markets().get("markets", {}).keys())
    else:
        markets = DEFAULT_MARKETS_UNDER_TEST

    print(f"=== Ship 3 parity gate ===")
    print(f"emitted (desc -> key) lines extracted from build_line_items: {len(triples)} "
          f"(+{skipped} variable/f-string descs skipped)")
    print(f"markets under test: {len(markets)}\n")

    total = matches = 0
    # mismatch record: (market, desc, key_str, A, B, b_used_fallback)
    mismatches = []
    a_missing = []           # lookup_price found nothing (overlay would mark 'missed', keep frozen)
    b_fallback = []          # relational lacked the key → _priced returns hardcoded fallback
    slate_expected = 0

    reg = XactRegistry()
    for mkt in markets:
        reg.load_market_prices(market_code=mkt)
        PRICING = get_prices_for_market(mkt)
        if not PRICING:
            print(f"  WARNING: relational PRICING empty for {mkt} — skipping (DB error / pending)")
            continue
        for desc, keys in triples:
            la = reg.lookup_price(desc, action=None)
            a = la.get("unit_price") if la else None
            # B side: sum of frozen relational prices (or hardcoded fallback) per key
            b = 0.0
            this_fallback = False
            for k, fb in keys:
                rel = PRICING.get(k)
                if rel is None:
                    b += fb
                    this_fallback = True
                    if k not in SLATE_DEFERRED:
                        b_fallback.append((mkt, desc, k, fb))
                else:
                    b += rel
            key_str = "+".join(k for k, _ in keys)
            is_slate = any(k in SLATE_DEFERRED for k, _ in keys)

            total += 1
            if a is None:
                a_missing.append((mkt, desc, key_str))
                continue
            if round(float(a), 2) == round(float(b), 2):
                matches += 1
            else:
                if is_slate:
                    slate_expected += 1
                else:
                    mismatches.append((mkt, desc, key_str, round(float(a), 2), round(float(b), 2), this_fallback))

    print(f"comparisons: {total} | MATCH: {matches} | "
          f"price MISMATCH (non-slate): {len(mismatches)} | "
          f"slate expected-mismatch: {slate_expected}")
    print(f"lookup_price MISS (A None, overlay keeps frozen): {len(a_missing)} | "
          f"relational-missing key → fallback (non-slate): {len(b_fallback)}")

    # Classify each non-slate mismatch:
    #  COVERAGE_GAP   = relational lacked the key (B used hardcoded fallback) but JSON
    #                   carried a real market price → Ship 3 "trust frozen" would REGRESS
    #                   (lose the real price). FIX RELATIONAL (import key) BEFORE Ship 3.
    #  RELATIONAL_AUTH = relational carried a real price that differs from JSON's fuzzy
    #                    lookup → Ship 3 correctly overrides stale/fuzzy JSON (PA overrides,
    #                    per-tier steep, fuzzy misfires). EXPECTED correction, not a blocker.
    coverage_gap = defaultdict(list)
    relational_auth = defaultdict(list)
    for mkt, desc, key, a, b, used_fb in mismatches:
        (coverage_gap if used_fb else relational_auth)[key].append((mkt, a, b))

    if coverage_gap:
        print("\n   [DATA-GAP, parallel] COVERAGE GAP — relational lacks key, build already "
              "froze the hardcoded fallback in normal mode (pre-exists Ship 3); JSON had a real "
              "market price. Import these to relational (Alfonso/Ship 8) — does NOT block Ship 3:")
        for key, rows in sorted(coverage_gap.items(), key=lambda x: -len(x[1])):
            ex = rows[0]
            print(f"  {len(rows):>3}x  key={key:<28} hardcoded-fallback=${ex[2]} (JSON had ${ex[1]})  (e.g. {ex[0]})")

    if relational_auth:
        print("\n   [EXPECTED] RELATIONAL AUTHORITATIVE — Ship 3 correctly replaces stale/fuzzy "
              "JSON with the frozen relational price (PA overrides, per-tier steep, fuzzy fixes):")
        for key, rows in sorted(relational_auth.items(), key=lambda x: -len(x[1])):
            ex = rows[0]
            print(f"  {len(rows):>3}x  key={key:<28} JSON-fuzzy=${ex[1]} → relational=${ex[2]}  (e.g. {ex[0]})")
            if args.verbose:
                for mkt, a, b in rows:
                    print(f"           {mkt}: JSON=${a} REL=${b}")

    if b_fallback and args.verbose:
        print("\n  relational-missing keys falling back to hardcoded (non-slate):")
        seen = set()
        for mkt, desc, k, fb in b_fallback:
            if k in seen:
                continue
            seen.add(k)
            print(f"    {k} → ${fb} (e.g. {mkt})")

    if a_missing and args.verbose:
        print("\n  lookup_price misses (overlay leaves frozen price as-is) — sample:")
        for mkt, desc, key in a_missing[:15]:
            print(f"    {mkt}: '{desc[:50]}' (key {key})")

    n_gap = sum(len(v) for v in coverage_gap.values())
    n_auth = sum(len(v) for v in relational_auth.values())
    print(f"\nsummary: {len(coverage_gap)} coverage-gap keys ({n_gap} instances) | "
          f"{len(relational_auth)} relational-authoritative keys ({n_auth} instances)")
    print(
        "\nINTERPRETATION (these divergences are the REFRESH path — live via "
        "/api/reprocess?refresh_prices=true, processor.py:7867; normal reprocess SKIPS "
        "positively-priced lines so it is unaffected):\n"
        f"  • RELATIONAL-AUTHORITATIVE ({n_auth}): refresh currently CORRUPTS these — it "
        "overwrites the correct frozen relational price with a fuzzy/stale JSON value "
        "(PA overrides wiped, per-tier steep collapsed, wrong-item fuzzy hits). SHIP 3 FIXES "
        "these by re-pricing refresh from get_prices_for_market(market)[short_key].\n"
        f"  • COVERAGE-GAP ({n_gap}): relational lacks the key; build already froze the "
        "hardcoded fallback in NORMAL mode too, so this is a PRE-EXISTING relational data "
        "gap (NOT introduced by Ship 3). Import these keys to relational (Alfonso/Ship 8) "
        "in parallel; Ship 3 is not blocked on them.\n"
        "  • Ship 3 implementation note: lines do NOT store short_key today — stamp it in "
        "build_line_items (alongside _priced_market) so the refresh path can re-pull by key.")
    sys.exit(1 if (n_gap or n_auth) else 0)


if __name__ == "__main__":
    main()
