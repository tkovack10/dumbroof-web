#!/usr/bin/env python3
"""Regression gate for the Doc 03 per-category Variance Summary.

The per-category summary was previously DISABLED because the old rollup summed
comparison_rows' usarm_amount, which double-counted and did not decompose the
true total ("parts exceed the whole"). It is now sourced authoritatively
(carrier per-category = carrier_amount; our per-category = line_items) with an
O&P/tax reconciliation row, so the category rows must add up EXACTLY to the bold
TOTAL on BOTH columns. This test renders Doc 03 for every golden fixture and
asserts that reconciliation (and that no negative variance renders as "+-$").

Self-contained — NO pytest. Plain asserts + __main__.
    python3 backend/tests/test_variance_reconcile.py
"""
import os, sys, json, glob, copy, re

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)
import usarm_pdf_generator as G

CORPUS = os.path.join(_HERE, "golden_corpus")
_TMP = os.path.join(os.environ.get("TMPDIR", "/tmp"), "_variance_reconcile_test")


def _money(s):
    s = (s.replace("&minus;", "-").replace("$", "").replace(",", "")
          .replace("&mdash;", "0").replace("+", "").strip())
    return float(s or 0)


failures = []
checked = 0
os.makedirs(_TMP, exist_ok=True)

for fp in sorted(glob.glob(os.path.join(CORPUS, "*.json"))):
    fid = os.path.basename(fp)[:18]
    cfg = json.load(open(fp))
    cfg = cfg.get("config", cfg)
    cfg["_paths"] = {k: _TMP for k in ("claim_dir", "photos", "output", "source_docs")}
    html = open(G.build_supplement_report(copy.deepcopy(cfg))).read()

    # "+-$" must never render (sign bug on negative variance)
    if "+&minus;" in html or "+-$" in html:
        failures.append(f"{fid}: variance renders a double sign (+- )")

    m = re.search(r'Variance Summary.*?</table>', html, re.S)
    if not m:
        continue
    tbl = m.group(0)
    cat_c = cat_u = cat_v = 0.0
    n = 0
    for tr in re.findall(r'<tr(?![^>]*section-total)[^>]*>(.*?)</tr>', tbl, re.S):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)
        if len(tds) == 4:
            vals = [re.sub(r'<[^>]+>', '', t).strip() for t in tds[1:]]
            if any('$' in v for v in vals):
                cat_c += _money(vals[0]); cat_u += _money(vals[1]); cat_v += _money(vals[2]); n += 1
    if n == 0:
        continue  # 2-row RCV fallback (forensic-only / single-category) — reconciles trivially
    tot = re.search(r'section-total.*?</tr>', tbl, re.S).group(0)
    tv = [_money(re.sub(r'<[^>]+>', '', x))
          for x in re.findall(r'<td[^>]*class="num[^"]*"[^>]*>(.*?)</td>', tot, re.S)]
    checked += 1
    if abs(cat_c - tv[0]) >= 0.02:
        failures.append(f"{fid}: carrier categories Σ${cat_c:,.2f} != TOTAL ${tv[0]:,.2f}")
    if abs(cat_u - tv[1]) >= 0.02:
        failures.append(f"{fid}: our categories Σ${cat_u:,.2f} != TOTAL ${tv[1]:,.2f}")
    if abs(cat_v - tv[2]) >= 0.02:
        failures.append(f"{fid}: variance categories Σ${cat_v:,.2f} != TOTAL ${tv[2]:,.2f}")

print(f"Variance reconciliation: checked {checked} fixtures with a per-category summary")
if failures:
    for f in failures:
        print("  FAIL:", f)
    print(f"\n{len(failures)} FAILURE(S)")
    sys.exit(1)
print("ALL RECONCILE")
sys.exit(0)
