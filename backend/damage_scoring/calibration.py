"""
Calibration engine — backtest the dual scoring system against historical claims.
Uses pre-computed scores from claim configs (merged by batch_score.py).
"""

import json
import os
from typing import Dict, List, Any, Optional


def calibrate(claims_dir: str = "claims") -> Dict[str, Any]:
    """
    Backtest all claims with known outcomes.
    Reads pre-computed scores from config['scoring'] (merged by batch_score.py).
    Falls back to recomputing if no scoring section exists.

    Returns calibration report with accuracy metrics.
    """
    if not os.path.isabs(claims_dir):
        claims_dir = os.path.join(os.path.dirname(__file__), "..", claims_dir)

    results = []
    correct_predictions = 0
    total_with_outcome = 0

    if not os.path.isdir(claims_dir):
        return {"error": f"Claims directory not found: {claims_dir}"}

    for slug in sorted(os.listdir(claims_dir)):
        config_path = os.path.join(claims_dir, slug, "claim_config.json")
        if not os.path.isfile(config_path):
            continue

        try:
            with open(config_path, "r") as f:
                config = json.load(f)
        except (json.JSONDecodeError, IOError):
            continue

        # Read pre-computed scores from config
        scoring = config.get("scoring", {})
        ds_score = scoring.get("damage_score")
        ds_grade = scoring.get("damage_grade")
        tas_score = scoring.get("approval_score")
        tas_grade = scoring.get("approval_grade")

        # Fallback: recompute if no scoring section
        if ds_score is None or tas_score is None:
            from damage_scoring.damage_scorer import compute_damage_score
            from damage_scoring.approval_scorer import compute_approval_score
            ds = compute_damage_score(config, hail_analysis=config.get("hail_analysis"))
            tas = compute_approval_score(config, ds)
            ds_score = ds.score
            ds_grade = ds.grade
            tas_score = tas.score
            tas_grade = tas.grade

        # Determine outcome from dashboard status
        dashboard = config.get("dashboard", {})
        outcome = dashboard.get("status", "pending")
        if outcome not in ("won", "lost"):
            outcome = "pending"

        # Predict: TAS >= 50 = should file
        predicted_file = tas_score >= 50
        actual_won = outcome == "won"

        if outcome in ("won", "lost"):
            total_with_outcome += 1
            if (predicted_file and actual_won) or (not predicted_file and not actual_won):
                correct_predictions += 1

        # Extra context
        exposure = scoring.get("photo_analysis", {}).get("exposure_inches_estimate", 0)
        product_boost = scoring.get("product_intelligence", {}).get("tas_boost", 0)
        repairability = config.get("forensic_findings", {}).get("repairability", {})
        repair_det = repairability.get("determination", "")

        results.append({
            "slug": slug,
            "damage_score": ds_score,
            "damage_grade": ds_grade,
            "approval_score": tas_score,
            "approval_grade": tas_grade,
            "outcome": outcome,
            "predicted_file": predicted_file,
            "correct": (predicted_file and actual_won) or
                       (not predicted_file and not actual_won) if outcome in ("won", "lost") else None,
            "exposure": exposure,
            "product_boost": product_boost,
            "repairability": repair_det,
        })

    accuracy = (correct_predictions / total_with_outcome * 100) if total_with_outcome > 0 else 0

    return {
        "total_claims": len(results),
        "claims_with_outcome": total_with_outcome,
        "correct_predictions": correct_predictions,
        "accuracy_pct": round(accuracy, 1),
        "results": results,
    }


def format_calibration_report(report: Dict[str, Any]) -> str:
    """Format calibration results as a readable report."""
    lines = []
    lines.append("=" * 80)
    lines.append("DUAL SCORE CALIBRATION REPORT")
    lines.append("=" * 80)
    lines.append(f"Claims scored:      {report['total_claims']}")
    lines.append(f"Known outcomes:     {report['claims_with_outcome']}")
    lines.append(f"Correct predictions:{report['correct_predictions']}")
    lines.append(f"Accuracy:           {report['accuracy_pct']}%")
    lines.append("")

    header = f"{'Claim':<45} {'DS':>3} {'DG':>3} {'TAS':>4} {'TG':>3} {'Outcome':>8} {'Pred':>5} {'OK':>3} {'Exp':>5} {'Repair':>12}"
    lines.append(header)
    lines.append("-" * len(header))

    for r in report["results"]:
        pred = "FILE" if r["predicted_file"] else "SKIP"
        ok = ""
        if r["correct"] is True:
            ok = "YES"
        elif r["correct"] is False:
            ok = "NO"
        exp = f"{r['exposure']}\"" if r.get("exposure") else ""
        repair = r.get("repairability", "")[:12]
        lines.append(
            f"{r['slug']:<45} "
            f"{r['damage_score']:>3} "
            f"{r['damage_grade']:>3} "
            f"{r['approval_score']:>4} "
            f"{r['approval_grade']:>3} "
            f"{r['outcome']:>8} "
            f"{pred:>5} "
            f"{ok:>3} "
            f"{exp:>5} "
            f"{repair:>12}"
        )

    return "\n".join(lines)
