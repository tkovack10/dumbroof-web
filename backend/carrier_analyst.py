"""Per-claim carrier scope analysis — runs inline after scope extraction.

Detects underpayment tactics, recommends supplement arguments, and writes
findings to claims.carrier_analyst_flags. The weekly aggregate cron in
Vercel reads these flags to identify cross-portfolio patterns.

Plan: ~/.claude/plans/proud-wiggling-hearth.md Phase 2b
"""

from __future__ import annotations

import json
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
                model="claude-sonnet-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
        else:
            response = claude_client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
        raw = response.content[0].text
    except Exception as e:
        return {"analyzed": False, "reason": f"api error: {str(e)[:200]}"}

    parsed = _parse_response(raw)
    parsed["analyzed"] = True
    parsed["carrier_name"] = carrier_name
    parsed["carrier_rcv"] = carrier_rcv
    return parsed


def _build_ground_truth(measurements: dict, config: dict, carrier_name: str, carrier_rcv: float, carrier_items: list) -> dict:
    m = measurements or {}
    total_area = m.get("total_area_sq", 0) or m.get("total_area", 0)
    eave_lf = m.get("eave_lf", 0)
    valley_lf = m.get("valley_lf", 0)
    ridge_lf = m.get("ridge_lf", 0)
    rake_lf = m.get("rake_lf", 0)

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
    return f"""You are the DumbRoof Carrier Intelligence Analyst. Analyze this carrier scope for underpayment tactics.

GROUND TRUTH (our measurements + scope):
```json
{gt_json}
```

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

For each tactic found, recommend the strongest counter-argument with building code citations if applicable (RCNYS for NY, IRC for others).

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
