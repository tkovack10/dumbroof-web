"""
Report generator — populates weather and forensic_findings fields in claim_config.json.
"""

import json
from typing import Dict, Optional

from noaa_weather.api import NOAAStormData
from noaa_weather.analyzer import AnalysisResult


def generate_weather_fields(storm_data: NOAAStormData, analysis: Optional[AnalysisResult] = None) -> Dict:
    """
    Generate weather config fields from NOAA data and threshold analysis.
    Returns a dict ready to merge into claim_config["weather"].
    """
    fields = {
        "noaa": storm_data.to_dict(),
    }

    # Set/update hail_size if NOAA found hail
    if storm_data.max_hail_inches > 0:
        fields["hail_size"] = f"{storm_data.max_hail_inches} inches"

        # Build hail_size_algorithm from best source
        best_source = "NOAA"
        for evt in storm_data.events:
            if evt.magnitude_type == "hail_inches" and evt.magnitude == storm_data.max_hail_inches:
                best_source = _format_event_source(evt)
                break
        fields["hail_size_algorithm"] = f"{storm_data.max_hail_inches} inches ({best_source})"

    # Set wind speed if found
    if storm_data.max_wind_mph > 0:
        fields["wind_speed"] = f"{storm_data.max_wind_mph} mph"

    # Auto-generate storm_description from events
    if storm_data.events:
        fields["storm_description"] = _build_storm_description(storm_data)

    return fields


def generate_threshold_fields(analysis: AnalysisResult) -> list:
    """
    Generate damage_thresholds array for claim_config.
    Can go in weather.damage_thresholds or forensic_findings.damage_thresholds.
    """
    return [r.to_dict() for r in analysis.results]


def apply_to_config(config: dict, storm_data: NOAAStormData,
                    analysis: Optional[AnalysisResult] = None) -> dict:
    """
    Apply NOAA weather data and threshold analysis to a claim config.
    Merges into existing weather section — does NOT overwrite existing fields
    unless they're NOAA-specific.

    Returns the modified config (also modifies in place).
    """
    weather = config.setdefault("weather", {})
    findings = config.setdefault("forensic_findings", {})

    # Generate and merge weather fields
    new_fields = generate_weather_fields(storm_data, analysis)

    # Always overwrite NOAA subsection (it's ours)
    weather["noaa"] = new_fields.pop("noaa")

    # Only set other fields if not already populated (don't overwrite manual entries)
    for key, value in new_fields.items():
        if not weather.get(key):
            weather[key] = value

    # Apply threshold analysis results
    if analysis and analysis.results:
        thresholds = generate_threshold_fields(analysis)

        # Place in forensic_findings.damage_thresholds (preferred location per plan)
        findings["damage_thresholds"] = thresholds

        # Also keep in weather.damage_thresholds for backward compat
        weather["damage_thresholds"] = thresholds

    return config


def save_config(config: dict, config_path: str):
    """Save config back to disk, removing internal _paths key."""
    save_copy = {k: v for k, v in config.items() if not k.startswith("_")}
    with open(config_path, "w") as f:
        json.dump(save_copy, f, indent=2)


def _format_event_source(evt) -> str:
    """Format a human-readable source string for a storm event."""
    parts = []
    if evt.source == "STORM_EVENTS_DB":
        parts.append("NOAA Storm Events Database")
    elif evt.source == "SWDI_PLSR":
        parts.append("NOAA NWS Local Storm Report")
    elif evt.source == "SPC_DAILY":
        parts.append("NOAA SPC Storm Report")
    if evt.source_detail:
        parts.append(evt.source_detail)
    return ", ".join(parts)


def _build_storm_description(storm_data: NOAAStormData) -> str:
    """Auto-generate a storm description paragraph from NOAA events."""
    # Use episode narrative if available (authoritative NWS description)
    if storm_data.episode_narrative:
        desc = storm_data.episode_narrative
        # Add local hail/wind specifics
        specifics = []
        if storm_data.max_hail_inches > 0:
            specifics.append(f'{storm_data.max_hail_inches}" hail reported {storm_data.max_hail_distance_miles:.1f} mi from property')
        if storm_data.max_wind_mph > 0:
            specifics.append(f"wind gusts of {storm_data.max_wind_mph} mph")
        if specifics:
            desc += f" Near the subject property: {', '.join(specifics)}."

        # Add surrounding town reports for storm significance
        locations = {}
        for e in storm_data.events:
            if e.magnitude_type == "hail_inches":
                loc = e.source_detail.replace("NOAA Storm Events — ", "").strip()
                if loc and loc not in locations:
                    locations[loc] = e.magnitude
                elif loc and e.magnitude > locations.get(loc, 0):
                    locations[loc] = e.magnitude
        if locations:
            town_reports = [f'{loc} ({size}")' for loc, size in
                          sorted(locations.items(), key=lambda x: x[1], reverse=True)[:8]]
            desc += f" Hail reports in surrounding area: {', '.join(town_reports)}."

        return desc

    # Fallback: build from event data
    parts = []
    if storm_data.max_hail_inches > 0:
        parts.append(f'severe hail producing {storm_data.max_hail_inches}" diameter hailstones')
    if storm_data.max_wind_mph > 0:
        parts.append(f"wind gusts of {storm_data.max_wind_mph} mph")

    if not parts:
        return "Storm event detected by NOAA monitoring systems"

    desc = f"Severe thunderstorm with {' and '.join(parts)}"

    sources = set()
    for evt in storm_data.events:
        if evt.source == "STORM_EVENTS_DB":
            sources.add("NOAA Storm Events Database")
        elif evt.source == "SWDI_PLSR":
            sources.add("NWS Local Storm Reports")
        elif evt.source == "SPC_DAILY":
            sources.add("SPC storm reports")

    if sources:
        desc += f" as confirmed by {', '.join(sorted(sources))}"

    narratives = [e.narrative for e in storm_data.events if e.narrative and len(e.narrative) > 10]
    if narratives:
        desc += f". {narratives[0]}"

    return desc
