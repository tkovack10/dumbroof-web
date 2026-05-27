#!/usr/bin/env python3
"""Ship 8 (coverage-gap) — relational price coverage-gap importer (DRY-RUN by default).

PURPOSE
-------
Close the "relational missing key -> hardcoded NY-baseline fallback" cases that
de-risk Ship 3 (the generator overlay cutover). For a fixed set of short_keys
that `build_line_items` prices via `_priced(PRICING, "<short_key>", <fallback>)`,
this tool:

  1. confirms whether each short_key has a row in the `pricing_line_items` catalog
     (and prints the exact new-row payload if it does not);
  2. enumerates, per target key, the markets that LACK the key in
     `pricing_market_prices` (relational), vs already have it;
  3. for each (key, missing-market), derives the canonical Xactimate value from
     that market's `all-markets.json` `allItems` using (cleaned_desc, action)
     matching (the same canon used by xactimate_lookup.XactRegistry) — NEVER
     inventing a value, NEVER collapsing remove/install;
  4. runs the ingestion-firewall logic (validate_market_prices) against every
     proposed (market, key, value): physical floor/ceiling for gutters, plus the
     directional ">50% BELOW national median = below floor of physical
     possibility" outlier rule. A FAIL is never imported.
  5. prints a dry-run table and, ONLY with --commit, performs the upserts.

HARD SAFETY
-----------
  * Default mode is DRY-RUN. It performs ZERO writes. You must pass --commit to
    write, and --commit is intentionally NOT the default.
  * A proposed value with no source entry in all-markets.json is reported
    "no source value -> SKIP" and never written (no NY-baseline invention).
  * A proposed value that FAILS the firewall is reported and never written.
  * Upserts (when committed) conflict on the (market_id, line_item_id) PK and
    stamp source_batch + a provenance source_note.

Usage:
    python3 scripts/import_coverage_gap.py                  # DRY RUN (default) — no writes
    python3 scripts/import_coverage_gap.py --keys ridge_vent,chimney_flashing_ea
    python3 scripts/import_coverage_gap.py --json out.json   # also dump machine-readable artifact
    python3 scripts/import_coverage_gap.py --commit          # WRITES (do NOT run against prod casually)

Findings as of 2026-05-28 (the reason this batch imports nothing):
    * laminated_high_install / chimney_flashing_ea — ALREADY priced in all 160
      relational markets (parity-clean vs source). No gap. No-op.
    * ridge_vent — RFG RGVC is null-priced in every market (requires Xactimate
      Desktop). No importable source value. Needs a catalog row created first,
      but cannot be priced from current sources.
    * gutter_copper_half_round — no "half round copper up-to-5\"" item exists in
      Xactimate exports (only the 6\" variant -> already its own key
      gutter_half_round_copper_6). No direct source value. AMBIGUOUS — do not
      invent; see PR body.
This script is therefore committed primarily so that the moment a real source
value lands (e.g. Verisk RGVC extraction), the import is a one-flag run with the
firewall already wired in.
"""
from __future__ import annotations
import argparse, json, os, statistics, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
sys.path.insert(0, BACKEND)

ALL_MARKETS_PATH = os.path.join(BACKEND, "pricing", "all-markets.json")

SOURCE_BATCH = "coverage_gap_2026_05_28"

# ---------------------------------------------------------------------------
# Target keys. Each entry mirrors EXACTLY what build_line_items emits:
#   short_key      -> the _priced(PRICING, "<short_key>", ...) key
#   canonical_desc -> the all-markets.json Xactimate description to match against
#                     (NOT the human-readable build-emitted description, which for
#                     ridge_vent / gutter_copper_half_round is a USARM-internal
#                     string that does not exist in any Xactimate export).
#   unit / category / fallback -> from the build_line_items line + catalog
#   needs_catalog_row -> True if there is no pricing_line_items row for the key
# ---------------------------------------------------------------------------
TARGETS = {
    "laminated_high_install": {
        "canonical_desc": "Laminated - High grd - comp. shingle rfg. - w/out felt",
        "unit": "SQ", "category": "ROOFING", "fallback": 383.17,
        "xact_code": None, "needs_catalog_row": False,
    },
    "chimney_flashing_ea": {
        "canonical_desc": 'R&R Chimney flashing - average (32" x 36")',
        "unit": "EA", "category": "ROOFING", "fallback": 643.86,
        "xact_code": None, "needs_catalog_row": False,
    },
    # NO importable source: RFG RGVC is null-priced in every market (Xact Desktop only).
    # canonical_desc is the source-match string (code-keyed via items["RFG RGVC"]);
    # catalog_desc is the human-readable description build_line_items emits.
    "ridge_vent": {
        "canonical_desc": "Continuous ridge vent R&R",  # RFG RGVC — price=None everywhere
        "catalog_desc": "R&R Ridge vent - shingle over",
        "unit": "LF", "category": "ROOFING", "fallback": 8.50,
        "xact_code": "RFG RGVC", "needs_catalog_row": True,
    },
    # AMBIGUOUS: only the 6" half-round copper exists in exports (-> gutter_half_round_copper_6).
    # No "half round copper up-to-5\"" line exists. Do not invent; reported, not imported.
    "gutter_copper_half_round": {
        "canonical_desc": "R&R Gutter / downspout - half round - copper - up to 5\"",
        "catalog_desc": "R&R Copper half round gutter & downspout",
        "unit": "LF", "category": "GUTTERS", "fallback": 55.00,
        "xact_code": None, "needs_catalog_row": True,
    },
}

# Firewall constants (mirrors backend/validate_market_prices.py)
GUTTER_KSTYLE_AL = "gutter_aluminum"
GUTTER_KSTYLE_CU = "gutter_copper"
GUTTER_CEILING = 25.00
COPPER_FLOOR = 5.00
OUTLIER_PCT = 0.50  # >50% below national median = below floor of physical possibility


def _get_sb():
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        envp = os.path.join(BACKEND, ".env")
        if os.path.exists(envp):
            for line in open(envp):
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
    return create_client(url, key)


def _load_all_markets():
    with open(ALL_MARKETS_PATH) as f:
        return json.load(f)["markets"]


def _source_value(market, canonical_desc, xact_code=None):
    """Return the canonical source value for (market, key) from all-markets.json.

    Matches by (cleaned_desc, action) — the same canon as XactRegistry — so
    remove/install never collapse. If xact_code is set, also accepts a code hit
    in the `items` dict (code-keyed entries). Returns None when no source entry
    exists OR the source entry's price is null (e.g. RFG RGVC -> Xact Desktop).
    """
    from xactimate_lookup import _clean_desc, XactRegistry
    canon_clean = _clean_desc(canonical_desc)
    canon_action = XactRegistry._infer_action(canonical_desc)

    # 1) allItems list (canonical Xactimate-sourced values)
    for it in (market.get("allItems") or []):
        desc = it.get("description", "") or ""
        if _clean_desc(desc) == canon_clean and XactRegistry._infer_action(desc) == canon_action:
            return it.get("price")  # may be None

    # 2) code-keyed items dict (e.g. RFG RGVC), if a code is provided
    if xact_code:
        items = market.get("items") or {}
        if isinstance(items, dict):
            entry = items.get(xact_code)
            if entry:
                return entry.get("price")  # may be None
    return None


def _fetch_relational(sb, short_keys):
    """Return (markets:list, catalog:{short_key: row}, coverage:{short_key: set(market_id)})."""
    markets = [m["market_id"] for m in
               sb.table("pricing_markets").select("market_id,status").execute().data]
    cat_rows = (sb.table("pricing_line_items")
                .select("line_item_id,short_key,description,unit,category,status,is_national_rate")
                .in_("short_key", list(short_keys)).execute().data)
    catalog = {r["short_key"]: r for r in cat_rows}

    coverage = defaultdict(set)
    lid_to_key = {r["line_item_id"]: r["short_key"] for r in cat_rows}
    if lid_to_key:
        start = 0
        while True:
            chunk = (sb.table("pricing_market_prices")
                     .select("market_id,line_item_id")
                     .in_("line_item_id", list(lid_to_key.keys()))
                     .range(start, start + 999).execute().data)
            if not chunk:
                break
            for r in chunk:
                coverage[lid_to_key[r["line_item_id"]]].add(r["market_id"])
            if len(chunk) < 1000:
                break
            start += 1000
    return markets, catalog, coverage


def _national_medians(sb):
    """short_key -> median across active markets (firewall reference)."""
    cat = {r["line_item_id"]: r for r in sb.table("pricing_line_items")
           .select("line_item_id,short_key,status").execute().data}
    active = {m["market_id"] for m in sb.table("pricing_markets")
              .select("market_id,status").execute().data if m["status"] == "active"}
    by_key = defaultdict(list)
    start = 0
    while True:
        chunk = (sb.table("pricing_market_prices").select("market_id,line_item_id,unit_price")
                 .range(start, start + 999).execute().data)
        if not chunk:
            break
        for r in chunk:
            c = cat.get(r["line_item_id"])
            if c and c["status"] == "active" and r["market_id"] in active:
                by_key[c["short_key"]].append(float(r["unit_price"]))
        if len(chunk) < 1000:
            break
        start += 1000
    return {k: statistics.median(v) for k, v in by_key.items() if v}


def _firewall_check(short_key, value, medians, market_prices):
    """Return (ok:bool, reason:str). market_prices = {short_key: price} for that market."""
    if value is None:
        return False, "no source value"
    if value <= 0:
        return False, f"non-positive value {value}"
    # gutter physical bounds
    if short_key == GUTTER_KSTYLE_AL and value > GUTTER_CEILING:
        return False, f"${value:.2f}/LF > ${GUTTER_CEILING:.0f} k-style aluminum ceiling"
    if short_key == GUTTER_KSTYLE_CU and value < COPPER_FLOOR:
        return False, f"${value:.2f}/LF < ${COPPER_FLOOR:.0f} copper floor"
    # directional outlier vs national median
    med = medians.get(short_key)
    if med and (value - med) / med < -OUTLIER_PCT:
        return False, f"${value:.2f} vs median ${med:.2f} ({(value-med)/med*100:+.0f}% UNDER floor)"
    return True, "pass"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", default=",".join(TARGETS.keys()),
                    help="comma-separated short_keys to process (default: all 4 targets)")
    ap.add_argument("--commit", action="store_true",
                    help="WRITE the upserts (default: dry-run, no writes)")
    ap.add_argument("--json", help="also dump machine-readable artifact to this path")
    args = ap.parse_args()

    keys = [k.strip() for k in args.keys.split(",") if k.strip()]
    for k in keys:
        if k not in TARGETS:
            print(f"FATAL: unknown key {k!r}; known: {list(TARGETS)}", file=sys.stderr)
            sys.exit(2)

    sb = _get_sb()
    all_markets = _load_all_markets()
    rel_markets, catalog, coverage = _fetch_relational(sb, keys)
    medians = _national_medians(sb)

    # Build a per-market price view (firewall needs sibling gutter prices). We only
    # need the small set of firewall-relevant keys per market for the bound checks,
    # but pulling the full market view keeps it correct and simple.
    from pricing_db import get_prices_for_market

    artifact = {"source_batch": SOURCE_BATCH, "keys": {}, "new_catalog_rows": []}
    upserts = []  # (market_id, line_item_id, value, short_key)

    print(f"\n=== Ship 8 coverage-gap DRY-RUN  (batch={SOURCE_BATCH}) ===")
    print(f"relational markets: {len(rel_markets)} | national medians for {len(medians)} keys\n")

    for sk in keys:
        spec = TARGETS[sk]
        cat = catalog.get(sk)
        has_catalog = cat is not None
        have = coverage.get(sk, set())
        missing = [m for m in rel_markets if m not in have]

        print(f"--- {sk} ---")
        print(f"    catalog row: {'YES (' + cat['line_item_id'] + ')' if has_catalog else 'NO — needs new catalog row'}")
        print(f"    relational coverage: {len(have)}/{len(rel_markets)} markets | missing: {len(missing)}")

        key_rows = []
        if not has_catalog:
            new_row = {
                "short_key": sk,
                "xact_code": spec.get("xact_code"),
                "description": spec.get("catalog_desc", spec["canonical_desc"]),
                "unit": spec["unit"],
                "category": spec["category"],
                "is_national_rate": False,
                "is_mandatory": False,
                "status": "active",
            }
            artifact["new_catalog_rows"].append(new_row)
            print(f"    NEW CATALOG ROW REQUIRED: {json.dumps(new_row)}")
            line_item_id = None  # cannot upsert prices until the catalog row exists
        else:
            line_item_id = cat["line_item_id"]

        # derive + firewall every missing market
        n_pass = n_fail = n_nosrc = 0
        for mid in missing:
            mkt = all_markets.get(mid)
            if mkt is None:
                # relational market not present in all-markets.json (rare); no source
                key_rows.append({"market": mid, "value": None, "firewall": "fail",
                                 "reason": "market not in all-markets.json"})
                n_nosrc += 1
                continue
            val = _source_value(mkt, spec["canonical_desc"], spec.get("xact_code"))
            if val is None:
                key_rows.append({"market": mid, "value": None, "firewall": "skip",
                                 "reason": "no source value"})
                n_nosrc += 1
                continue
            mp = get_prices_for_market(mid)
            ok, reason = _firewall_check(sk, float(val), medians, mp)
            key_rows.append({"market": mid, "value": round(float(val), 2),
                             "firewall": "pass" if ok else "fail", "reason": reason})
            if ok:
                n_pass += 1
                if line_item_id:
                    upserts.append((mid, line_item_id, round(float(val), 2), sk))
            else:
                n_fail += 1

        artifact["keys"][sk] = {
            "has_catalog_row": has_catalog,
            "coverage": len(have), "total": len(rel_markets), "missing": len(missing),
            "proposed_pass": n_pass, "proposed_fail": n_fail, "no_source": n_nosrc,
            "rows": key_rows,
        }
        print(f"    proposed: {n_pass} pass / {n_fail} firewall-fail / {n_nosrc} no-source-skip")
        # show a couple sample rows
        for r in key_rows[:3]:
            print(f"        {r['market']}: {r['value']} [{r['firewall']}] {r['reason']}")
        if len(key_rows) > 3:
            print(f"        ... ({len(key_rows)-3} more)")
        print()

    print(f"=== TOTAL importable rows (catalog-row-present AND firewall-pass): {len(upserts)} ===")

    if args.json:
        with open(args.json, "w") as f:
            json.dump(artifact, f, indent=2)
        print(f"artifact written -> {args.json}")

    if not args.commit:
        print("\n(DRY RUN — no writes. Pass --commit to upsert. New catalog rows must be "
              "created first for any key flagged 'needs new catalog row'.)")
        return

    # ---- COMMIT PATH (intentionally guarded; not run in this Ship-8 prep) ----
    if not upserts:
        print("\nCOMMIT: nothing to write (0 importable rows). No-op.")
        return
    payload = [{
        "market_id": mid, "line_item_id": lid, "unit_price": val,
        "source_batch": SOURCE_BATCH,
        "source_note": f"coverage-gap import: {sk} from all-markets.json allItems "
                       f"(cleaned_desc,action) canonical match; firewall-passed vs national median",
    } for (mid, lid, val, sk) in upserts]
    # PK is (market_id, line_item_id) -> on_conflict upsert
    sb.table("pricing_market_prices").upsert(payload, on_conflict="market_id,line_item_id").execute()
    print(f"\nCOMMIT: upserted {len(payload)} rows with source_batch={SOURCE_BATCH}")


if __name__ == "__main__":
    main()
