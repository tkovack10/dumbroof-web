"""
Damage Score algorithm — pure physical evidence scoring (0-100).
Measures ONLY what the photos show. No technicalities.

Config-only mode extracts signals from forensic_findings, damage_thresholds,
key_arguments, critical_observations, conclusion_findings, and line_items.
"""

import re
from typing import Dict, Any, Optional, List

from damage_scoring.models import (
    DamageScoreResult,
    RoofSurfaceDamage,
    EvidenceCascadeCompleteness,
    SoftMetalCorroboration,
    DocumentationQuality,
)


def compute_damage_score(
    config: dict,
    analysis: Optional[dict] = None,
    hail_analysis: Optional[dict] = None,
) -> DamageScoreResult:
    """
    Compute Damage Score from claim config and optional analysis results.

    Args:
        config: Full claim_config.json dict
        analysis: Results from EnhancedAnalyzer.run_scoring_analysis()
        hail_analysis: Existing hail_detection results from config

    Returns:
        DamageScoreResult with all component breakdowns
    """
    result = DamageScoreResult()
    result.roof_surface = _score_roof_surface(config, analysis, hail_analysis)
    result.evidence_cascade = _score_evidence_cascade(config, analysis, hail_analysis)
    result.soft_metal = _score_soft_metal(config, hail_analysis)
    result.documentation = _score_documentation(config, analysis)
    return result


def _get_all_text(config: dict) -> str:
    """Combine all text fields from forensic findings into one searchable string.
    Cached on config to avoid recomputation across scorers."""
    from damage_scoring.utils import get_all_forensic_text
    return get_all_forensic_text(config)


_METAL_PATTERNS = [re.compile(p) for p in [
    r"gutter", r"downspout", r"vent(?:s| )", r"pipe boot",
    r"drip edge", r"flash(?:ing|ed)", r"window wrap", r"fascia",
    r"soffit", r"a[/.]?c\s*(?:unit|pad)", r"mailbox", r"meter",
    r"gas line", r"chimney cap", r"exhaust cap",
]]

# Cache keyed by id(text) to avoid re-running 15 regex searches on the same string
_metal_cache = {}

def _count_metal_mentions(text: str) -> int:
    """Count distinct soft metal component types mentioned in text."""
    key = id(text)
    if key in _metal_cache:
        return _metal_cache[key]
    result = sum(1 for p in _METAL_PATTERNS if p.search(text))
    _metal_cache[key] = result
    return result


def _score_roof_surface(
    config: dict,
    analysis: Optional[dict],
    hail: Optional[dict],
) -> RoofSurfaceDamage:
    """Component A: Roof Surface Damage (0-40 pts)."""
    a = RoofSurfaceDamage()

    forensic = config.get("forensic_findings", {})
    severity_analyses = (analysis or {}).get("severity_analyses", [])
    comparison = (analysis or {}).get("photo_comparison", {})
    all_text = _get_all_text(config)

    # A1: Damage Confirmation (0-10)
    if severity_analyses:
        confirmed = [s for s in severity_analyses
                     if s.get("severity_score", 0) >= 3 and s.get("confidence", 0) >= 0.5]
        high_conf = [s for s in confirmed if s.get("confidence", 0) >= 0.7]
        if len(high_conf) >= 10:
            a.damage_confirmation = 10
        elif len(high_conf) >= 5:
            a.damage_confirmation = 8
        elif len(confirmed) >= 2:
            a.damage_confirmation = 5
        elif len(confirmed) >= 1:
            a.damage_confirmation = 3
    elif hail:
        confidence = hail.get("overall_confidence", 0)
        if isinstance(confidence, str):
            conf_map = {"very_high": 0.9, "high": 0.8, "moderate": 0.6, "low": 0.3}
            confidence = conf_map.get(confidence, 0.5)
        damage_count = hail.get("confirmed_damage_photos", 0)
        if damage_count >= 10 and confidence >= 0.7:
            a.damage_confirmation = 10
        elif damage_count >= 5 and confidence >= 0.7:
            a.damage_confirmation = 8
        elif damage_count >= 2:
            a.damage_confirmation = 5
        elif damage_count >= 1:
            a.damage_confirmation = 3
    else:
        # Config-only: mine forensic findings for damage confirmation
        thresholds = forensic.get("damage_thresholds", [])
        exceeded = sum(1 for t in thresholds
                       if isinstance(t, dict) and "exceeded" in str(t.get("result", "")).lower())

        # Strong confirmation signals
        has_hailtrace = "hailtrace" in all_text or "hail trace" in all_text
        has_hail_confirmed = "hail damage" in all_text and (
            "confirmed" in all_text or "documented" in all_text or "verified" in all_text)
        conclusion_count = len(forensic.get("conclusion_findings", []))

        if exceeded >= 3 and has_hailtrace:
            a.damage_confirmation = 10
        elif exceeded >= 2 and (has_hailtrace or has_hail_confirmed):
            a.damage_confirmation = 8
        elif exceeded >= 1 or (has_hail_confirmed and conclusion_count >= 3):
            a.damage_confirmation = 7
        elif has_hail_confirmed:
            a.damage_confirmation = 5
        elif "damage" in all_text and conclusion_count >= 2:
            a.damage_confirmation = 4
        elif "damage" in all_text:
            a.damage_confirmation = 3

    # A2: Severity Spectrum (0-12)
    if severity_analyses:
        max_severity = max((s.get("severity_score", 0) for s in severity_analyses), default=0)
        a.severity_spectrum = min(12, max_severity)
    elif hail:
        severity = hail.get("severity_level", "")
        sev_map = {
            "cosmetic_minor": 3, "cosmetic-minor": 3,
            "cosmetic_moderate": 5, "cosmetic-moderate": 5,
            "cosmetic_severe": 7, "cosmetic-severe": 7,
            "functional_early": 9, "functional-early": 9,
            "functional_confirmed": 10, "functional-confirmed": 10,
            "functional_severe": 11, "functional-severe": 11,
            "structural": 12,
        }
        a.severity_spectrum = sev_map.get(severity, 0)
    else:
        # Config-only: infer severity from text evidence
        if any(kw in all_text for kw in ["structural", "deck visible", "active leak"]):
            a.severity_spectrum = 12
        elif any(kw in all_text for kw in ["mat fractured", "mat torn", "severe functional"]):
            a.severity_spectrum = 11
        elif any(kw in all_text for kw in ["mat exposed", "functional confirmed", "waterproof compromised"]):
            a.severity_spectrum = 10
        elif any(kw in all_text for kw in ["functional", "waterproofing", "compromised"]):
            a.severity_spectrum = 9
        elif any(kw in all_text for kw in ["significant granule", "clear depression", "bruising"]):
            a.severity_spectrum = 7
        elif any(kw in all_text for kw in ["granule loss", "granule displacement", "impact"]):
            a.severity_spectrum = 5
        elif "cosmetic" in all_text or "minor" in all_text:
            a.severity_spectrum = 3
        # Boost from damage_thresholds EXCEEDED results
        thresholds = forensic.get("damage_thresholds", [])
        exceeded_count = sum(1 for t in thresholds
                             if isinstance(t, dict) and "exceeded" in str(t.get("result", "")).lower())
        if exceeded_count >= 3 and a.severity_spectrum < 9:
            a.severity_spectrum = max(a.severity_spectrum, 7)
        elif exceeded_count >= 1 and a.severity_spectrum < 5:
            a.severity_spectrum = max(a.severity_spectrum, 5)

    # A3: Hit Density (0-10)
    if severity_analyses:
        max_hits = max((s.get("hit_count_visible", 0) for s in severity_analyses), default=0)
        if max_hits >= 15:
            a.hit_density = 10
        elif max_hits >= 8:
            a.hit_density = 7
        elif max_hits >= 4:
            a.hit_density = 5
        elif max_hits >= 1:
            a.hit_density = 3
    elif hail:
        density = hail.get("hit_density", "")
        density_map = {"very_high": 10, "high": 7, "moderate": 5, "low": 3, "none": 0}
        a.hit_density = density_map.get(density, 0)
        hps = hail.get("hits_per_square", 0)
        if hps >= 15:
            a.hit_density = max(a.hit_density, 10)
        elif hps >= 8:
            a.hit_density = max(a.hit_density, 7)
    else:
        # Config-only: infer from text + hail size from thresholds
        hail_size = _extract_hail_size(all_text)
        if hail_size >= 1.75:
            a.hit_density = 7  # 1.75"+ hail = significant density expected
        elif hail_size >= 1.25:
            a.hit_density = 5
        elif hail_size >= 1.0:
            a.hit_density = 4
        elif any(kw in all_text for kw in ["extensive", "numerous", "widespread", "pervasive"]):
            a.hit_density = 7
        elif any(kw in all_text for kw in ["multiple", "several", "many"]):
            a.hit_density = 5
        elif "damage" in all_text:
            a.hit_density = 3

    # A4: Cross-Photo Consistency (0-5)
    if comparison:
        consistency = comparison.get("consistency_score", 0)
        if consistency >= 0.85:
            a.cross_photo_consistency = 5
        elif consistency >= 0.7:
            a.cross_photo_consistency = 3
        elif consistency >= 0.5:
            a.cross_photo_consistency = 2
    elif hail:
        if hail.get("directional_pattern"):
            a.cross_photo_consistency = 3
    else:
        # Config-only: multiple damage_thresholds components = cross-evidence
        thresholds = forensic.get("damage_thresholds", [])
        exceeded = [t for t in thresholds
                    if isinstance(t, dict) and "exceeded" in str(t.get("result", "")).lower()]
        if len(exceeded) >= 4:
            a.cross_photo_consistency = 5
        elif len(exceeded) >= 3:
            a.cross_photo_consistency = 3
        elif len(exceeded) >= 2:
            a.cross_photo_consistency = 2

    # A5: Aging Freshness (0-3)
    if comparison:
        age_consistency = comparison.get("age_consistency", "")
        age_map = {"consistent": 3, "mostly_consistent": 2, "mixed": 1, "inconsistent": 0}
        a.aging_freshness = age_map.get(age_consistency, 0)
    elif hail and hail.get("age_consistent_with_dol"):
        a.aging_freshness = 3
    else:
        # Config-only: HailTrace + DOL = strong age confirmation
        has_hailtrace = "hailtrace" in all_text or "hail trace" in all_text
        has_dol = bool(forensic.get("date_of_loss") or "date of loss" in all_text)
        if has_hailtrace and has_dol:
            a.aging_freshness = 3
        elif has_hailtrace or has_dol:
            a.aging_freshness = 2
        elif "storm" in all_text:
            a.aging_freshness = 1

    return a


def _extract_hail_size(text: str) -> float:
    """Extract largest hail size mentioned in text (in inches)."""
    # Pattern: X.XX" or X.XX-inch or X.XX inch
    matches = re.findall(r'(\d+\.?\d*)\s*(?:"|inch|in\b)', text)
    sizes = []
    for m in matches:
        try:
            val = float(m)
            if 0.25 <= val <= 5.0:  # Plausible hail size range
                sizes.append(val)
        except ValueError:
            pass
    return max(sizes) if sizes else 0.0


def _score_evidence_cascade(
    config: dict,
    analysis: Optional[dict],
    hail: Optional[dict],
) -> EvidenceCascadeCompleteness:
    """Component B: Evidence Cascade Completeness (0-25 pts)."""
    b = EvidenceCascadeCompleteness()

    forensic = config.get("forensic_findings", {})
    cascade = hail.get("evidence_cascade", {}) if hail else {}
    quality_analyses = (analysis or {}).get("quality_analyses", [])
    all_text = _get_all_text(config)
    line_items = config.get("line_items", [])
    li_text = str(line_items).lower()

    # B1: Environmental Evidence (0-5)
    env = cascade.get("environmental", {})
    if env:
        env_types = sum(1 for v in env.values() if v)
        if env_types >= 3:
            b.environmental_evidence = 5
        elif env_types >= 2:
            b.environmental_evidence = 4
        elif env_types >= 1:
            b.environmental_evidence = 2
    else:
        env_keywords = ["spatter", "splatter", "granule wash", "plant damage",
                        "ground level", "environmental", "dented", "pitted"]
        found = sum(1 for kw in env_keywords if kw in all_text)
        if found >= 3:
            b.environmental_evidence = 5
        elif found >= 2:
            b.environmental_evidence = 4
        elif found >= 1:
            b.environmental_evidence = 2
        # HailTrace is environmental evidence
        if "hailtrace" in all_text or "hail trace" in all_text:
            b.environmental_evidence = max(b.environmental_evidence, 4)

    # B2: Soft Metal Documentation (0-7)
    metals = cascade.get("soft_metals", {})
    if metals:
        metal_count = sum(1 for v in metals.values() if v)
        if metal_count >= 5:
            b.soft_metal_documentation = 7
        elif metal_count >= 3:
            b.soft_metal_documentation = 6
        elif metal_count >= 2:
            b.soft_metal_documentation = 4
        elif metal_count >= 1:
            b.soft_metal_documentation = 2
    else:
        # Count distinct metal types in all text + line items
        combined_text = all_text + " " + li_text
        found = _count_metal_mentions(combined_text)
        if found >= 6:
            b.soft_metal_documentation = 7
        elif found >= 4:
            b.soft_metal_documentation = 6
        elif found >= 3:
            b.soft_metal_documentation = 4
        elif found >= 1:
            b.soft_metal_documentation = 2

    # B3: Chalk Protocol (0-5)
    if quality_analyses:
        chalk_scores = [q.get("chalk_technique", 0) for q in quality_analyses]
        avg_chalk = sum(chalk_scores) / len(chalk_scores) if chalk_scores else 0
        b.chalk_protocol = round(avg_chalk * 5)
    elif hail and hail.get("chalk_protocol_used"):
        b.chalk_protocol = 4
    else:
        if "chalk" in all_text and "circle" in all_text:
            b.chalk_protocol = 4
        elif "chalk" in all_text:
            b.chalk_protocol = 3

    # B4: Directional Pattern (0-5)
    comparison = (analysis or {}).get("photo_comparison", {})
    if comparison and comparison.get("directional_pattern_detected"):
        windward = comparison.get("windward_severity", "")
        leeward = comparison.get("leeward_severity", "")
        if windward and leeward and windward != leeward:
            b.directional_pattern = 5
        else:
            b.directional_pattern = 4
    elif hail and hail.get("directional_pattern"):
        b.directional_pattern = 4
    else:
        # Config-only: check for elevation-specific damage mentions
        elevation_keywords = ["north", "south", "east", "west", "front", "rear",
                              "left", "right", "windward", "leeward", "all elevation"]
        found = sum(1 for kw in elevation_keywords if kw in all_text)
        if found >= 3 or "all elevation" in all_text:
            b.directional_pattern = 5
        elif found >= 2:
            b.directional_pattern = 4
        elif found >= 1:
            b.directional_pattern = 2

    # B5: Roof Test Areas (0-3)
    if quality_analyses:
        test_scores = [q.get("test_squares", 0) for q in quality_analyses]
        has_test = sum(1 for t in test_scores if t > 0)
        if has_test >= 4:
            b.roof_test_areas = 3
        elif has_test >= 2:
            b.roof_test_areas = 2
        elif has_test >= 1:
            b.roof_test_areas = 1
    elif hail and hail.get("test_squares_documented"):
        b.roof_test_areas = 2
    else:
        if "test square" in all_text:
            b.roof_test_areas = 2
        elif "inspection" in all_text and "roof" in all_text:
            b.roof_test_areas = 1

    return b


def _score_soft_metal(config: dict, hail: Optional[dict]) -> SoftMetalCorroboration:
    """Component C: Soft Metal Corroboration (0-20 pts)."""
    c = SoftMetalCorroboration()

    forensic = config.get("forensic_findings", {})
    cascade = hail.get("evidence_cascade", {}) if hail else {}
    metals = cascade.get("soft_metals", {})
    all_text = _get_all_text(config)
    line_items = config.get("line_items", [])
    li_text = str(line_items).lower()
    combined_text = all_text + " " + li_text

    # C1: Component Diversity (0-7)
    if metals:
        metal_types = ["gutters", "downspouts", "window_wraps", "fascia", "vents",
                       "pipe_boots", "drip_edge", "flashing", "ac_unit", "mailbox"]
        found = sum(1 for mt in metal_types if metals.get(mt))
        if found >= 6:
            c.component_diversity = 7
        elif found >= 5:
            c.component_diversity = 6
        elif found >= 3:
            c.component_diversity = 4
        elif found >= 1:
            c.component_diversity = 2
    else:
        found = _count_metal_mentions(combined_text)
        if found >= 6:
            c.component_diversity = 7
        elif found >= 5:
            c.component_diversity = 6
        elif found >= 3:
            c.component_diversity = 4
        elif found >= 1:
            c.component_diversity = 2

    # C2: Dent Volume (0-5)
    dent_count = 0
    if hail:
        dent_count = hail.get("total_soft_metal_dents", 0)
    if dent_count > 0:
        if dent_count >= 50:
            c.dent_volume = 5
        elif dent_count >= 31:
            c.dent_volume = 4
        elif dent_count >= 16:
            c.dent_volume = 3
        elif dent_count >= 6:
            c.dent_volume = 2
        elif dent_count >= 1:
            c.dent_volume = 1
    else:
        # Config-only: infer from soft metal mentions + damage language
        metal_mentions = _count_metal_mentions(combined_text)
        has_dent_language = any(kw in combined_text for kw in
                                ["dent", "dimple", "pitted", "impact", "battered"])
        if metal_mentions >= 4 and has_dent_language:
            c.dent_volume = 4
        elif metal_mentions >= 2 and has_dent_language:
            c.dent_volume = 3
        elif has_dent_language:
            c.dent_volume = 2

    # C3: Size Correlation (0-4)
    if hail:
        if hail.get("size_correlation_with_weather"):
            c.size_correlation = 4
        elif hail.get("consistent_dent_sizes"):
            c.size_correlation = 2
    else:
        # Config-only: HailTrace correlation
        has_hailtrace = "hailtrace" in all_text or "hail trace" in all_text
        hail_size = _extract_hail_size(all_text)
        if has_hailtrace and hail_size > 0:
            c.size_correlation = 4
        elif has_hailtrace:
            c.size_correlation = 3
        elif hail_size > 0:
            c.size_correlation = 2

    # C4: Elevation Coverage (0-4)
    elevations = cascade.get("elevations_with_metal_damage", 0)
    if not elevations and hail:
        elevations = hail.get("elevations_inspected", 0)
    if elevations > 0:
        if elevations >= 4:
            c.elevation_coverage = 4
        elif elevations >= 2:
            c.elevation_coverage = 2
        elif elevations >= 1:
            c.elevation_coverage = 1
    else:
        # Config-only: check for multi-elevation mentions
        elevation_words = ["north", "south", "east", "west", "front", "rear",
                           "all elevation", "every elevation", "four elevation"]
        found = sum(1 for kw in elevation_words if kw in all_text)
        if found >= 4 or "all elevation" in all_text or "every elevation" in all_text:
            c.elevation_coverage = 4
        elif found >= 2:
            c.elevation_coverage = 3
        elif found >= 1:
            c.elevation_coverage = 1

    return c


def _score_documentation(config: dict, analysis: Optional[dict]) -> DocumentationQuality:
    """Component D: Documentation Quality (0-15 pts)."""
    d = DocumentationQuality()

    forensic = config.get("forensic_findings", {})
    photos_found = (analysis or {}).get("photos_found", 0)
    quality_analyses = (analysis or {}).get("quality_analyses", [])
    integrity = config.get("photo_integrity", {})
    all_text = _get_all_text(config)

    # D1: Photo Count (0-4)
    if photos_found == 0:
        # Try total_photos from forensic findings
        total = forensic.get("total_photos", 0)
        if isinstance(total, (int, float)) and total > 0:
            photos_found = int(total)
        else:
            # Try photo_map
            photo_map = config.get("photo_map", {})
            photos_found = len(photo_map)
    if photos_found >= 71:
        d.photo_count = 4
    elif photos_found >= 41:
        d.photo_count = 3
    elif photos_found >= 16:
        d.photo_count = 2
    elif photos_found >= 6:
        d.photo_count = 1

    # D2: Coverage Breadth (0-4)
    if quality_analyses:
        categories = set(q.get("photo_category", "") for q in quality_analyses)
        categories.discard("")
        categories.discard("other")
        d.coverage_breadth = min(4, len(categories))
    else:
        # Count forensic sections present (each = a stage of documentation)
        stages = 0
        if forensic.get("damage_thresholds"):
            stages += 1
        if forensic.get("critical_observations"):
            stages += 1
        if forensic.get("differentiation_table"):
            stages += 1
        if forensic.get("code_violations"):
            stages += 1
        if forensic.get("key_arguments"):
            stages += 1
        if config.get("hail_analysis"):
            stages += 1
        d.coverage_breadth = min(4, stages)

    # D3: Photo Integrity (0-3)
    if integrity:
        flags = integrity.get("critical_flags", 0)
        review_flags = integrity.get("review_flags", 0)
        if flags > 0:
            d.photo_integrity = 0
        elif review_flags > 0:
            d.photo_integrity = 2
        else:
            d.photo_integrity = 3
    else:
        d.photo_integrity = 2  # No fraud check = assume OK but not confirmed

    # D4: Technique (0-4)
    if quality_analyses:
        scores = []
        for q in quality_analyses:
            technique_sum = (
                q.get("chalk_technique", 0) +
                q.get("test_squares", 0) +
                q.get("scale_references", 0) +
                q.get("focus_lighting", 0)
            ) / 4.0
            scores.append(technique_sum)
        avg = sum(scores) / len(scores) if scores else 0
        d.technique = round(avg * 4)
    else:
        technique_points = 0
        if "chalk" in all_text:
            technique_points += 1
        if "test square" in all_text:
            technique_points += 1
        if any(kw in all_text for kw in ["scale", "ruler", "coin", "quarter"]):
            technique_points += 1
        # Professional inspection language = likely good technique
        if any(kw in all_text for kw in ["forensic", "methodology", "cascade", "protocol"]):
            technique_points += 1
        d.technique = min(4, technique_points)

    return d
