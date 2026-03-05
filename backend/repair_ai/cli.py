"""
CLI interface for DumbRoof Repair AI.

Usage:
    python3 -m repair_ai jobs/{job-id}/repair_job_config.json     # Process existing job
    python3 -m repair_ai --diagnose photos/ --notes "leak below chimney"  # Quick diagnosis
    python3 -m repair_ai --stats                                   # Show repair stats
"""

import os
import sys
import json
import argparse
from datetime import datetime

from .config import SKILL_LEVELS, LANGUAGES, REPAIR_TYPES, SEVERITY_LEVELS
from .diagnostic import (
    diagnose_leak,
    parse_diagnosis_response,
    assemble_repair_job,
    discover_photos,
    log_completed_repair,
    rebuild_repair_stats,
    _find_project_root,
)


def generate_job_id() -> str:
    """Generate a unique job ID."""
    now = datetime.now()
    return f"RPR-{now.strftime('%Y%m%d')}-{now.strftime('%H%M%S')}"


def cmd_diagnose(args):
    """Run diagnosis on a set of photos."""
    photos = discover_photos(args.photos_dir)
    if not photos:
        print(f"ERROR: No photos found in {args.photos_dir}")
        sys.exit(1)

    print(f"\nDumbRoof Repair AI — Leak Diagnosis")
    print(f"===================================")
    print(f"Photos:      {len(photos)} found in {args.photos_dir}")
    print(f"Skill level: {args.skill_level}")
    print(f"Language:    {LANGUAGES.get(args.language, args.language)}")
    print(f"Notes:       {args.notes or '(none)'}")
    print()

    # Build the diagnosis request
    result = diagnose_leak(
        photos=photos,
        leak_notes=args.notes or "",
        skill_level=args.skill_level,
        language=args.language,
        labor_rate=args.labor_rate,
    )

    # Output the prompt payload for use with Claude API
    print("DIAGNOSIS REQUEST PREPARED")
    print("=" * 40)
    print(f"Photos to analyze: {len(result['photo_data'])}")
    print(f"Reference context loaded: {len(result['system_context'])} chars")
    print()
    print("To run this diagnosis, send the prompt and photos to the Claude API.")
    print("The prompt is ready at: result['prompt']")
    print("The system context is at: result['system_context']")
    print()

    # In CLI mode, write the prompt to a temp file for inspection
    if args.output:
        prompt_data = {
            "prompt": result["prompt"],
            "system_context_length": len(result["system_context"]),
            "photo_count": len(result["photo_data"]),
            "photo_keys": result["photo_keys"],
            "config": result["config"],
        }
        with open(args.output, "w") as f:
            json.dump(prompt_data, f, indent=2)
        print(f"Prompt payload saved to: {args.output}")


def cmd_process(args):
    """Process an existing repair job config."""
    config_path = args.config
    if not os.path.exists(config_path):
        print(f"ERROR: Config not found: {config_path}")
        sys.exit(1)

    with open(config_path, "r") as f:
        config = json.load(f)

    job = config.get("job", {})
    diag = config.get("diagnosis", {})
    repair = config.get("repair", {})
    prop = config.get("property", {})
    ticket = config.get("homeowner_ticket", {})

    print(f"\nDumbRoof Repair AI — Job Summary")
    print(f"================================")
    print(f"Job ID:      {job.get('job_id', 'N/A')}")
    print(f"Status:      {job.get('status', 'N/A')}")
    print(f"Property:    {prop.get('address', '')} {prop.get('city', '')}, {prop.get('state', '')}")
    print()

    if diag:
        print(f"DIAGNOSIS")
        print(f"---------")
        print(f"Leak source: {diag.get('leak_source', 'N/A')}")
        print(f"Repair type: {diag.get('repair_type', 'N/A')}")
        print(f"Severity:    {diag.get('severity', 'N/A')}")
        print(f"Confidence:  {diag.get('confidence', 0):.0%}")
        print()

    if repair:
        print(f"REPAIR")
        print(f"------")
        print(f"Summary:     {repair.get('summary', 'N/A')}")
        print(f"Steps:       {len(repair.get('steps', []))}")
        print(f"Materials:   {len(repair.get('materials_list', []))}")
        print(f"Labor hours: {repair.get('labor_hours', 0)}")
        print(f"Total price: ${repair.get('total_price', 0):,.2f}")
        print()

    if ticket:
        print(f"HOMEOWNER TICKET")
        print(f"----------------")
        print(f"What found:    {ticket.get('what_we_found', 'N/A')[:80]}...")
        print(f"Price:         ${ticket.get('price', 0):,.2f}")
        print(f"Time:          {ticket.get('time_estimate', 'N/A')}")
        print(f"Urgency:       {ticket.get('urgency', 'N/A')}")
        print()

    # Check if PDFs need generation
    job_dir = os.path.dirname(os.path.abspath(config_path))
    pdf_dir = os.path.join(job_dir, "pdf_output")
    if os.path.exists(pdf_dir):
        pdfs = [f for f in os.listdir(pdf_dir) if f.endswith(".pdf")]
        if pdfs:
            print(f"PDFs: {len(pdfs)} generated in pdf_output/")
            for pdf in sorted(pdfs):
                size = os.path.getsize(os.path.join(pdf_dir, pdf))
                print(f"  {pdf} ({size:,} bytes)")
        else:
            print("PDFs: Not yet generated. Run repair_generator.py to create PDFs.")
    else:
        print("PDFs: Not yet generated. Run repair_generator.py to create PDFs.")


def cmd_complete(args):
    """Mark a repair job as completed and log to self-improving system."""
    config_path = args.config
    if not os.path.exists(config_path):
        print(f"ERROR: Config not found: {config_path}")
        sys.exit(1)

    with open(config_path, "r") as f:
        config = json.load(f)

    config["job"]["status"] = "completed"
    config["completion"]["completed_date"] = datetime.now().strftime("%Y-%m-%d")

    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    # Log to self-improving system
    log_completed_repair(config)
    print(f"Repair marked complete. Logged to repair_knowledge/repair_log.jsonl")

    # Rebuild stats
    stats = rebuild_repair_stats()
    print(f"Stats updated: {stats['total_repairs']} total repairs in database")


def cmd_stats(args):
    """Show repair statistics from the self-improving log."""
    stats = rebuild_repair_stats()

    print(f"\nDumbRoof Repair AI — Statistics")
    print(f"===============================")
    print(f"Total repairs: {stats.get('total_repairs', 0)}")

    by_type = stats.get("by_type", {})
    if by_type:
        print(f"\nBy Repair Type:")
        for rt, data in sorted(by_type.items(), key=lambda x: x[1]["count"], reverse=True):
            label = REPAIR_TYPES.get(rt, rt)
            print(f"  {label}: {data['count']} repairs, avg {data['avg_hours']}h, avg ${data['avg_cost']:,.2f}")

    by_region = stats.get("by_region", {})
    if by_region:
        print(f"\nBy Region:")
        for region, data in sorted(by_region.items(), key=lambda x: x[1]["count"], reverse=True):
            print(f"  {region}: {data['count']} repairs")
            for rt, count in sorted(data.get("types", {}).items(), key=lambda x: x[1], reverse=True):
                print(f"    {rt}: {count}")


def main():
    parser = argparse.ArgumentParser(
        description="DumbRoof Repair AI — Leak Diagnosis & Repair Instructions"
    )
    subparsers = parser.add_subparsers(dest="command")

    # Diagnose command
    diag_parser = subparsers.add_parser("diagnose", help="Diagnose a leak from photos")
    diag_parser.add_argument("photos_dir", help="Directory containing leak photos")
    diag_parser.add_argument("--notes", "-n", default="", help="Field notes about the leak")
    diag_parser.add_argument(
        "--skill-level", "-s", default="journeyman",
        choices=list(SKILL_LEVELS.keys()),
        help="Roofer skill level (default: journeyman)"
    )
    diag_parser.add_argument(
        "--language", "-l", default="en",
        choices=list(LANGUAGES.keys()),
        help="Preferred language (default: en)"
    )
    diag_parser.add_argument(
        "--labor-rate", type=float, default=85.0,
        help="Labor rate $/hour (default: 85)"
    )
    diag_parser.add_argument("--output", "-o", help="Output prompt payload to JSON file")

    # Process command
    proc_parser = subparsers.add_parser("process", help="Process an existing repair job config")
    proc_parser.add_argument("config", help="Path to repair_job_config.json")

    # Complete command
    comp_parser = subparsers.add_parser("complete", help="Mark a repair as completed")
    comp_parser.add_argument("config", help="Path to repair_job_config.json")

    # Stats command
    subparsers.add_parser("stats", help="Show repair statistics")

    args = parser.parse_args()

    if args.command == "diagnose":
        cmd_diagnose(args)
    elif args.command == "process":
        cmd_process(args)
    elif args.command == "complete":
        cmd_complete(args)
    elif args.command == "stats":
        cmd_stats(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
