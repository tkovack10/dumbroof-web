"""Per-claim carrier scope analysis — runs inline after scope extraction.

Detects underpayment tactics, recommends supplement arguments, and writes
findings to claims.carrier_analyst_flags. The weekly aggregate cron in
Vercel reads these flags to identify cross-portfolio patterns.

Plan: ~/.claude/plans/proud-wiggling-hearth.md Phase 2b
"""

from __future__ import annotations

from model_config import MODEL  # unified model knob (see model_config.py)

import json
import re
from typing import Optional

from date_utils import format_date_human


def analyze_carrier_scope(
    carrier_data: dict,
    measurements: dict,
    carrier_name: str,
    config: dict,
    claude_client,
    call_claude_fn=None,
) -> dict:
    """Analyze a carrier scope for underpayment tactics.

    Returns a dict with detected tactics, recommended arguments, and
    severity scores. Written to claims.carrier_analyst_flags by processor.py.
    """
    if not carrier_data:
        return {"analyzed": False, "reason": "no carrier data"}

    carrier_rcv = carrier_data.get("carrier_rcv", 0)
    carrier_items = carrier_data.get("carrier_line_items") or carrier_data.get("line_items") or []

    if not carrier_items and carrier_rcv == 0:
        return {"analyzed": False, "reason": "empty carrier scope"}

    ground_truth = _build_ground_truth(measurements, config, carrier_name, carrier_rcv, carrier_items)
    prompt = _build_analysis_prompt(ground_truth)

    try:
        if call_claude_fn:
            response = call_claude_fn(
                claude_client,
                _step_name="carrier_analyst",
                model=MODEL,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
        else:
            response = claude_client.messages.create(
                model=MODEL,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
        raw = response.content[0].text
    except Exception as e:
        return {"analyzed": False, "reason": f"api error: {str(e)[:200]}"}

    parsed = _parse_response(raw)
    _apply_area_sanity_guard(parsed, ground_truth)  # E273: catch phantom additive-area findings
    parsed["analyzed"] = True
    parsed["carrier_name"] = carrier_name
    parsed["carrier_rcv"] = carrier_rcv
    return parsed


def _build_ground_truth(measurements: dict, config: dict, carrier_name: str, carrier_rcv: float, carrier_items: list) -> dict:
    m = measurements or {}
    _inner = m.get("measurements", {}) or {}
    _structs = [s for s in (m.get("structures") or []) if isinstance(s, dict)]
    # Roof area in SF. The normal EagleView extraction writes top-level
    # total_roof_area_sf/_sq (processor.py:1560); the carrier-reconstruction
    # fallback writes NO top-level total — only structures[0].roof_area_sf
    # (processor.py:4993). The OLD read used m.get("total_area_sq") (squares!)
    # mislabeled as SF and missed BOTH → roof area resolved to 0, which is WHY
    # the model had no denominator and summed line items (E273). Read canonical
    # first, then the per-structure sum (covers the fallback + multi-structure).
    total_area = (
        m.get("total_roof_area_sf")
        or (m.get("total_roof_area_sq") or 0) * 100
        or sum(s.get("roof_area_sf", 0) for s in _structs)
        or sum(s.get("roof_area_sq", 0) for s in _structs) * 100
        or m.get("total_area_sf")
        or (m.get("total_area_sq") or 0) * 100
    )
    # Linear measurements are nested under measurements["measurements"] with
    # bare keys (eave/valley/ridge/rake), not *_lf at the top level.
    eave_lf = _inner.get("eave", 0) or m.get("eave_lf", 0)
    valley_lf = _inner.get("valley", 0) or m.get("valley_lf", 0)
    ridge_lf = _inner.get("ridge", 0) or m.get("ridge_lf", 0)
    rake_lf = _inner.get("rake", 0) or m.get("rake_lf", 0)

    trades = set()
    for li in config.get("line_items", []):
        t = (li.get("trade") or "").strip().lower()
        if t:
            trades.add(t)

    our_items_summary = []
    for li in (config.get("line_items") or [])[:30]:
        our_items_summary.append({
            "item": li.get("item", ""),
            "qty": li.get("qty", 0),
            "unit": li.get("unit", ""),
            "trade": li.get("trade", ""),
        })

    carrier_items_summary = []
    for ci in carrier_items[:30]:
        carrier_items_summary.append({
            "item": ci.get("item") or ci.get("description", ""),
            "qty": ci.get("qty") or ci.get("quantity", 0),
            "unit": ci.get("unit", ""),
        })

    return {
        "carrier_name": carrier_name,
        "carrier_rcv": carrier_rcv,
        "total_roof_area_sf": total_area,
        # E273: roof area ALSO in squares so the model compares apples-to-apples
        # against the SQ-unit line items (it was summing SQ items vs an SF roof).
        "total_roof_area_sq": round((total_area or 0) / 100.0, 2),
        "eave_lf": eave_lf,
        "valley_lf": valley_lf,
        "ridge_lf": ridge_lf,
        "rake_lf": rake_lf,
        "trade_count": len(trades),
        "trades": list(trades),
        "our_line_items": our_items_summary,
        "carrier_line_items": carrier_items_summary,
        "state": config.get("property", {}).get("state", ""),
    }


def _build_analysis_prompt(gt: dict) -> str:
    gt_json = json.dumps(gt, indent=2)
    roof_sq = gt.get("total_roof_area_sq", 0)
    return f"""You are the DumbRoof Carrier Intelligence Analyst. Analyze this carrier scope for underpayment tactics.

GROUND TRUTH (our measurements + scope):
```json
{gt_json}
```

CRITICAL — the roof is a SINGLE surface of {roof_sq} squares (total_roof_area_sf ÷ 100). Tear-off/removal, new shingles, underlayment/felt, and ice & water barrier ALL cover that SAME roof — their quantities are NOT additive. NEVER sum line-item quantities to claim a larger scope (17.43 SQ tear-off + 19.52 SQ shingle + 6.29 SQ felt is NOT 43 SQ of roof — it is one ~17.4 SQ roof). Measure any roofing-AREA underpayment against total_roof_area_sq ONLY; a carrier roof area at or above total_roof_area_sq is NOT an area underscope. (Underpayment can still exist via pricing, omitted accessory items, O&P, grade, etc. — just not phantom roof area.)

Identify EVERY underpayment tactic present. Common patterns:
1. Partial elevation siding (1-2 of 4 walls)
2. 0% O&P when trade_count >= 3 (should be 21%)
3. Missing starter at rakes (eave-only)
4. No I&W (ice & water barrier) — should be (eave_lf×6 + valley_lf×3) SF
5. No house wrap / WRB under siding
6. Spot repair instead of full replacement
7. ITEL/Cotality pricing instead of Xactimate
8. Unit mismatches (LF vs SQ)
9. Missing drip edge, step flashing, counter flashing
10. Inadequate waste factor (<10%)
11. Missing steep/high charges for pitch >7/12
12. Desk review denial (no field inspection)

For each tactic found, recommend the strongest counter-argument with building code citations if applicable. Use the state-appropriate code prefix (RCNYS for NY, RCO for OH, UCC for PA, NJUCC for NJ, CRC for CA, FBC-R for FL, etc. — generic IRC for states without a state-adopted residential code).

Return ONLY this JSON:
```json
{{
  "tactics_found": [
    {{
      "tactic": "short name",
      "severity": "high|medium|low",
      "detail": "what specifically is wrong",
      "counter_argument": "recommended response with code citation",
      "dollar_impact_estimate": 0
    }}
  ],
  "supplement_priority": ["highest impact item first", "..."],
  "overall_assessment": "one sentence",
  "estimated_variance_pct": 0
}}
```"""


def _parse_response(raw: str) -> dict:
    if not raw:
        return {"tactics_found": [], "overall_assessment": "Analysis unavailable"}
    text = raw.strip()
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            clean = part.strip()
            if clean.startswith("json"):
                clean = clean[4:].strip()
            if clean.startswith("{"):
                text = clean
                break
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return {"tactics_found": [], "overall_assessment": "Parse failed"}
    try:
        parsed = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {"tactics_found": [], "overall_assessment": "JSON parse failed"}
    parsed.setdefault("tactics_found", [])
    parsed.setdefault("supplement_priority", [])
    parsed.setdefault("overall_assessment", "")
    parsed.setdefault("estimated_variance_pct", 0)
    return parsed


def _implausible_area(text: str, roof_sq: float, roof_sf: float):
    """Return (value, unit, limit) for the first roofing area in `text` that
    exceeds ~1.3x the measured roof (waste/overlap tolerance), else None.
    Scans BOTH squares and square-feet so an SF-unit phantom can't slip past.
    Skips $-prefixed figures (a unit price like "$43 SQ" is not an area)."""
    if not text:
        return None
    checks = (
        (r"(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:SQ|squares)\b", roof_sq, "SQ"),
        (r"(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:SF|sq\.?\s*ft|square\s*feet)\b", roof_sf, "SF"),
    )
    for pattern, limit, unit in checks:
        if not limit or limit <= 0:
            continue
        max_plausible = limit * 1.3
        for mt in re.finditer(pattern, text, re.IGNORECASE):
            if mt.start() > 0 and text[mt.start() - 1] == "$":
                continue  # unit price (e.g. "$43 SQ"), not an area
            try:
                val = float(mt.group(1).replace(",", ""))
            except (TypeError, ValueError):
                continue
            if val > max_plausible:
                return (val, unit, round(limit, 2))
    return None


def _apply_area_sanity_guard(parsed: dict, gt: dict) -> None:
    """E273 defense-in-depth: the model sometimes sums distinct same-surface
    roofing line items (tear-off + shingle + felt + I&W) as if they were
    additive roof area, inventing a phantom over-large 'our scope' and a false
    area underscope (observed: 17.43+19.52+6.29 = '43.24 SQ vs carrier 17.3 SQ,
    60% underscoped'). The prompt now forbids this; we ALSO catch it here so a
    stray phantom can't masquerade as a real finding. Scans every output text
    surface (each tactic's detail/counter_argument AND the free-text
    overall_assessment + supplement_priority) in both SQ and SF. Non-destructive:
    attaches _area_sanity_flag / _sanity_warnings; never deletes a finding.
    Known limitation: a phantom expressed with NO unit can't be distinguished
    from a legitimate number and is not flagged (the prompt normalizes to SQ)."""
    roof_sq = gt.get("total_roof_area_sq") or 0
    roof_sf = gt.get("total_roof_area_sf") or 0
    if roof_sq <= 0 and roof_sf <= 0:
        return
    flagged = []
    for tactic in parsed.get("tactics_found", []):
        if not isinstance(tactic, dict):
            continue
        hit = _implausible_area(
            f"{tactic.get('detail', '')} {tactic.get('counter_argument', '')}",
            roof_sq, roof_sf,
        )
        if hit:
            val, unit, limit = hit
            tactic["_area_sanity_flag"] = (
                f"cites {val} {unit} but the measured roof is only {limit} {unit} — "
                "likely summed distinct same-surface line items "
                "(tear-off + shingle + felt); NOT a real area underscope"
            )
            flagged.append(tactic.get("tactic", "area finding"))
    # The model can also park a phantom in the free-text summary fields.
    summary = str(parsed.get("overall_assessment", "")) + " " + " ".join(
        str(x) for x in (parsed.get("supplement_priority") or [])
    )
    summary_hit = _implausible_area(summary, roof_sq, roof_sf)
    if summary_hit:
        val, unit, limit = summary_hit
        flagged.append(
            f"summary cites {val} {unit} > measured roof {limit} {unit} (likely summed line items)"
        )
    if flagged:
        parsed["_sanity_warnings"] = flagged
