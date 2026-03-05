"""
CLI for NOAA Weather Intelligence Module.

Usage:
    python3 -m noaa_weather query --address "34 Adams Ave, Johnson City, NY" --date 2025-07-03
    python3 -m noaa_weather apply claims/34-adams-ave/claim_config.json
    python3 -m noaa_weather thresholds
    python3 -m noaa_weather full claims/34-adams-ave/claim_config.json
"""

import argparse
import json
import os
import sys

from noaa_weather.api import NOAAClient
from noaa_weather.geocode import geocode_address, extract_coords_from_config, build_address_from_config
from noaa_weather.thresholds import format_threshold_table, detect_materials_from_config
from noaa_weather.analyzer import ThresholdAnalyzer
from noaa_weather.report import apply_to_config, save_config


def cmd_query(args):
    """Query NOAA for storm data at an address + date."""
    print(f"Geocoding: {args.address}")
    geo = geocode_address(args.address)
    if not geo:
        print("ERROR: Could not geocode address. Check spelling and try again.", file=sys.stderr)
        sys.exit(1)
    print(f"  -> {geo.matched_address} ({geo.latitude:.4f}, {geo.longitude:.4f}) via {geo.source}")

    print(f"\nQuerying NOAA for storms near ({geo.latitude:.4f}, {geo.longitude:.4f}) on {args.date}...")
    client = NOAAClient(search_radius_deg=args.radius)
    storm_data = client.query(geo.latitude, geo.longitude, args.date, address=args.address)

    print(f"\n{storm_data.to_summary()}")

    if args.json:
        print(f"\n--- JSON ---")
        print(json.dumps(storm_data.to_dict(), indent=2))


def cmd_apply(args):
    """Apply NOAA data + threshold analysis to a claim config."""
    config_path = os.path.abspath(args.config)
    if not os.path.exists(config_path):
        print(f"ERROR: Config not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    with open(config_path) as f:
        config = json.load(f)

    # Get coordinates — from config or geocode
    coords = extract_coords_from_config(config)
    address = build_address_from_config(config)

    if not coords:
        print(f"Geocoding: {address}")
        geo = geocode_address(address)
        if not geo:
            print("ERROR: Could not geocode property address.", file=sys.stderr)
            sys.exit(1)
        coords = (geo.latitude, geo.longitude)
        print(f"  -> ({coords[0]:.4f}, {coords[1]:.4f}) via {geo.source}")

    # Get date of loss
    dol = config.get("dates", {}).get("date_of_loss", "")
    if not dol:
        dol = config.get("weather", {}).get("storm_date", "")
    if not dol:
        print("ERROR: No date_of_loss found in config.", file=sys.stderr)
        sys.exit(1)

    # Query NOAA
    print(f"Querying NOAA for {address} on {dol}...")
    client = NOAAClient()
    storm_data = client.query(coords[0], coords[1], dol, address=address)
    print(f"  Found {storm_data.event_count} events")
    if storm_data.max_hail_inches > 0:
        print(f'  Max hail: {storm_data.max_hail_inches}"')
    if storm_data.max_wind_mph > 0:
        print(f"  Max wind: {storm_data.max_wind_mph} mph")

    # Detect materials + analyze thresholds
    materials = detect_materials_from_config(config)
    print(f"\nMaterials detected: {len(materials)}")
    for m in materials:
        print(f'  - {m["material"]} (threshold: {m["display"]})')

    analyzer = ThresholdAnalyzer()
    analysis = analyzer.analyze(config, storm_data)

    print(f"\nThreshold Analysis:")
    print(analysis.to_summary())

    # Apply to config
    if not args.dry_run:
        apply_to_config(config, storm_data, analysis)
        save_config(config, config_path)
        print(f"\nConfig updated: {config_path}")
    else:
        print(f"\n[DRY RUN] Would update: {config_path}")
        print(json.dumps(analysis.to_dict(), indent=2))


def cmd_thresholds(args):
    """Display the full threshold registry."""
    print(format_threshold_table())


def cmd_full(args):
    """Full pipeline: query NOAA + apply thresholds + update config."""
    # Reuse apply logic
    args.dry_run = False
    cmd_apply(args)


def main():
    parser = argparse.ArgumentParser(
        prog="noaa_weather",
        description="NOAA Weather Intelligence Module — storm data + damage threshold auto-calculation",
    )
    sub = parser.add_subparsers(dest="command", help="Available commands")

    # query
    p_query = sub.add_parser("query", help="Query NOAA for storm data at an address + date")
    p_query.add_argument("--address", required=True, help="Property address")
    p_query.add_argument("--date", required=True, help="Date of loss (YYYY-MM-DD or 'Month DD, YYYY')")
    p_query.add_argument("--radius", type=float, default=0.15, help="Search radius in degrees (default: 0.15 ≈ 10 mi)")
    p_query.add_argument("--json", action="store_true", help="Output JSON")

    # apply
    p_apply = sub.add_parser("apply", help="Apply NOAA data + thresholds to a claim config")
    p_apply.add_argument("config", help="Path to claim_config.json")
    p_apply.add_argument("--dry-run", action="store_true", help="Show what would change without saving")

    # thresholds
    sub.add_parser("thresholds", help="Display the full damage threshold registry")

    # full
    p_full = sub.add_parser("full", help="Full pipeline: query + analyze + update config")
    p_full.add_argument("config", help="Path to claim_config.json")

    args = parser.parse_args()

    if args.command == "query":
        cmd_query(args)
    elif args.command == "apply":
        cmd_apply(args)
    elif args.command == "thresholds":
        cmd_thresholds(args)
    elif args.command == "full":
        cmd_full(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
