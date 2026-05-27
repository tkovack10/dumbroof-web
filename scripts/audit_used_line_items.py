#!/usr/bin/env python3
"""Mark pricing_line_items USARM has never claimed against as status='inactive'.

Unblocks Ship 2 without a Verisk extraction: the firewall (Ship 1.3) only watches
ACTIVE items, so once unused specialty items (wood shake/cedar/shutters install) are
inactive, the 40 French-batch markets flip pending->active. Items stay in the catalog
for historical reads; future claims that DO use them will block (no active price)
rather than ship the corrupt value — correct behavior.

USED set = distinct descriptions across all claim_config.line_items (the USARM-
generated estimate set), matched to short_keys via the SAME (cleaned, action)
canonical path as the importer (a0aee36) — NOT cleaned-desc alone (E253). Anything
active + non-national + not in USED is marked inactive.

Lifecycle: draft (in catalog, prices unvalidated, firewall ignores) -> active
(production, firewall watches) -> inactive (unused, kept for history, firewall ignores).

Usage:
    python3 scripts/audit_used_line_items.py            # report only
    python3 scripts/audit_used_line_items.py --commit    # mark unused -> inactive
"""
from __future__ import annotations
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
sys.path.insert(0, BACKEND)
from xactimate_lookup import _clean_desc, XactRegistry  # noqa: E402
from processor import _DESC_TO_PRICING_KEY              # noqa: E402

USED_DESCS_FILE = "/tmp/used_descs.json"  # distinct claim_config.line_items descriptions

def _slug(cleaned: str, action: str = "") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", cleaned.lower()).strip("_")
    base = ("gen_" + s)[:52]
    act = re.sub(r"[^a-z0-9]+", "", (action or "").lower())
    return f"{base}_{act}" if act else base

def used_short_keys():
    canon = {}
    for desc, key in _DESC_TO_PRICING_KEY.items():
        canon[(_clean_desc(desc), XactRegistry._infer_action(desc))] = key
    used = set()
    for d in json.load(open(USED_DESCS_FILE)):
        d = (d or "").strip()
        if not d:
            continue
        cleaned = _clean_desc(d)
        action = XactRegistry._infer_action(d)
        used.add(canon.get((cleaned, action)) or _slug(cleaned, action))
    return used

def _load_env():
    env = {}
    p = os.path.join(BACKEND, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return (os.environ.get("SUPABASE_URL") or env.get("SUPABASE_URL"),
            os.environ.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_SERVICE_KEY"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    from supabase import create_client
    url, key = _load_env()
    sb = create_client(url, key)

    used = used_short_keys()
    catalog = sb.table("pricing_line_items").select(
        "short_key,description,status,is_national_rate").execute().data

    unused = [c for c in catalog
              if c["status"] == "active" and not c["is_national_rate"]
              and c["short_key"] not in used]
    kept_used = [c for c in catalog if c["short_key"] in used]

    print(f"\n=== USED line-item audit ===")
    print(f"USED short_keys (claimed against, ever): {len(used)} distinct descs -> {len(kept_used)} catalog matches")
    print(f"catalog total: {len(catalog)}  | national: {sum(1 for c in catalog if c['is_national_rate'])}")
    print(f"UNUSED active items -> mark inactive: {len(unused)}\n")

    # Confirm the firewall-flagged specialty items are in the unused set
    flagged = ["wood_shake_heavy_install", "wood_shake_heavy_remove",
               "cedar_shake_install", "cedar_shake_remove", "shutters_aluminum"]
    unused_keys = {c["short_key"] for c in unused}
    print("firewall-flagged specialty items:")
    for f in flagged:
        in_cat = any(c["short_key"] == f for c in catalog)
        print(f"  {f}: {'UNUSED✓' if f in unused_keys else ('USED — KEEP ACTIVE' if f in used else ('not in catalog' if not in_cat else 'national/other'))}")

    print(f"\nUNUSED items to deactivate ({len(unused)}):")
    for c in sorted(unused, key=lambda x: x["short_key"]):
        print(f"  {c['short_key']:<42} {c['description'][:50]}")

    if not args.commit:
        print("\n(report only — pass --commit to set these to status='inactive')")
        return

    # GUARDRAIL: never deactivate a used item.
    to_deactivate = [c["short_key"] for c in unused if c["short_key"] not in used]
    B = 100
    for i in range(0, len(to_deactivate), B):
        sb.table("pricing_line_items").update({"status": "inactive"}).in_(
            "short_key", to_deactivate[i:i+B]).execute()
    print(f"\nCOMMIT: marked {len(to_deactivate)} items status='inactive'.")

if __name__ == "__main__":
    main()
