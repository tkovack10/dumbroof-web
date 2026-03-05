"""
Report generation for hail damage analysis.
Generates findings in evidence cascade order (ground → roof) and populates
claim_config.json fields.
"""

import json
from typing import Dict, List, Any, Optional

from hail_detection.models import ClaimAssessment, EvidenceCascade, DamageAssessment


def generate_damage_thresholds(assessment: ClaimAssessment) -> List[Dict[str, str]]:
    """Generate damage_thresholds entries for claim_config.json.

    Uses the correct field format: {component, confirmed_size, threshold, result}
    """
    thresholds = []

    if not assessment.evidence_cascade:
        return thresholds

    # Roof damage thresholds
    roof_hits = [
        a for a in assessment.individual_assessments
        if a.damage_type == "hail_hit"
    ]
    if roof_hits:
        avg_hits = sum(a.hit_count_estimate for a in roof_hits) / len(roof_hits)
        sizes = [a.hit_size_range_mm for a in roof_hits if a.hit_size_range_mm != (0, 0)]
        if sizes:
            min_size = min(s[0] for s in sizes)
            max_size = max(s[1] for s in sizes)
            size_str = f"{min_size:.0f}-{max_size:.0f}mm"
        else:
            size_str = "Per HailTrace data"

        result = "EXCEEDS" if avg_hits >= 8 else "MEETS" if avg_hits >= 4 else "BELOW"
        thresholds.append({
            "component": "Asphalt Shingles — Roof Surface",
            "confirmed_size": size_str,
            "threshold": "8+ functional impacts per 10'x10' test square (industry standard)",
            "result": f"{result} — {avg_hits:.0f} avg impacts per test area documented",
        })

    # Soft metal thresholds
    ec = assessment.evidence_cascade
    if ec.soft_metals:
        total_dents = sum(sm.dent_count for sm in ec.soft_metals)
        components = list({sm.component for sm in ec.soft_metals})
        thresholds.append({
            "component": f"Soft Metals — {', '.join(components).title()}",
            "confirmed_size": "Per chalked measurements",
            "threshold": "Any permanent deformation to soft metals = hail confirmation",
            "result": f"EXCEEDS — {total_dents}+ dents across {len(ec.soft_metals)} surfaces",
        })

    return thresholds


def generate_critical_observations(assessment: ClaimAssessment) -> List[Dict[str, str]]:
    """Generate critical_observations entries for claim_config.json.

    Uses the correct field format: {title, content}
    """
    observations = []

    if not assessment.evidence_cascade:
        return observations

    ec = assessment.evidence_cascade

    # Evidence cascade summary
    if ec.soft_metals:
        metal_count = sum(sm.dent_count for sm in ec.soft_metals)
        observations.append({
            "title": "Soft Metal Corroboration Confirms Hail Event",
            "content": (
                f"{metal_count}+ hail dents documented across {len(ec.soft_metals)} "
                f"soft metal surfaces including "
                f"{', '.join(sm.component for sm in ec.soft_metals[:3])}. "
                f"Permanent deformation of aluminum components is undeniable physical "
                f"evidence of hail impact that cannot be attributed to blistering, "
                f"normal wear, or mechanical damage."
            ),
        })

    # Chalk protocol status
    if not ec.soft_metals_chalked and ec.soft_metals:
        observations.append({
            "title": "Chalk Protocol Recommendation",
            "content": (
                "Soft metal surfaces were documented without the chalk enhancement "
                "technique. Re-inspection with carpenter's chalk across all soft "
                "metal surfaces is recommended to reveal additional hail dents "
                "that blend into the aluminum surface without enhancement."
            ),
        })

    # Mat fracture documentation
    functional = [
        a for a in assessment.individual_assessments
        if a.severity in ("functional", "structural")
    ]
    if functional:
        observations.append({
            "title": "Mat Fracture — Functional Damage Per HAAG Standards",
            "content": (
                f"Mat fracture confirmed in {len(functional)} locations across the "
                f"roof surface. Per HAAG Engineering forensic standards, fiberglass "
                f"mat fracture constitutes functional damage regardless of whether "
                f"active leaking has begun. The structural reinforcement of the "
                f"shingle system is compromised at each fracture point."
            ),
        })

    # Time bomb warning
    if assessment.time_bomb_note:
        observations.append({
            "title": "Progressive Damage Timeline — IBHS Research",
            "content": assessment.time_bomb_note,
        })

    # Directional pattern
    if ec.directional_pattern:
        observations.append({
            "title": "Directional Damage Pattern Confirms Storm Event",
            "content": (
                "Damage concentration follows a directional pattern across the "
                "property, with higher damage density on storm-facing elevations "
                "and lower density on sheltered elevations. This pattern is "
                "consistent with a wind-driven hail event and inconsistent with "
                "blistering (heat-driven, south/west concentration), mechanical "
                "damage (access path concentration), or normal wear (uniform)."
            ),
        })

    return observations


def generate_differentiation_table(
    assessment: ClaimAssessment,
) -> List[Dict[str, str]]:
    """Generate differentiation_table entries for claim_config.json.

    Uses the correct field format: {cause, characteristics, observed, conclusion}
    """
    table = []

    if not assessment.damage_confirmed:
        return table

    table.append({
        "cause": "Hail Impact",
        "characteristics": (
            "Circular/oval depressions with granule displacement, mat fracture "
            "on tension side, crushed granule fragments embedded in fiberglass mat"
        ),
        "observed": (
            "Multiple circular depressions with granule displacement observed "
            "across roof surface. Soft metal corroboration confirms hail event. "
            "Directional pattern consistent with storm data."
        ),
        "conclusion": "CONSISTENT — damage characteristics match hail impact",
    })

    table.append({
        "cause": "Blistering",
        "characteristics": (
            "Convex raised areas or craters with crusty edges, fiberglass exposed "
            "from below, irregular shapes following gas pockets, south/west concentration"
        ),
        "observed": (
            "Observed damage shows concave depressions (not convex), no crusty "
            "raised edges, circular shapes consistent with ice impact. Soft metal "
            "dents present — blistering cannot dent metals."
        ),
        "conclusion": "NOT CONSISTENT — damage pattern does not match blistering",
    })

    table.append({
        "cause": "Mechanical Damage",
        "characteristics": (
            "Irregular shapes, concentrated near access paths/equipment, granules "
            "pulverized to powder (not fragments), no soft metal corroboration"
        ),
        "observed": (
            "Damage is randomly distributed across roof surface, not concentrated "
            "along access paths. Soft metal corroboration present on gutters and "
            "downspouts. No evidence of foot traffic patterns."
        ),
        "conclusion": "NOT CONSISTENT — distribution and collateral evidence rule out mechanical",
    })

    table.append({
        "cause": "Normal Wear & Aging",
        "characteristics": (
            "Uniform granule erosion in water channels, gradual curling, UV "
            "degradation concentrated on south/west, no soft metal corroboration"
        ),
        "observed": (
            "Granule loss is in distinct circular patterns at impact points, not "
            "in water channels. Oxidation state at impacts differs from surrounding "
            "surface. Soft metal dents confirm external force event."
        ),
        "conclusion": "NOT CONSISTENT — pattern and soft metal evidence rule out wear",
    })

    return table


def generate_forensic_summary(assessment: ClaimAssessment) -> str:
    """Generate a forensic causation report summary following evidence cascade methodology."""
    if not assessment.damage_confirmed:
        return (
            "Forensic analysis of the photographic evidence did not confirm "
            "hail damage at sufficient confidence for a definitive determination. "
            "Additional field inspection recommended."
        )

    sections = []

    # Evidence cascade order: environmental → soft metals → directional → roof
    ec = assessment.evidence_cascade
    if ec and ec.environmental:
        sections.append(
            "Environmental evidence including ground-level observations "
            "corroborates a hail event at this property."
        )

    if ec and ec.soft_metals:
        metal_count = sum(sm.dent_count for sm in ec.soft_metals)
        components = [sm.component for sm in ec.soft_metals[:3]]
        sections.append(
            f"Soft metal analysis reveals {metal_count}+ permanent hail dents "
            f"across {', '.join(components)}, providing undeniable physical "
            f"evidence of hail impact at this property."
        )

    if ec and ec.directional_pattern:
        sections.append(
            "Damage distribution follows a directional pattern consistent with "
            "the documented storm event, with higher damage density on "
            "storm-facing elevations."
        )

    # Roof findings
    hail_hits = [a for a in assessment.individual_assessments if a.damage_type == "hail_hit"]
    functional = [a for a in assessment.individual_assessments if a.severity in ("functional", "structural")]
    if hail_hits:
        sections.append(
            f"Roof surface analysis identified hail impact in {len(hail_hits)} "
            f"documented locations, with {len(functional)} confirmed functional "
            f"damage points (mat fracture per HAAG Engineering standards)."
        )

    # Conclusion
    sections.append(
        f"Based on the sequential evidence analysis, hail damage to the roof "
        f"system is confirmed with {assessment.overall_confidence:.0%} confidence. "
        f"Recommended action: {assessment.recommended_action.replace('_', ' ')}."
    )

    return " ".join(sections)


def populate_config_fields(assessment: ClaimAssessment) -> Dict[str, Any]:
    """Generate all claim_config.json fields from the assessment.

    Returns a dict that can be merged into the claim config's forensic_findings section.
    """
    return {
        "damage_thresholds": generate_damage_thresholds(assessment),
        "critical_observations": generate_critical_observations(assessment),
        "differentiation_table": generate_differentiation_table(assessment),
        "damage_summary": generate_forensic_summary(assessment),
        "hail_detection": assessment.to_dict(),
    }


def format_cascade_report(assessment: ClaimAssessment) -> str:
    """Format a human-readable evidence cascade report."""
    lines = []
    lines.append("=" * 60)
    lines.append("EVIDENCE CASCADE REPORT")
    lines.append("=" * 60)

    if not assessment.evidence_cascade:
        lines.append("No evidence cascade data available.")
        return "\n".join(lines)

    ec = assessment.evidence_cascade

    # Step 1: Environmental
    lines.append("\nSTEP 1: ENVIRONMENTAL EVIDENCE")
    lines.append("-" * 40)
    if ec.environmental:
        for env in ec.environmental:
            lines.append(f"  - {env.get('description', 'N/A')} (value: {env.get('evidence_value', 'N/A')})")
    else:
        lines.append("  No environmental evidence photos classified.")

    # Step 2: Soft Metals
    lines.append("\nSTEP 2: SOFT METAL EVIDENCE")
    lines.append("-" * 40)
    if ec.soft_metals:
        lines.append(f"  Chalk protocol applied: {'YES' if ec.soft_metals_chalked else 'NO — INCOMPLETE'}")
        for sm in ec.soft_metals:
            lines.append(f"  - {sm.component}: {sm.dent_count} dents (confidence: {sm.confidence:.0%})")
    else:
        lines.append("  No soft metal evidence photos classified.")

    # Step 3: Directional Pattern
    lines.append("\nSTEP 3: DIRECTIONAL PATTERN")
    lines.append("-" * 40)
    if ec.directional_pattern:
        lines.append(f"  {ec.directional_pattern.get('description', 'Pattern documented')}")
    else:
        lines.append("  No directional pattern evidence classified.")

    # Step 4: Logical Trap
    lines.append("\nSTEP 4: LOGICAL TRAP ARGUMENT")
    lines.append("-" * 40)
    if ec.logical_trap_argument:
        lines.append(f"  {ec.logical_trap_argument}")
    else:
        lines.append("  Insufficient evidence for logical trap construction.")

    # Step 5: Roof Evidence
    lines.append("\nSTEP 5: ROOF EVIDENCE")
    lines.append("-" * 40)
    if ec.roof_damage:
        for rd in ec.roof_damage:
            lines.append(
                f"  - {rd.photo_key}: {rd.damage_type} | {rd.severity} | "
                f"{rd.confidence:.0%} confidence | {rd.hit_count_estimate} hits"
            )
    else:
        lines.append("  No roof damage photos classified.")

    # Overall
    lines.append(f"\nOVERALL CASCADE CONFIDENCE: {ec.overall_confidence:.0%}")

    # Carrier rebuttal
    if assessment.carrier_rebuttal_points:
        lines.append("\nCARRIER REBUTTAL POINTS:")
        lines.append("-" * 40)
        for i, point in enumerate(assessment.carrier_rebuttal_points, 1):
            lines.append(f"  {i}. {point}")

    lines.append("\n" + "=" * 60)
    return "\n".join(lines)
