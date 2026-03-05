"""
CLI interface for hail damage detection.

Usage:
    python3 -m hail_detection analyze claims/{slug}/photos/       # Full claim analysis
    python3 -m hail_detection photo claims/{slug}/photos/img.jpg  # Single photo
    python3 -m hail_detection differentiate claims/{slug}/photos/img.jpg  # Hail vs blister
    python3 -m hail_detection cascade claims/{slug}/photos/       # Evidence cascade report
    python3 -m hail_detection report claims/{slug}/               # Full forensic report
"""

import argparse
import json
import sys
from pathlib import Path

from hail_detection.analyzer import HailDamageAnalyzer
from hail_detection.report import (
    format_cascade_report,
    populate_config_fields,
    generate_forensic_summary,
)


def cmd_analyze(args):
    """Full claim analysis — analyze all photos in directory."""
    analyzer = HailDamageAnalyzer()
    photo_dir = Path(args.path)

    if not photo_dir.exists():
        print(f"Error: {photo_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    assessment = analyzer.analyze_claim(str(photo_dir))
    assessment.print_summary()

    if args.json:
        print(json.dumps(assessment.to_dict(), indent=2))

    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json.dumps(assessment.to_dict(), indent=2))
        print(f"  Results saved to {output_path}")


def cmd_photo(args):
    """Single photo analysis."""
    analyzer = HailDamageAnalyzer()
    image_path = Path(args.path)

    if not image_path.exists():
        print(f"Error: {image_path} does not exist", file=sys.stderr)
        sys.exit(1)

    print(f"  Analyzing {image_path.name}...")
    assessment = analyzer.analyze_photo(str(image_path))

    print(f"\n  Damage type: {assessment.damage_type}")
    print(f"  Confidence: {assessment.confidence:.0%}")
    print(f"  Severity: {assessment.severity}")
    print(f"  Hit count: {assessment.hit_count_estimate}")
    if assessment.hit_size_range_mm != (0, 0):
        print(f"  Hit size range: {assessment.hit_size_range_mm[0]:.0f}-{assessment.hit_size_range_mm[1]:.0f}mm")
    if assessment.evidence:
        print(f"  Evidence:")
        for e in assessment.evidence:
            print(f"    - {e}")
    if assessment.differentiation:
        print(f"  Differentiation: {assessment.differentiation.get('why_this_type', 'N/A')}")

    if args.json:
        print(json.dumps(assessment.to_dict(), indent=2))


def cmd_differentiate(args):
    """12-point differentiation analysis: hail vs. blister vs. mechanical vs. wear."""
    analyzer = HailDamageAnalyzer()
    image_path = Path(args.path)

    if not image_path.exists():
        print(f"Error: {image_path} does not exist", file=sys.stderr)
        sys.exit(1)

    print(f"  Running 12-point differentiation on {image_path.name}...")
    report = analyzer.differentiate_damage(str(image_path))

    print(f"\n  Conclusion: {report.conclusion}")
    print(f"  Confidence: {report.confidence:.0%}")

    if report.hail_indicators:
        print(f"\n  Hail indicators:")
        for ind in report.hail_indicators:
            print(f"    + {ind}")

    if report.blister_indicators:
        print(f"\n  Blister indicators:")
        for ind in report.blister_indicators:
            print(f"    - {ind}")

    if report.mechanical_indicators:
        print(f"\n  Mechanical indicators:")
        for ind in report.mechanical_indicators:
            print(f"    - {ind}")

    if report.wear_indicators:
        print(f"\n  Wear indicators:")
        for ind in report.wear_indicators:
            print(f"    - {ind}")

    if report.reasoning:
        print(f"\n  Reasoning: {report.reasoning}")

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))


def cmd_cascade(args):
    """Evidence cascade report — build sequential evidence."""
    analyzer = HailDamageAnalyzer()
    photo_dir = Path(args.path)

    if not photo_dir.exists():
        print(f"Error: {photo_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    assessment = analyzer.analyze_claim(str(photo_dir))
    print(format_cascade_report(assessment))


def cmd_report(args):
    """Full forensic report — generates config fields."""
    analyzer = HailDamageAnalyzer()
    claim_dir = Path(args.path)

    # Find photos directory
    photo_dir = claim_dir / "photos"
    if not photo_dir.exists():
        photo_dir = claim_dir
    if not photo_dir.exists():
        print(f"Error: Cannot find photos in {claim_dir}", file=sys.stderr)
        sys.exit(1)

    assessment = analyzer.analyze_claim(str(photo_dir))
    assessment.print_summary()

    # Generate config fields
    config_fields = populate_config_fields(assessment)

    print("\n  Generated config fields:")
    print(f"    damage_thresholds: {len(config_fields['damage_thresholds'])} entries")
    print(f"    critical_observations: {len(config_fields['critical_observations'])} entries")
    print(f"    differentiation_table: {len(config_fields['differentiation_table'])} entries")

    # Forensic summary
    summary = generate_forensic_summary(assessment)
    print(f"\n  Forensic Summary:")
    print(f"    {summary[:200]}...")

    if args.json:
        print(json.dumps(config_fields, indent=2))

    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json.dumps(config_fields, indent=2))
        print(f"\n  Config fields saved to {output_path}")

    # Optionally merge into claim_config.json
    config_path = claim_dir / "claim_config.json"
    if args.merge and config_path.exists():
        with open(config_path) as f:
            config = json.load(f)
        if "forensic_findings" not in config:
            config["forensic_findings"] = {}
        config["forensic_findings"].update(config_fields)
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)
        print(f"  Merged into {config_path}")


def main():
    parser = argparse.ArgumentParser(
        description="DumbRoof.ai Hail Damage Detection System",
        prog="python3 -m hail_detection",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # analyze
    p_analyze = subparsers.add_parser("analyze", help="Full claim photo analysis")
    p_analyze.add_argument("path", help="Path to photos directory")
    p_analyze.add_argument("--json", action="store_true", help="Output full JSON")
    p_analyze.add_argument("--output", "-o", help="Save results to file")
    p_analyze.set_defaults(func=cmd_analyze)

    # photo
    p_photo = subparsers.add_parser("photo", help="Single photo analysis")
    p_photo.add_argument("path", help="Path to photo file")
    p_photo.add_argument("--json", action="store_true", help="Output full JSON")
    p_photo.set_defaults(func=cmd_photo)

    # differentiate
    p_diff = subparsers.add_parser("differentiate", help="Hail vs. blister differentiation")
    p_diff.add_argument("path", help="Path to photo file")
    p_diff.add_argument("--json", action="store_true", help="Output full JSON")
    p_diff.set_defaults(func=cmd_differentiate)

    # cascade
    p_cascade = subparsers.add_parser("cascade", help="Evidence cascade report")
    p_cascade.add_argument("path", help="Path to photos directory")
    p_cascade.set_defaults(func=cmd_cascade)

    # report
    p_report = subparsers.add_parser("report", help="Full forensic report with config fields")
    p_report.add_argument("path", help="Path to claim directory")
    p_report.add_argument("--json", action="store_true", help="Output full JSON")
    p_report.add_argument("--output", "-o", help="Save config fields to file")
    p_report.add_argument("--merge", action="store_true", help="Merge into claim_config.json")
    p_report.set_defaults(func=cmd_report)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)
