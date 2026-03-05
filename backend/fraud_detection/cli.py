"""
CLI entry point for fraud detection.
Usage: python3 -m fraud_detection [options] [claim_config_path]
"""

import sys
import os
import json
import glob
import argparse
from datetime import datetime


def load_claim_config(config_path: str) -> dict:
    """Load claim config and resolve paths."""
    with open(config_path, "r") as f:
        config = json.load(f)

    claim_dir = os.path.dirname(os.path.abspath(config_path))
    config["_claim_dir"] = claim_dir
    config["_photos_dir"] = os.path.join(claim_dir, "photos")
    return config


def get_claim_slug(config_path: str) -> str:
    """Extract claim slug from config path."""
    claim_dir = os.path.dirname(os.path.abspath(config_path))
    return os.path.basename(claim_dir)


def run_single_claim(config_path: str, verbose: bool = False):
    """Run fraud checks on a single claim."""
    from fraud_detection.pipeline import run_fraud_checks
    from fraud_detection.db import FraudDB

    print(f"\n  Fraud Detection v1.0.0")
    print(f"  {'-' * 40}")

    config = load_claim_config(config_path)
    slug = get_claim_slug(config_path)
    db = FraudDB()

    print(f"  Claim: {slug}")
    photos_dir = config.get("_photos_dir", "")
    photo_count = len(glob.glob(os.path.join(photos_dir, "*.jp*g")) +
                      glob.glob(os.path.join(photos_dir, "*.JP*G")))
    print(f"  Photos directory: {photos_dir}")
    print(f"  Running checks...")

    report = run_fraud_checks(config, slug, db)
    report.print_summary()

    if verbose:
        print(f"\n  --- Detailed Results ---")
        for v in report.verifications:
            status = "PASS" if v.passed else "FLAG"
            print(f"\n  [{status}] {v.photo_key} — {os.path.basename(v.file_path)}")
            if v.metadata.timestamp:
                print(f"    Timestamp: {v.metadata.timestamp}")
            if v.metadata.gps_lat is not None:
                print(f"    GPS: ({v.metadata.gps_lat:.6f}, {v.metadata.gps_lon:.6f})")
            if v.metadata.software:
                print(f"    Software: {v.metadata.software}")
            if v.metadata.perceptual_hash:
                print(f"    pHash: {v.metadata.perceptual_hash[:16]}...")
            for f in v.flags:
                print(f"    [{f.tier.upper()}] {f.message}")

    # Save results to config
    config["photo_integrity"] = report.to_dict()
    config_out = {k: v for k, v in config.items() if not k.startswith("_")}
    with open(config_path, "w") as f:
        json.dump(config_out, f, indent=2)
    print(f"\n  Results saved to claim_config.json")

    return report


def run_backfill():
    """Backfill hash database from all existing claims."""
    from fraud_detection.pipeline import backfill_claim
    from fraud_detection.db import FraudDB

    print(f"\n  Fraud Detection — Hash Database Backfill")
    print(f"  {'-' * 40}")

    db = FraudDB()
    claims_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "claims")

    total_photos = 0
    total_claims = 0

    for claim_dir in sorted(os.listdir(claims_dir)):
        config_path = os.path.join(claims_dir, claim_dir, "claim_config.json")
        if not os.path.exists(config_path):
            continue

        config = load_claim_config(config_path)
        slug = claim_dir
        count = backfill_claim(config, slug, db)
        if count > 0:
            print(f"  {slug}: {count} photos registered")
            total_photos += count
            total_claims += 1

    print(f"\n  Backfill complete: {total_photos} photos from {total_claims} claims")
    stats = db.get_stats()
    print(f"  Database: {stats['total_hashes']} hashes, {stats['total_claims']} claims")


def run_all_claims(verbose: bool = False):
    """Run fraud checks on all claims."""
    from fraud_detection.pipeline import run_fraud_checks
    from fraud_detection.db import FraudDB

    print(f"\n  Fraud Detection — Full Scan")
    print(f"  {'=' * 40}")

    db = FraudDB()
    claims_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "claims")

    results = []
    for claim_dir in sorted(os.listdir(claims_dir)):
        config_path = os.path.join(claims_dir, claim_dir, "claim_config.json")
        if not os.path.exists(config_path):
            continue

        config = load_claim_config(config_path)
        slug = claim_dir
        report = run_fraud_checks(config, slug, db)
        results.append(report)

        status_icon = {
            "clean": "PASS",
            "review_needed": "REVIEW",
            "critical_flags": "CRITICAL",
        }
        icon = status_icon.get(report.overall_status, "???")
        flag_info = ""
        if report.photos_flagged > 0:
            parts = []
            if report.tier_3_count:
                parts.append(f"{report.tier_3_count} critical")
            if report.tier_2_count:
                parts.append(f"{report.tier_2_count} review")
            if report.tier_1_count:
                parts.append(f"{report.tier_1_count} info")
            flag_info = f" ({', '.join(parts)})"
        print(f"  [{icon:>8}] {slug}: {report.photos_checked} photos{flag_info}")

    # Summary
    total_photos = sum(r.photos_checked for r in results)
    total_flagged = sum(r.photos_flagged for r in results)
    critical_claims = sum(1 for r in results if r.tier_3_count > 0)
    review_claims = sum(1 for r in results if r.tier_2_count > 0 and r.tier_3_count == 0)

    print(f"\n  {'=' * 40}")
    print(f"  Total: {len(results)} claims, {total_photos} photos")
    print(f"  Clean: {len(results) - critical_claims - review_claims}")
    if review_claims:
        print(f"  Review needed: {review_claims}")
    if critical_claims:
        print(f"  CRITICAL: {critical_claims}")
    print(f"  Total flags: {total_flagged}")


def run_stats():
    """Show database statistics."""
    from fraud_detection.db import FraudDB

    db = FraudDB()
    stats = db.get_stats()
    print(f"\n  Fraud Detection Database Stats")
    print(f"  {'-' * 40}")
    print(f"  Photo hashes:    {stats['total_hashes']}")
    print(f"  Claims tracked:  {stats['total_claims']}")
    print(f"  Total flags:     {stats['total_flags']}")
    print(f"  Unresolved:      {stats['unresolved_flags']}")


def main():
    parser = argparse.ArgumentParser(
        description="DumbRoof.ai Fraud Detection & Integrity System",
        prog="python3 -m fraud_detection",
    )
    parser.add_argument(
        "config_path",
        nargs="?",
        help="Path to claim_config.json",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run fraud checks on all claims",
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Backfill hash database from existing claims",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show database statistics",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show detailed per-photo results",
    )

    args = parser.parse_args()

    if args.stats:
        run_stats()
    elif args.backfill:
        run_backfill()
    elif args.all:
        run_all_claims(args.verbose)
    elif args.config_path:
        run_single_claim(args.config_path, args.verbose)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
