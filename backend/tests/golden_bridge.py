"""GOLDEN BRIDGE — render N real claims through the generator and capture a
SUBSTANCE FINGERPRINT (every $ amount, code citation, date, measurement + the
section set) per claim. The design may change; the fingerprint must NOT.

  python3 tests/golden_bridge.py baseline   # capture (run on the OLD gen)
  python3 tests/golden_bridge.py compare     # render again + diff vs baseline (NEW gen)
"""
import sys, os, glob, json, re, copy, tempfile
import datetime as _dtmod
_HERE = os.path.dirname(os.path.abspath(__file__)); _BACK = os.path.dirname(_HERE)
sys.path.insert(0, _BACK); sys.path.insert(0, _HERE)
import test_golden_forensic_corpus as gc   # reuse the frozen-clock render harness
import usarm_pdf_generator as G

CLAIMS = "/Users/thomaskovackjr/USARM-Claims-Platform/claims"
BASELINE = os.path.join(_HERE, "golden_bridge_baseline.json")

def configs(limit=50):
    out = []
    for fp in sorted(glob.glob(os.path.join(_HERE, "golden_corpus", "*.json"))):
        d = json.load(open(fp)); out.append((os.path.basename(fp)[:18], d.get("config", d)))
    for fp in sorted(glob.glob(os.path.join(CLAIMS, "*", "claim_config.json"))):
        try: d = json.load(open(fp))
        except Exception: continue
        cfg = d.get("config", d)
        if isinstance(cfg, dict) and (cfg.get("property") or cfg.get("insured") or cfg.get("structures")):
            out.append(("claim:" + os.path.basename(os.path.dirname(fp))[:24], cfg))
    return out[:limit]

_TAG = re.compile(r"<[^>]+>"); _WS = re.compile(r"\s+")
def fingerprint(html):
    txt = _WS.sub(" ", _TAG.sub(" ", html))
    return {
        "dollars": sorted(re.findall(r"\$[\d,]+\.\d{2}", txt)),
        "codes": sorted(set(re.findall(r"\b(?:IRC|RCNYS|ASTM|RFG)\s*[RD]?\d[\d.]*[A-Z0-9.]*", txt))),
        "measures": sorted(set(re.findall(r"\d+(?:\.\d+)?\s*(?:SQ|LF|SF|sq ft|ft|\"|inch|mph|/12)", txt))),
        "sections": sorted(set(re.findall(r"(?:\d+\.\s+)?[A-Z][A-Za-z &/]+(?=\s*(?:Analysis|Summary|Report|Information|Overview|Requirements|Recommendations))", txt)))[:40],
        "len": len(txt),
    }

def render(cfg):
    c = copy.deepcopy(cfg); tp = tempfile.mkdtemp(); to = tempfile.mkdtemp()
    c["_paths"] = {"claim_dir": to, "photos": tp, "output": to, "source_docs": to}
    o = _dtmod.datetime
    try:
        _dtmod.datetime = gc._FrozenDateTime
        return open(G.build_forensic_report(c), encoding="utf-8").read()
    finally: _dtmod.datetime = o

def run():
    mode = sys.argv[1] if len(sys.argv) > 1 else "baseline"
    cfgs = configs(50); fps = {}; errors = {}
    for cid, cfg in cfgs:
        try: fps[cid] = fingerprint(render(cfg))
        except Exception as e: errors[cid] = f"{type(e).__name__}: {e}"[:120]
    print(f"Rendered {len(fps)}/{len(cfgs)} claims ({len(errors)} render errors).")
    for cid, e in errors.items(): print(f"  RENDER-ERR {cid}: {e}")
    if mode == "baseline":
        json.dump({"fps": fps, "errors": list(errors)}, open(BASELINE, "w"), indent=0)
        print(f"\nBASELINE saved: {len(fps)} substance fingerprints -> {os.path.basename(BASELINE)}")
        return
    # compare
    base = json.load(open(BASELINE)); bfp = base["fps"]
    regress = []; new_err = [c for c in errors if c not in base["errors"]]
    for cid, fp in fps.items():
        if cid not in bfp: continue
        diffs = {k: (bfp[cid].get(k), fp.get(k)) for k in ("dollars","codes","measures") if bfp[cid].get(k) != fp.get(k)}
        if diffs: regress.append((cid, diffs))
    print(f"\n==== GOLDEN BRIDGE COMPARE (substance: dollars/codes/measures) ====")
    print(f"claims checked: {len(fps)} | NEW render errors: {len(new_err)} | content regressions: {len(regress)}")
    for cid in new_err: print(f"  ⛔ NEW RENDER ERROR: {cid}")
    for cid, d in regress[:20]:
        print(f"  ⛔ CONTENT CHANGED {cid}:")
        for k,(o,n) in d.items():
            od=set(o or []); nd=set(n or [])
            print(f"      {k}: lost {sorted(od-nd)[:5]} | gained {sorted(nd-od)[:5]}")
    if not regress and not new_err:
        print("  ✅ NON-REGRESSION CONFIRMED — every claim's dollars, codes & measures are byte-identical. Design changed, substance did not.")

run()
