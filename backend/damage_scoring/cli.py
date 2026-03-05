"""
CLI for the USARM Dual Score System.
Usage: python3 -m damage_scoring <command> [options]
"""

import argparse
import json
import os
import sys
from typing import Optional

from damage_scoring.models import DualScoreResult, ProductMatch
from damage_scoring.damage_scorer import compute_damage_score
from damage_scoring.approval_scorer import compute_approval_score
from damage_scoring.product_db import match_product
from damage_scoring.report import merge_scores_to_config, build_db_record
from damage_scoring.calibration import calibrate, format_calibration_report
from damage_scoring.geo_intelligence import (
    heatmap, leaderboard, format_heatmap, format_leaderboard,
)


def _load_config(claim_dir: str) -> dict:
    """Load claim_config.json from a claim directory."""
    config_path = os.path.join(claim_dir, "claim_config.json")
    if not os.path.isfile(config_path):
        print(f"Error: Config not found: {config_path}", file=sys.stderr)
        sys.exit(1)
    with open(config_path, "r") as f:
        return json.load(f)


def _get_slug(claim_dir: str) -> str:
    """Extract slug from claim directory path."""
    return os.path.basename(os.path.normpath(claim_dir))


def _score_claim(claim_dir: str, deep: bool = False, use_photos: bool = False) -> DualScoreResult:
    """Score a single claim. Core logic shared by score/compare/backfill."""
    config = _load_config(claim_dir)
    slug = _get_slug(claim_dir)

    analysis = None
    product_match = None

    # If --deep, run photo analysis
    if use_photos or deep:
        try:
            from damage_scoring.enhanced_analyzer import EnhancedAnalyzer
            analyzer = EnhancedAnalyzer()
            print(f"\n  Running photo analysis for {slug}...")
            analysis = analyzer.run_scoring_analysis(claim_dir, deep=deep)

            # Product identification from photos
            shingle_id = analysis.get("shingle_id", {})
            if shingle_id:
                product_match = match_product(
                    manufacturer=shingle_id.get("manufacturer_guess", ""),
                    product_line=shingle_id.get("product_line_guess", ""),
                    product_type=shingle_id.get("shingle_type", ""),
                    exposure_inches=shingle_id.get("exposure_inches", 0),
                )
        except ImportError:
            print("  Warning: anthropic package not available, skipping photo analysis",
                  file=sys.stderr)
        except Exception as e:
            print(f"  Warning: Photo analysis failed: {e}", file=sys.stderr)

    # Inject scoring data for code triggers
    if product_match:
        config["_scoring_data"] = {"product_match": product_match.to_dict()}

    # Compute scores
    hail_analysis = config.get("hail_analysis")
    ds = compute_damage_score(config, analysis=analysis, hail_analysis=hail_analysis)
    tas = compute_approval_score(config, ds, product_match=product_match, analysis=analysis)

    # Build result
    prop = config.get("property", {})
    result = DualScoreResult(
        claim_slug=slug,
        address=prop.get("address", ""),
        city=prop.get("city", ""),
        state=prop.get("state", ""),
        zip_code=prop.get("zip", ""),
        county=prop.get("county", ""),
        lat=prop.get("lat"),
        lon=prop.get("lon"),
        damage=ds,
        approval=tas,
        product_match=product_match,
        analysis_metadata={
            "photos_found": (analysis or {}).get("photos_found", 0),
            "mode": "deep" if deep else ("photos" if use_photos else "config_only"),
        },
    )

    return result


def cmd_score(args):
    """Score a single claim: damage score + technical approval score."""
    result = _score_claim(args.claim_dir, deep=args.deep, use_photos=args.photos)

    if args.json:
        print(json.dumps(result.to_dict(), indent=2))
    else:
        result.print_summary()

    if args.merge:
        config_path = os.path.join(args.claim_dir, "claim_config.json")
        merge_scores_to_config(result, config_path)

    if args.db:
        try:
            from damage_scoring.db import DamageScoreDB
            config = _load_config(args.claim_dir)
            db = DamageScoreDB()
            record = build_db_record(result, config)
            db.upsert_score(record)
            print("  Score saved to Supabase.")
        except Exception as e:
            print(f"  Warning: DB save failed: {e}", file=sys.stderr)


def cmd_compare(args):
    """Compare two claims side-by-side."""
    result1 = _score_claim(args.claim_dir_1)
    result2 = _score_claim(args.claim_dir_2)

    if args.json:
        print(json.dumps({
            "claim_1": result1.to_dict(),
            "claim_2": result2.to_dict(),
        }, indent=2))
    else:
        slug1 = result1.claim_slug
        slug2 = result2.claim_slug
        print(f"\n  {'='*60}")
        print(f"  COMPARISON: {slug1} vs {slug2}")
        print(f"  {'='*60}")
        print(f"\n  {'Metric':<30} {slug1[:15]:>15} {slug2[:15]:>15}")
        print(f"  {'-'*60}")
        print(f"  {'Damage Score':<30} {result1.damage.score:>15} {result2.damage.score:>15}")
        print(f"  {'Damage Grade':<30} {result1.damage.grade:>15} {result2.damage.grade:>15}")
        print(f"  {'  A. Roof Surface':<30} {result1.damage.roof_surface.total:>12}/40 {result2.damage.roof_surface.total:>12}/40")
        print(f"  {'  B. Evidence Cascade':<30} {result1.damage.evidence_cascade.total:>12}/25 {result2.damage.evidence_cascade.total:>12}/25")
        print(f"  {'  C. Soft Metal':<30} {result1.damage.soft_metal.total:>12}/20 {result2.damage.soft_metal.total:>12}/20")
        print(f"  {'  D. Documentation':<30} {result1.damage.documentation.total:>12}/15 {result2.damage.documentation.total:>12}/15")
        print(f"  {'-'*60}")
        print(f"  {'Approval Score':<30} {str(result1.approval.score)+'%':>15} {str(result2.approval.score)+'%':>15}")
        print(f"  {'Approval Grade':<30} {result1.approval.grade:>15} {result2.approval.grade:>15}")
        print(f"  {'  1. Damage Factor':<30} {result1.approval.damage_factor_pts:>12}/35 {result2.approval.damage_factor_pts:>12}/35")
        print(f"  {'  2. Product Factor':<30} {result1.approval.product.total:>12}/25 {result2.approval.product.total:>12}/25")
        print(f"  {'  3. Code Triggers':<30} {result1.approval.code_triggers.total:>12}/20 {result2.approval.code_triggers.total:>12}/20")
        print(f"  {'  4. Carrier Factor':<30} {result1.approval.carrier.total:>12}/10 {result2.approval.carrier.total:>12}/10")
        print(f"  {'  5. Scope Factor':<30} {result1.approval.scope.total:>12}/10 {result2.approval.scope.total:>12}/10")
        print(f"  {'='*60}")


def cmd_heatmap(args):
    """Show damage or approval heatmap by geography."""
    data = heatmap(state=args.state, score_type=args.type)
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print(f"\n  {args.type.upper()} HEATMAP{' — ' + args.state if args.state else ''}")
        print(format_heatmap(data, score_type=args.type))


def cmd_leaderboard(args):
    """Show top claims by approval score."""
    data = leaderboard(limit=args.limit)
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print("\n  CLAIM LEADERBOARD (by Technical Approval Score)")
        print(format_leaderboard(data))


def cmd_calibrate(args):
    """Backtest scoring against historical claims."""
    claims_dir = args.claims_dir or os.path.join(os.path.dirname(__file__), "..", "claims")
    report = calibrate(claims_dir)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(format_calibration_report(report))


def cmd_backfill(args):
    """Score all existing claims and save results."""
    claims_dir = args.claims_dir or os.path.join(os.path.dirname(__file__), "..", "claims")
    if not os.path.isdir(claims_dir):
        print(f"Error: Claims directory not found: {claims_dir}", file=sys.stderr)
        sys.exit(1)

    slugs = sorted(d for d in os.listdir(claims_dir)
                   if os.path.isfile(os.path.join(claims_dir, d, "claim_config.json")))

    print(f"\n  Backfilling {len(slugs)} claims...")
    results = []

    for i, slug in enumerate(slugs):
        claim_dir = os.path.join(claims_dir, slug)
        print(f"  [{i+1}/{len(slugs)}] {slug}...", end=" ", flush=True)
        try:
            result = _score_claim(claim_dir)
            results.append(result)

            if args.merge:
                config_path = os.path.join(claim_dir, "claim_config.json")
                merge_scores_to_config(result, config_path)

            if args.db:
                try:
                    from damage_scoring.db import DamageScoreDB
                    config = _load_config(claim_dir)
                    db = DamageScoreDB()
                    record = build_db_record(result, config)
                    db.upsert_score(record)
                except Exception as e:
                    print(f"DB error: {e}", file=sys.stderr)

            print(f"DS:{result.damage.score} TAS:{result.approval.score}%")
        except Exception as e:
            print(f"ERROR: {e}")

    if args.json:
        print(json.dumps([r.to_dict() for r in results], indent=2))
    else:
        print(f"\n  Backfill complete: {len(results)}/{len(slugs)} claims scored")
        won = sum(1 for r in results if r.approval.score >= 60)
        print(f"  Claims recommended to file (TAS >= 60): {won}")
        skip = sum(1 for r in results if r.approval.score < 60)
        print(f"  Claims to skip/review (TAS < 60):       {skip}")


def main():
    parser = argparse.ArgumentParser(
        prog="python3 -m damage_scoring",
        description="USARM Dual Score System — Damage Score + Technical Approval Score",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # score
    p_score = subparsers.add_parser("score", help="Score a single claim")
    p_score.add_argument("claim_dir", help="Path to claim directory")
    p_score.add_argument("--deep", action="store_true", help="Run all Vision prompts (higher cost)")
    p_score.add_argument("--photos", action="store_true", help="Run photo analysis")
    p_score.add_argument("--merge", action="store_true", help="Write scores to claim_config.json")
    p_score.add_argument("--db", action="store_true", help="Save to Supabase")
    p_score.add_argument("--json", action="store_true", help="Output as JSON")
    p_score.set_defaults(func=cmd_score)

    # compare
    p_compare = subparsers.add_parser("compare", help="Compare two claims")
    p_compare.add_argument("claim_dir_1", help="First claim directory")
    p_compare.add_argument("claim_dir_2", help="Second claim directory")
    p_compare.add_argument("--json", action="store_true", help="Output as JSON")
    p_compare.set_defaults(func=cmd_compare)

    # heatmap
    p_heatmap = subparsers.add_parser("heatmap", help="Geographic heatmap")
    p_heatmap.add_argument("--state", default="", help="Filter by state (e.g., NY)")
    p_heatmap.add_argument("--type", default="damage", choices=["damage", "approval"],
                            help="Score type to display")
    p_heatmap.add_argument("--json", action="store_true", help="Output as JSON")
    p_heatmap.set_defaults(func=cmd_heatmap)

    # leaderboard
    p_leader = subparsers.add_parser("leaderboard", help="Top claims by approval score")
    p_leader.add_argument("--limit", type=int, default=20, help="Number of claims to show")
    p_leader.add_argument("--json", action="store_true", help="Output as JSON")
    p_leader.set_defaults(func=cmd_leaderboard)

    # calibrate
    p_cal = subparsers.add_parser("calibrate", help="Backtest against historical claims")
    p_cal.add_argument("--claims-dir", dest="claims_dir", help="Claims directory path")
    p_cal.add_argument("--json", action="store_true", help="Output as JSON")
    p_cal.set_defaults(func=cmd_calibrate)

    # backfill
    p_back = subparsers.add_parser("backfill", help="Score all existing claims")
    p_back.add_argument("--claims-dir", dest="claims_dir", help="Claims directory path")
    p_back.add_argument("--merge", action="store_true", help="Write scores to configs")
    p_back.add_argument("--db", action="store_true", help="Save to Supabase")
    p_back.add_argument("--json", action="store_true", help="Output as JSON")
    p_back.set_defaults(func=cmd_backfill)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)
