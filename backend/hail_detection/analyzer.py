"""
Core hail damage analysis engine using Claude Vision API.
No ML training required — immediately deployable, ~$0.18 per full claim analysis.
"""

import base64
import json
import os
import re
from pathlib import Path
from typing import List, Optional

import anthropic

from hail_detection.models import (
    DamageAssessment,
    SoftMetalFinding,
    EvidenceCascade,
    DifferentiationReport,
    ClaimAssessment,
)
from hail_detection.prompts import (
    DAMAGE_DETECTION_PROMPT,
    DIFFERENTIATION_PROMPT,
    SEVERITY_ASSESSMENT_PROMPT,
    AGING_ANALYSIS_PROMPT,
    EVIDENCE_CASCADE_PROMPT,
    CHALK_CHECK_PROMPT,
)

MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4096


def _encode_image(image_path: str) -> tuple:
    """Read and base64-encode an image file. Returns (base64_data, media_type)."""
    path = Path(image_path)
    suffix = path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    media_type = media_types.get(suffix, "image/jpeg")
    with open(path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode("utf-8")
    return data, media_type


def _parse_json_response(text: str) -> dict:
    """Extract JSON from Claude's response, handling markdown code blocks."""
    # Try to find JSON in code blocks first
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        text = match.group(1)
    # Try direct JSON parse
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find first { ... } block
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            return json.loads(text[start : end + 1])
        return {}


def _call_vision(client: anthropic.Anthropic, image_path: str, prompt: str,
                  sb=None, claim_id: str = None, step_name: str = "hail_vision") -> dict:
    """Send an image to Claude Vision and parse JSON response."""
    img_data, media_type = _encode_image(image_path)
    kwargs = dict(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": img_data,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    # Use telemetry if Supabase client available
    if sb:
        try:
            from telemetry import call_claude_logged
            response = call_claude_logged(client, sb, claim_id, step_name=step_name, **kwargs)
            return _parse_json_response(response.content[0].text)
        except ImportError:
            pass
    response = client.messages.create(**kwargs)
    return _parse_json_response(response.content[0].text)


class HailDamageAnalyzer:
    """Claude Vision-powered hail damage analysis engine."""

    def __init__(self, api_key: Optional[str] = None):
        self.client = anthropic.Anthropic(
            api_key=api_key or os.environ.get("ANTHROPIC_API_KEY")
        )

    def analyze_photo(self, image_path: str) -> DamageAssessment:
        """Analyze a single photo for hail damage."""
        result = _call_vision(self.client, image_path, DAMAGE_DETECTION_PROMPT)
        photo_key = Path(image_path).stem
        return DamageAssessment(
            damage_type=result.get("damage_type", "none"),
            confidence=result.get("confidence", 0.0),
            severity=result.get("severity", "cosmetic"),
            hit_count_estimate=result.get("hit_count_estimate", 0),
            hit_size_range_mm=tuple(result.get("hit_size_range_mm", [0, 0])),
            evidence=result.get("evidence", []),
            differentiation=result.get("differentiation", {}),
            photo_key=photo_key,
            file_path=str(image_path),
        )

    def differentiate_damage(self, image_path: str) -> DifferentiationReport:
        """Run 12-point differentiation: hail vs. blister vs. mechanical vs. wear."""
        result = _call_vision(self.client, image_path, DIFFERENTIATION_PROMPT)
        photo_key = Path(image_path).stem
        return DifferentiationReport(
            conclusion=result.get("conclusion", "inconclusive"),
            hail_indicators=result.get("hail_indicators", []),
            blister_indicators=result.get("blister_indicators", []),
            mechanical_indicators=result.get("mechanical_indicators", []),
            wear_indicators=result.get("wear_indicators", []),
            confidence=result.get("confidence", 0.0),
            reasoning=result.get("reasoning", ""),
            photo_key=photo_key,
        )

    def check_chalk_protocol(self, image_path: str) -> dict:
        """Check if soft metals in photo have been properly chalked."""
        result = _call_vision(self.client, image_path, CHALK_CHECK_PROMPT)
        return result

    def classify_evidence_stage(self, image_path: str) -> dict:
        """Classify a photo into the evidence cascade stage."""
        result = _call_vision(self.client, image_path, EVIDENCE_CASCADE_PROMPT)
        return result

    def assess_severity(self, image_path: str) -> dict:
        """Assess damage severity: cosmetic vs. functional vs. structural."""
        result = _call_vision(self.client, image_path, SEVERITY_ASSESSMENT_PROMPT)
        return result

    def estimate_damage_age(self, image_path: str) -> dict:
        """Estimate the age of hail damage from oxidation and spatter analysis."""
        result = _call_vision(self.client, image_path, AGING_ANALYSIS_PROMPT)
        return result

    def analyze_claim(self, photo_dir: str) -> ClaimAssessment:
        """Analyze all photos in a claim directory. Full claim assessment."""
        photo_dir = Path(photo_dir)
        claim_slug = photo_dir.parent.name if photo_dir.name == "photos" else photo_dir.name

        # Find all photos
        extensions = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
        photos = sorted(
            p for p in photo_dir.iterdir()
            if p.is_file() and p.suffix.lower() in extensions
            and not p.name.startswith(".")
            and "logo" not in p.name.lower()
            and "banner" not in p.name.lower()
        )

        if not photos:
            return ClaimAssessment(
                claim_slug=claim_slug,
                photos_analyzed=0,
                damage_confirmed=False,
                damage_type="none",
                overall_confidence=0.0,
                severity="none",
                recommended_action="no_photos_found",
            )

        print(f"  Analyzing {len(photos)} photos in {photo_dir}...")

        # Phase 1: Classify each photo into evidence cascade stage
        assessments = []
        cascade_stages = {"environmental": [], "soft_metal": [], "directional": [], "roof": [], "overview": []}
        chalk_flags = []

        for i, photo in enumerate(photos):
            print(f"    [{i + 1}/{len(photos)}] {photo.name}...", end=" ", flush=True)

            # Classify into cascade stage
            stage_result = self.classify_evidence_stage(str(photo))
            stage = stage_result.get("cascade_stage", "overview")

            # Run damage detection on roof and soft metal photos
            if stage in ("roof", "soft_metal"):
                assessment = self.analyze_photo(str(photo))
                assessments.append(assessment)
                cascade_stages[stage].append(assessment)

                # Check chalk on soft metal photos
                if stage == "soft_metal":
                    chalk_result = self.check_chalk_protocol(str(photo))
                    chalk_flags.append(chalk_result)
                    if chalk_result.get("is_soft_metal_photo") and not chalk_result.get("chalk_applied"):
                        print("(soft metal — NO CHALK)", end=" ")

                print(f"→ {assessment.damage_type} ({assessment.confidence:.0%})")
            else:
                cascade_stages[stage].append(stage_result)
                print(f"→ {stage}")

        # Phase 2: Build evidence cascade
        evidence_cascade = self._build_evidence_cascade(cascade_stages, chalk_flags)

        # Phase 3: Aggregate results
        hail_assessments = [a for a in assessments if a.damage_type == "hail_hit"]
        damage_confirmed = len(hail_assessments) >= 2 or (
            len(hail_assessments) >= 1 and evidence_cascade.overall_confidence >= 0.6
        )

        if assessments:
            avg_confidence = sum(a.confidence for a in assessments) / len(assessments)
        else:
            avg_confidence = 0.0

        # Determine severity (highest across all assessments)
        severity_order = {"structural": 3, "functional": 2, "cosmetic": 1}
        if assessments:
            severity = max(assessments, key=lambda a: severity_order.get(a.severity, 0)).severity
        else:
            severity = "none"

        # Determine recommended action
        functional_count = sum(1 for a in assessments if a.severity in ("functional", "structural"))
        if functional_count >= 3:
            recommended_action = "full_replacement"
        elif functional_count >= 1:
            recommended_action = "slope_replacement"
        elif hail_assessments:
            recommended_action = "spot_repair"
        else:
            recommended_action = "monitor"

        # Generate carrier rebuttal points
        rebuttal_points = self._generate_carrier_rebuttal(evidence_cascade, assessments)

        # Time bomb note
        if damage_confirmed and severity in ("functional", "cosmetic"):
            time_bomb = (
                "Hail damage documented at this property will progress to water intrusion "
                "within 1-3 years as loosened granules wash away, exposing asphalt to UV "
                "degradation. Per IBHS, damaged shingles are 10x more susceptible to "
                "failure from subsequent storms."
            )
        else:
            time_bomb = ""

        return ClaimAssessment(
            claim_slug=claim_slug,
            photos_analyzed=len(photos),
            damage_confirmed=damage_confirmed,
            evidence_cascade=evidence_cascade,
            damage_type="hail" if damage_confirmed else ("inconclusive" if hail_assessments else "none"),
            overall_confidence=avg_confidence,
            severity=severity,
            recommended_action=recommended_action,
            carrier_rebuttal_points=rebuttal_points,
            time_bomb_note=time_bomb,
            individual_assessments=assessments,
        )

    def _build_evidence_cascade(
        self, stages: dict, chalk_flags: list
    ) -> EvidenceCascade:
        """Build the evidence cascade from classified photos."""
        # Environmental evidence
        environmental = []
        for item in stages.get("environmental", []):
            if isinstance(item, dict):
                environmental.append({
                    "description": item.get("description", ""),
                    "evidence_value": item.get("evidence_value", "medium"),
                })

        # Soft metals
        soft_metals = []
        any_chalked = False
        for item in stages.get("soft_metal", []):
            if isinstance(item, DamageAssessment):
                finding = SoftMetalFinding(
                    component=item.differentiation.get("component", "unknown"),
                    elevation="",
                    chalked=False,
                    dent_count=item.hit_count_estimate,
                    confidence=item.confidence,
                    photo_key=item.photo_key,
                )
                soft_metals.append(finding)

        for chalk in chalk_flags:
            if chalk.get("chalk_applied"):
                any_chalked = True

        # Directional pattern
        directional = {}
        for item in stages.get("directional", []):
            if isinstance(item, dict):
                directional["description"] = item.get("description", "")

        # Roof damage
        roof_damage = [a for a in stages.get("roof", []) if isinstance(a, DamageAssessment)]

        # Calculate overall confidence
        evidence_points = 0
        if environmental:
            evidence_points += 1
        if soft_metals:
            evidence_points += 2
        if any_chalked:
            evidence_points += 1
        if directional:
            evidence_points += 1
        if roof_damage:
            evidence_points += 2
        overall = min(evidence_points / 7.0, 1.0)

        # Build logical trap argument
        logical_trap = ""
        if soft_metals and roof_damage:
            metal_count = sum(sm.dent_count for sm in soft_metals)
            logical_trap = (
                f"Soft metal evidence confirms hail occurrence: {metal_count}+ dents "
                f"documented across {len(soft_metals)} soft metal surfaces. "
                f"The carrier cannot credibly deny roof damage while acknowledging "
                f"hail struck metals 8 feet below the roof surface."
            )

        return EvidenceCascade(
            environmental=environmental,
            soft_metals=soft_metals,
            soft_metals_chalked=any_chalked,
            directional_pattern=directional,
            roof_damage=roof_damage,
            logical_trap_argument=logical_trap,
            overall_confidence=overall,
        )

    def _generate_carrier_rebuttal(
        self, cascade: EvidenceCascade, assessments: list
    ) -> List[str]:
        """Auto-generate carrier rebuttal points from evidence."""
        points = []

        # Soft metal corroboration
        if cascade.soft_metals:
            metal_count = sum(sm.dent_count for sm in cascade.soft_metals)
            components = list({sm.component for sm in cascade.soft_metals})
            points.append(
                f"Soft metal corroboration: {metal_count}+ hail dents documented on "
                f"{', '.join(components)}. Soft metal damage is undeniable physical "
                f"evidence of hail that cannot be attributed to blistering, wear, or "
                f"mechanical damage."
            )

        # Directional pattern
        if cascade.directional_pattern:
            points.append(
                "Directional damage pattern documented across the property, "
                "consistent with a storm event and inconsistent with random wear, "
                "blistering, or mechanical damage."
            )

        # Mat fracture count
        functional = [a for a in assessments if a.severity in ("functional", "structural")]
        if functional:
            points.append(
                f"Mat fracture (functional damage per HAAG Engineering standards) "
                f"confirmed in {len(functional)} locations. Per HAAG, mat fracture "
                f"constitutes functional damage requiring replacement."
            )

        # Logical trap
        if cascade.logical_trap_argument:
            points.append(cascade.logical_trap_argument)

        # IBHS time bomb
        hail_hits = [a for a in assessments if a.damage_type == "hail_hit"]
        if hail_hits:
            points.append(
                "Per IBHS (2025), damaged shingles are 10x more susceptible to "
                "functional failure from subsequent storms. Repeated sub-severe "
                "hail exposure causes a decade of equivalent aging in 2 years. "
                "Leaving documented hail damage unrepaired creates compounding "
                "degradation risk."
            )

        # Chalk protocol
        if not cascade.soft_metals_chalked and cascade.soft_metals:
            points.append(
                "NOTE: Soft metal surfaces were documented without chalk protocol. "
                "Re-inspection with chalk is recommended to reveal additional dents "
                "that blend into the metal surface."
            )

        return points
