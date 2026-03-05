"""
Threshold analyzer — compares NOAA-confirmed hail size against claim material thresholds.
Auto-generates damage_thresholds entries for claim_config.json.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional

from noaa_weather.api import NOAAStormData
from noaa_weather.thresholds import DAMAGE_THRESHOLDS, detect_materials_from_config


@dataclass
class ThresholdResult:
    component: str
    threshold: str       # e.g., '0.75" diameter hail (Koontz/White aging study)'
    storm_actual: str    # e.g., '1.75" (NOAA NWS Local Storm Report, Trained Spotter, 2.3 mi from property)'
    result: str          # "EXCEEDED — 2.3x threshold" | "MET" | "Below threshold"
    source: str          # "NOAA SWDI + Koontz/White Research"
    threshold_inches: float
    storm_inches: float
    ratio: float         # storm / threshold

    def to_dict(self):
        return {
            "component": self.component,
            "threshold": self.threshold,
            "storm_actual": self.storm_actual,
            "result": self.result,
            "source": self.source,
        }

    def to_summary(self):
        return f"  {self.component}: {self.result} ({self.storm_inches}\" vs {self.threshold_inches}\" threshold)"


@dataclass
class AnalysisResult:
    materials_detected: int
    thresholds_exceeded: int
    thresholds_met: int
    thresholds_below: int
    max_hail_inches: float
    results: List[ThresholdResult] = field(default_factory=list)

    def to_dict(self):
        return {
            "materials_detected": self.materials_detected,
            "thresholds_exceeded": self.thresholds_exceeded,
            "thresholds_met": self.thresholds_met,
            "thresholds_below": self.thresholds_below,
            "max_hail_inches": self.max_hail_inches,
            "damage_thresholds": [r.to_dict() for r in self.results],
        }

    def to_summary(self):
        lines = [
            f"Materials detected: {self.materials_detected}",
            f'Max NOAA hail: {self.max_hail_inches}"',
            f"EXCEEDED: {self.thresholds_exceeded} | MET: {self.thresholds_met} | Below: {self.thresholds_below}",
        ]
        for r in self.results:
            lines.append(r.to_summary())
        return "\n".join(lines)


class ThresholdAnalyzer:
    """Compare NOAA storm data against material damage thresholds."""

    def analyze(self, config: dict, storm_data: NOAAStormData) -> AnalysisResult:
        """
        Auto-detect materials from claim config, compare against NOAA hail data,
        and generate threshold results.
        """
        materials = detect_materials_from_config(config)
        max_hail = storm_data.max_hail_inches

        # Find the closest/best hail event for citation
        best_hail_event = None
        for evt in storm_data.events:
            if evt.magnitude_type == "hail_inches" and evt.magnitude == max_hail:
                if best_hail_event is None or evt.distance_miles < best_hail_event.distance_miles:
                    best_hail_event = evt

        results = []
        exceeded = 0
        met = 0
        below = 0

        for mat in materials:
            threshold_inches = mat["threshold_inches"]
            ratio = max_hail / threshold_inches if threshold_inches > 0 else 0

            # Build citation string for storm_actual
            storm_actual = f'{max_hail}"'
            if best_hail_event:
                parts = [f"NOAA {best_hail_event.source.replace('_', ' ')}"]
                if best_hail_event.source_detail:
                    parts.append(best_hail_event.source_detail)
                parts.append(f"{best_hail_event.distance_miles:.1f} mi from property")
                storm_actual = f'{max_hail}" ({", ".join(parts)})'

            # Build threshold display with source
            threshold_display = mat["display"]
            short_source = mat["source"].split(" — ")[0] if " — " in mat["source"] else ""
            if short_source:
                threshold_display += f" ({short_source})"

            # Determine result
            if max_hail <= 0:
                result_str = "No NOAA hail data available"
                below += 1
            elif ratio > 1.0:
                result_str = f"EXCEEDED \u2014 {ratio:.1f}x threshold"
                exceeded += 1
            elif ratio == 1.0:
                result_str = "MET \u2014 equals damage threshold"
                met += 1
            else:
                result_str = f'Below threshold ({max_hail}" vs {threshold_inches}" required)'
                below += 1

            # Build source attribution
            source_parts = ["NOAA SWDI"]
            if short_source and short_source != "Industry standard":
                source_parts.append(short_source)
            source_attr = " + ".join(source_parts)

            results.append(ThresholdResult(
                component=mat["material"],
                threshold=threshold_display,
                storm_actual=storm_actual,
                result=result_str,
                source=source_attr,
                threshold_inches=threshold_inches,
                storm_inches=max_hail,
                ratio=ratio,
            ))

        # Sort: exceeded first, then met, then below
        results.sort(key=lambda r: (-r.ratio, r.threshold_inches))

        return AnalysisResult(
            materials_detected=len(materials),
            thresholds_exceeded=exceeded,
            thresholds_met=met,
            thresholds_below=below,
            max_hail_inches=max_hail,
            results=results,
        )

    def analyze_manual(self, config: dict, hail_inches: float,
                       citation: str = "Manual entry") -> AnalysisResult:
        """
        Analyze with manually specified hail size (no NOAA query).
        Useful when NOAA data isn't available but hail size is known from other sources.
        """
        # Create a minimal storm data object
        storm_data = NOAAStormData(
            property_address="",
            property_coords=(0, 0),
            date_of_loss="",
        )
        storm_data.max_hail_inches = hail_inches

        # Run normal analysis — it will use max_hail_inches
        result = self.analyze(config, storm_data)

        # Override storm_actual citations to use manual entry
        for r in result.results:
            r.storm_actual = f'{hail_inches}" ({citation})'
            r.source = r.source.replace("NOAA SWDI", citation)

        return result
