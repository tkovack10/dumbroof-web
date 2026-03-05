"""
Claude Vision prompts for the USARM Dual Score System.
4 specialized prompts for damage scoring and product identification.
"""

SHINGLE_IDENTIFICATION_PROMPT = """You are a roofing materials expert. Analyze this photo to identify the exact shingle product.

Examine carefully:
1. SHINGLE TYPE: 3-tab, architectural/laminate, designer/premium, T-Lock, wood shake, slate, tile, metal
2. MANUFACTURER CLUES: Tab shape, shadow line pattern, granule blend, texture pattern, laminate overlay style
3. EXPOSURE MEASUREMENT (CRITICAL): Measure the exposed portion of each shingle course as precisely as possible.
   Reference values:
   - 5" = Pre-metric standard (both 3-tab AND laminate). Manufactured pre-2000 for 3-tabs, pre-2012 for laminates. UNREPAIRABLE with current products.
   - 5-1/8" = Transitional metric (1980s-1990s). UNREPAIRABLE.
   - 5-5/8" = Current metric industry standard (all major manufacturers).
   - 5-7/8" = IKO "Advantage" size ONLY (Cambridge, Nordic, Dynasty). Incompatible with all other manufacturers.
   - 6" = Atlas variant. Must match with Atlas only.

   THE EXPOSURE IS THE SINGLE MOST IMPORTANT MEASUREMENT. A roof with 5" exposure shingles CANNOT be repaired
   with current 5-5/8" products — nailing zones won't align, sealant strips misalign, and the 5/8" per-course
   offset compounds to 12.5" over 20 courses. This applies to BOTH 3-tab AND laminate/architectural shingles.
   The entire industry transitioned from 36"x12" (5" exposure) to ~39"x13" (5-5/8" exposure).

4. COLOR/BLEND: Describe the color blend precisely (e.g., "weathered wood blend with charcoal and brown granules")
5. AGE INDICATORS: Granule loss level, curling, cupping, color fading, moss/algae, sealant strip condition
6. CONDITION: Overall remaining useful life estimate
7. LAMINATE OVERLAY PATTERN: For architectural shingles, describe the overlay pattern (random, staggered, offset).
   Different product lines have distinct overlay patterns that aid identification.

Respond in JSON:
{
  "shingle_type": "three_tab|architectural|premium_architectural|t_lock|wood_shake|slate|tile|metal|unknown",
  "manufacturer_guess": "manufacturer name or 'unknown'",
  "product_line_guess": "product line name or 'unknown'",
  "exposure_inches": 0.0,
  "exposure_measurement_confidence": "measured|estimated|unable_to_determine",
  "shingle_dimensions_class": "pre_metric_standard|metric|iko_advantage|atlas_variant|unknown",
  "color_description": "description of color/blend",
  "estimated_age_years": 0,
  "condition": "good|fair|poor|end_of_life",
  "granule_loss_pct": 0,
  "discontinuation_likely": true,
  "discontinuation_reason": "reason or empty string",
  "repairability": "unrepairable_exposure_mismatch|unrepairable_discontinued|repairable|limited_repairability|unknown",
  "confidence": 0.0,
  "notes": "any additional observations"
}"""


MULTI_PHOTO_COMPARISON_PROMPT = """You are a forensic hail damage analyst examining multiple photos from the SAME property.

Compare these photos and assess:

1. DAMAGE CONSISTENCY: Is the same type of damage (size, shape, pattern) visible across photos?
2. SIZE CONSISTENCY: Are impact marks approximately the same size across different locations?
3. DIRECTIONAL PATTERN: Can you determine the storm direction from which elevations show more/less damage?
4. SEVERITY GRADIENT: Is damage heavier on windward side and lighter on leeward?
5. AGE CONSISTENCY: Does all damage appear to be from the same time period?
6. ANOMALIES: Any photos that show damage inconsistent with others? (different size, age, or pattern)

For EACH photo, note what it shows (roof surface, soft metal, ground level, etc).

Respond in JSON:
{
  "photos_analyzed": 0,
  "damage_types_observed": ["list of damage types seen"],
  "consistency_score": 0.0,
  "size_range_mm": [0.0, 0.0],
  "directional_pattern_detected": true,
  "storm_direction_estimate": "compass direction or 'unknown'",
  "windward_severity": "none|light|moderate|heavy|severe",
  "leeward_severity": "none|light|moderate|heavy|severe",
  "age_consistency": "consistent|mostly_consistent|mixed|inconsistent",
  "anomalies": ["list of anomalies or empty"],
  "cross_photo_confidence": 0.0,
  "notes": "summary observation"
}"""


SCORING_SEVERITY_DEEP_PROMPT = """You are a forensic roofing analyst using the USARM 7-level severity scale.

Analyze this photo and classify the damage precisely:

SEVERITY LEVELS (pick the HIGHEST confirmed level):
1. COSMETIC-MINOR (score: 3): Surface scuffs, very light granule displacement, no depression
2. COSMETIC-MODERATE (score: 5): Visible granule loss, light bruising, minor depressions
3. COSMETIC-SEVERE (score: 7): Significant granule loss pattern, clear depressions, but mat intact
4. FUNCTIONAL-EARLY (score: 9): Mat beginning to show, waterproofing layer compromised in spots
5. FUNCTIONAL-CONFIRMED (score: 10): Mat exposed, waterproofing clearly compromised
6. FUNCTIONAL-SEVERE (score: 11): Mat fractured/torn, immediate water intrusion risk
7. STRUCTURAL (score: 12): Through-shingle damage, deck visible, active leak path

Also assess:
- GRANULE LOSS %: What percentage of granules are displaced in the impact area?
- DEPRESSION METHOD: Can you see depression visually? Would a fingertip test likely confirm?
- FIBER/MAT EXPOSURE: Is the fiberglass mat visible?
- WATERPROOFING STATUS: Is the asphalt waterproofing layer intact?
- REMAINING LIFE: How many years of useful life remain at this damage level?

Respond in JSON:
{
  "severity_level": "cosmetic_minor|cosmetic_moderate|cosmetic_severe|functional_early|functional_confirmed|functional_severe|structural",
  "severity_score": 0,
  "granule_loss_pct": 0,
  "depression_visible": true,
  "depression_depth_estimate_mm": 0.0,
  "mat_exposed": false,
  "waterproofing_compromised": false,
  "remaining_life_years": 0,
  "hit_count_visible": 0,
  "hit_size_mm": 0.0,
  "confidence": 0.0,
  "notes": "additional observations"
}"""


DOCUMENTATION_QUALITY_PROMPT = """You are evaluating the QUALITY of this inspection photo (not the damage itself).

Rate each technique element:

1. CHALK TECHNIQUE: Was chalk used to circle damage? Are circles clear and properly sized?
   - 0.0 = no chalk
   - 0.3 = chalk present but poorly applied
   - 0.7 = clear chalk circles on most impacts
   - 1.0 = professional chalk technique with scale reference

2. TEST SQUARES: Is this a defined test area? Is the area marked off?
   - 0.0 = no test square
   - 0.5 = informal test area
   - 1.0 = properly marked test square

3. SCALE REFERENCES: Is there a coin, ruler, or other scale reference for size?
   - 0.0 = no scale reference
   - 0.5 = scale reference present but not next to damage
   - 1.0 = scale reference properly placed next to impacts

4. FOCUS/LIGHTING: Is the image sharp and well-lit?
   - 0.0 = blurry or dark
   - 0.5 = acceptable
   - 1.0 = professional quality, sharp focus, good lighting

5. FRAMING: Does the photo show appropriate context?
   - 0.0 = too close or too far, can't assess properly
   - 0.5 = adequate framing
   - 1.0 = optimal framing showing both detail and context

Respond in JSON:
{
  "chalk_technique": 0.0,
  "test_squares": 0.0,
  "scale_references": 0.0,
  "focus_lighting": 0.0,
  "framing": 0.0,
  "overall_quality": 0.0,
  "photo_category": "roof_surface|soft_metal|ground_level|overview|interior|other",
  "notes": "observations about photo quality"
}"""
