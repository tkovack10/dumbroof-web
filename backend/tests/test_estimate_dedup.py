#!/usr/bin/env python3
"""Regression gate for two MVP-facing estimate bugs:

  1. Doc 02 line-item DUPLICATION — build_multi_structure_line_items re-emitted a
     structure's shared components (I&W / drip / ridge / flashing / vents) once per
     material sub-group, tripling cost (I&W counted 3x = +$30.8K on one claim).
     Fixed by a structure+qty+scope_timing-aware exact-duplicate collapse, applied
     both at process time and as a render-time safety net (existing stored claims).
  2. Doc 03 'Keystone' name LEAK — generic engineer liability-disclaimer boilerplate
     in carrier_arguments surfaced a bare third-party firm name under the carrier
     approval header. Fixed by stripping disclaimer boilerplate (keeping substance).

Self-contained — NO pytest. Plain asserts + __main__.
    python3 backend/tests/test_estimate_dedup.py
"""
import os, sys, json, glob, copy

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)
import usarm_pdf_generator as G

CORPUS = os.path.join(_HERE, "golden_corpus")
_TMP = os.path.join(os.environ.get("TMPDIR", "/tmp"), "_estimate_dedup_test")


def _load(prefix):
    fp = [f for f in glob.glob(os.path.join(CORPUS, prefix + "*.json"))
          if "str-measurements" not in f][0]
    cfg = json.load(open(fp))
    return cfg.get("config", cfg)


def _initial_total(items):
    return round(sum(round(it["qty"] * it["unit_price"], 2) for it in items
                     if (it.get("scope_timing") or "initial") == "initial" and it.get("qty")), 2)


failures = []
def check(cond, msg):
    print(("  ok:  " if cond else "  FAIL:") + " " + msg)
    if not cond:
        failures.append(msg)


# 1. TRUE-duplicate fixtures collapse to the adversarially-validated counts.
print("[1] true-duplicate collapse (only mixed-material/commercial claims)")
for pref, n_before, n_after in [("19d87f1b", 62, 34), ("cead2924", 31, 24)]:
    raw = _load(pref).get("line_items") or []
    ded = G._dedup_exact_line_items(copy.deepcopy(raw))
    check(len(raw) == n_before, f"{pref}: {len(raw)} raw rows == {n_before}")
    check(len(ded) == n_after, f"{pref}: {len(ded)} deduped rows == {n_after}")
    check(_initial_total(ded) < _initial_total(raw),
          f"{pref}: deduped total ${_initial_total(ded):,.2f} < raw ${_initial_total(raw):,.2f}")
raw = _load("19d87f1b").get("line_items") or []
ded = G._dedup_exact_line_items(copy.deepcopy(raw))
iw = [it for it in ded if it.get("description", "").startswith("Ice & water barrier")]
check(len(iw) == 1, f"19d87f1b: Ice & water barrier appears exactly once after dedup (got {len(iw)})")

# 2. Legit 'duplicate-looking' per-structure fixtures + clean controls are UNTOUCHED.
print("[2] legit per-structure rows + clean claims preserved (no over-dedup)")
for pref in ["14c5015e", "adeffaa8", "f3a7b5d3", "08052909", "2187b03f"]:
    raw = _load(pref).get("line_items") or []
    ded = G._dedup_exact_line_items(copy.deepcopy(raw))
    check(len(ded) == len(raw), f"{pref}: dedup is a no-op ({len(raw)} rows)")

# 3. Key correctness: different qty / structure / scope_timing must all survive.
print("[3] dedup key preserves legit distinctions")
base = {"description": "R&R Drip edge - aluminum", "unit": "LF", "code": "", "category": "ROOFING"}
items = [
    {**base, "qty": 100}, {**base, "qty": 100},                       # true dup -> collapses to 1
    {**base, "qty": 200},                                            # different qty -> kept
    {**base, "qty": 100, "structure": "Detached"},                   # different structure -> kept
    {**base, "qty": 100, "scope_timing": "install_supplement"},      # different timing -> kept
]
ded = G._dedup_exact_line_items(items)
check(len(ded) == 4, f"key keeps qty/structure/scope_timing distinctions (got {len(ded)}/4)")

# 4. Doc 03 carrier-args boilerplate strip — leak gone, substance kept.
print("[4] Doc 03 carrier-args boilerplate strip (Keystone leak)")
os.makedirs(_TMP, exist_ok=True)
cfg = _load("19d87f1b")
cfg["_paths"] = {k: _TMP for k in ("claim_dir", "photos", "output", "source_docs")}
html = open(G.build_supplement_report(copy.deepcopy(cfg))).read()
check("Keystone" not in html, "Doc 03: no bare 'Keystone' firm-name leak")
check("assumes no liability" not in html, "Doc 03: no liability-disclaimer boilerplate")
check("depreciated at" in html.lower() or "depreciation" in html.lower(),
      "Doc 03: substantive carrier depreciation facts preserved")

if failures:
    print(f"\n{len(failures)} FAILURE(S)")
    sys.exit(1)
print("\nALL PASS")
sys.exit(0)
