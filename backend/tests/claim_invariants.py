"""Outcome / invariant prevention gate — a library of pure CHECKS over a claim
config and/or its rendered documents.

WHY THIS EXISTS
---------------
The golden-corpus snapshot gate (test_golden_forensic_corpus.py) proves the
forensic renderer is BYTE-STABLE — it catches *changes*. It does NOT catch a
defect that was *already baked into* a committed fixture: if a fixture renders a
TX claim with cold-climate ice-dam text, the snapshot is happily stable AND
wrong. These invariants are the complementary gate: they assert PROPERTIES that
must hold of EVERY claim regardless of snapshot, so a latent defect in a fixture
(or a future claim) surfaces as a violation instead of hiding inside a stable
snapshot.

Each public ``check_*`` function:
  * takes exactly what it needs (a config, and/or already-rendered doc HTML),
  * returns a ``list[str]`` of human-readable violation strings,
  * returns ``[]`` when the invariant holds.

One check per BUG CLASS. The checks deliberately REUSE the production source of
truth (building_codes.lookup, carrier_analyst._implausible_area,
compliance_report.has_measurements) rather than re-implementing constants — an
invariant that re-derives the rule it is policing can drift away from the code
it guards.

Bug classes codified here (from the live-claim QA + retrospective wmu9udhcr):
  E272  TENANT-IDENTITY        check_tenant_identity_leak
  E269  CLIMATE-TEXT-VS-STATE  check_climate_text_vs_state
  #7/E275 TAX-VS-STATE         check_tax_vs_state
  E273  CARRIER-UNDERSCOPE     check_carrier_underscope_area
  #4    MATERIAL-SELF-CONSIST  check_material_self_consistency
  #6    HAIL-ONLY-WITH-NOAA    check_hail_only_with_noaa

DEFERRED (the other shell is fixing this in processor.py right now — adding the
invariant now would assert PRE-fix behavior and fight that work):
  E271  grade-tier (shingle grade -> pricing)
Add its invariant here once that fix lands.

NOTE ON E275: the live-QA's E275 turned out to be the sales-tax bug (the
_tax_rates dict missing TX -> the flat NY 8% default leaked onto non-NY claims),
NOT the "null-state config assembly" originally hypothesized. It shipped on main
(#91) and is GUARDED above as #7/E275 TAX-VS-STATE. Null-state config ASSEMBLY (a
config reaching the renderer with no resolved state) is a processor.py concern,
not an output invariant — left to that layer.

Self-contained — stdlib only. Import and call; or run the battery via
test_claim_invariants.py.
"""

from __future__ import annotations

import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

# ── Production source-of-truth seams (reused, NOT re-implemented) ──────────
from building_codes import lookup as _bc_lookup          # noqa: E402
import compliance_report as _compliance_report           # noqa: E402  (has_measurements)
import carrier_analyst as _carrier_analyst               # noqa: E402  (_implausible_area)
import usarm_pdf_generator as _gen                       # noqa: E402  (material_enum resolver)


# ══════════════════════════════════════════════════════════════════════════
# Module constants
# ══════════════════════════════════════════════════════════════════════════

# E272 — USARM platform identities that must NEVER appear on a non-USARM
# tenant's rendered document. The platform owner + the gated USARM inspector.
USARM_IDENTITY_NAMES = (
    "Tom Kovack Jr.",
    "Zach Roberts",
)

# A company is the USARM tenant itself (USARM identities are LEGAL there) when
# its name carries either of these markers — mirrors the gate in
# usarm_pdf_generator.build_forensic_report (line ~1947).
_USARM_COMPANY_MARKERS = ("usa roof masters", "usarm")

# E269 — cold-climate ice-barrier justification literals. These encode an
# IRC Climate-Zone-5A+ ("January <=25F", "ice dam at eaves") code MANDATE that
# is only TRUE in cold states. In a warm state the SAME I&W requirement must be
# reframed onto the manufacturer-installation-as-code basis (R905.1), so these
# literals must be ABSENT. Mirrors COLD_LITERALS in
# test_climate_gate_ice_barrier.py + processor._build_code_violations.
COLD_CLIMATE_TEXT_MARKERS = (
    "OH/NY",
    "Climate Zones 5A",
    "Climate Zone 5A",
    "R905.2.7.1",
)
# The warm-state manufacturer reframe marker (R905.1, NOT R905.1.2 / R905.2.7.1).
WARM_MANUFACTURER_REFRAME_MARKER = "R905.1"

# #4 — roof-SURFACE material self-consistency is judged from the STRUCTURAL
# source of truth (the canonical roof_material_enum + the human shingle_type
# label per structure), NOT from prose. A forensic report legitimately mentions
# several materials in prose — HAAG methodology boilerplate ("hail damage to
# asphalt shingles is identified by…"), metal SIDING, rooftop-HVAC metal
# housings, AND genuine multi-structure dual-system properties (metal main +
# shingle lower). A bare text co-occurrence of "metal" + "asphalt" is therefore
# NOT a contradiction. The real bug class is a SINGLE surface that asserts two
# contradictory primary coverings — which lives in the structural fields.
#
# Map of canonical enum -> the material FAMILY it belongs to. A contradiction is
# two DIFFERENT families asserted for the SAME structure (or a config-level enum
# that disagrees with its lone structure / its own shingle_type label).
_ASPHALT_FAMILY_ENUMS = {"3tab", "laminate"}
_METAL_FAMILY_ENUMS = {"metal"}
# Human shingle_type label tokens that DECLARE a family (used to cross-check the
# resolved enum on the SAME structure). Token -> family.
_LABEL_FAMILY_TOKENS = {
    "asphalt": "asphalt", "laminate": "asphalt", "laminated": "asphalt",
    "architectural": "asphalt", "3-tab": "asphalt", "3 tab": "asphalt",
    "composition": "asphalt", "comp shingle": "asphalt",
    "standing seam": "metal", "metal roof": "metal", "r-panel": "metal",
    "corrugated": "metal", "galvalume": "metal",
    "slate": "slate", "tile": "tile",
}
_ENUM_FAMILY = {
    "3tab": "asphalt", "laminate": "asphalt", "metal": "metal",
    "slate": "slate", "tile": "tile",
    # "other" is intentionally NOT a family — it's the flat/unknown catch-all and
    # must never trigger a contradiction.
}

# #6 — hail-damage language markers. A bare occurrence is NOT enough — the
# generic scaffolding in _HAIL_BOILERPLATE_PATTERNS is stripped first, so only a
# CAUSAL assertion (in prose / photo findings) survives to be matched.
_HAIL_DAMAGE_PHRASES = (
    "hail damage",
    "hail impact",
    "hail strike",
    "hailstone",
    "hail bruis",       # bruise / bruising
    "hail-caused",
    "caused by hail",
    "hail event",
)
# NOAA proximity window: a hail event within this radius counts as "at/near the
# property". Mirrors how the forensic report cites near-property NOAA events.
_NOAA_HAIL_RADIUS_MILES = 15.0

# Generic SCAFFOLDING fragments that CONTAIN a hail token but are TEMPLATE
# boilerplate — definitional criteria and table labels, NOT a causal assertion
# that THIS loss was caused by hail. They render in (nearly) EVERY forensic
# report regardless of the actual peril, so a raw prose scan trips on them: the
# IN-wind and PA fixtures carry NO hail finding yet both rendered the HAAG
# "Damage Criteria" line. These spans are stripped BEFORE the causal-phrase scan
# — the SAME lesson #4 learned (do not treat template prose as a substantive
# assertion; anchor on the claim-specific signal). Sources in usarm_pdf_generator:
#   1. _build_damage_criteria — "…hail damage to <material> … is identified by:"
#      (asphalt / standing-seam-metal / natural-slate / tile variants)
#   2. the "Hail Damage Threshold vs. Product Age" chart label (+ the NOAA
#      threshold line "… EXCEEDED — N.Nx threshold Hail Damage Threshold …")
#   3. the Damage-Differentiation grid's generic "Hail Impact" potential-cause
#      row + its definitional Expected-Characteristics cell. (The grid's
#      claim-specific Observed?/Conclusion cells are NOT scrubbed.)
_HAIL_BOILERPLATE_PATTERNS = (
    re.compile(r"hail(?:\s+and\s+wind)?\s+damage\s+to\s+[^.]*?\bis identified by", re.I),
    re.compile(r"hail damage threshold", re.I),
    re.compile(r"hail impact\s+circular\s*/?\s*oval depressions[^.]*?denting", re.I),
)


def _strip_hail_boilerplate(text: str) -> str:
    """Remove generic hail SCAFFOLDING (definitional criteria + table labels) so
    the causal-phrase scan sees only claim-specific narrative. Each removed span
    appears in reports of every peril; a genuine causal assertion ("hail damage
    documented at this property", "attributable to the reported hail event")
    survives untouched."""
    out = text or ""
    for pat in _HAIL_BOILERPLATE_PATTERNS:
        out = pat.sub(" ", out)
    return out


# ══════════════════════════════════════════════════════════════════════════
# Small helpers
# ══════════════════════════════════════════════════════════════════════════

def _state_of(config: dict) -> str:
    return ((config.get("property") or {}).get("state") or "").strip()


def _company_name(config: dict) -> str:
    return ((config.get("company") or {}).get("name") or "").strip()


def is_usarm_tenant(config: dict) -> bool:
    """True when the claim belongs to the USARM tenant itself (USARM identities
    are legitimate). Mirrors the company-name gate in build_forensic_report."""
    name = _company_name(config).lower()
    return any(marker in name for marker in _USARM_COMPANY_MARKERS)


def _present_phrases(haystack: str, phrases) -> list:
    low = (haystack or "").lower()
    return [p for p in phrases if p.lower() in low]


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _visible_text(html: str) -> str:
    """Flatten rendered HTML to visible text (drop tags, collapse whitespace).

    Phrase scans run against this, not the raw markup, so a substring can't be
    split by an injected ``<strong>`` (the renderer bolds forensic terms inside
    table cells) and boilerplate scrubbing sees one clean run of prose.
    """
    return _WS_RE.sub(" ", _TAG_RE.sub(" ", html or "")).strip()


# ══════════════════════════════════════════════════════════════════════════
# E272 — TENANT-IDENTITY
# ══════════════════════════════════════════════════════════════════════════

def check_tenant_identity_leak(config: dict, rendered_html: str) -> list[str]:
    """A non-USARM tenant's rendered document must contain NO USARM platform
    identity (the owner "Tom Kovack Jr." or the gated inspector "Zach Roberts").

    USARM's own claims are exempt — those names are legitimate there.
    """
    if is_usarm_tenant(config):
        return []  # USARM identities are legal on USARM's own docs
    violations = []
    for name in USARM_IDENTITY_NAMES:
        if name in (rendered_html or ""):
            violations.append(
                f"E272 TENANT-IDENTITY: USARM identity '{name}' leaked onto "
                f"non-USARM tenant '{_company_name(config) or '<blank>'}'"
            )
    return violations


# ══════════════════════════════════════════════════════════════════════════
# E269 — CLIMATE-TEXT-VS-STATE
# ══════════════════════════════════════════════════════════════════════════

def check_climate_text_vs_state(config: dict, rendered_html: str) -> list[str]:
    """Cold-climate ice-barrier code-mandate text may appear ONLY when
    ``is_ice_barrier_code_mandated(state)`` is True (a genuine IRC Zone-5A+
    state). In a warm state those literals must be ABSENT — the SAME I&W
    requirement is reframed onto the manufacturer-installation basis (R905.1).

    Reads the production climate gate (building_codes.lookup) so the invariant
    and the renderer share one source of truth.
    """
    state = _state_of(config)
    if not state:
        return []  # state-resolution is E275 (deferred) — don't assert here
    mandated = _bc_lookup.is_ice_barrier_code_mandated(state)
    if mandated:
        return []  # cold state: the cold-climate text is correct
    leaked = _present_phrases(rendered_html, COLD_CLIMATE_TEXT_MARKERS)
    if leaked:
        return [
            f"E269 CLIMATE-TEXT-VS-STATE: warm state {state} "
            f"(is_ice_barrier_code_mandated=False) but rendered doc carries "
            f"cold-climate ice-dam marker(s) {leaked}; the warm reframe should "
            f"cite the manufacturer-installation basis ({WARM_MANUFACTURER_REFRAME_MARKER}) instead"
        ]
    return []


# ══════════════════════════════════════════════════════════════════════════
# #7 / E275 — TAX-VS-STATE
# ══════════════════════════════════════════════════════════════════════════

# The flat NY default that leaked onto non-NY claims (the E275 signature).
_NY_DEFAULT_TAX_RATE = 0.08


def check_tax_vs_state(config: dict) -> list[str]:
    """The Doc-02 estimate ``financials.tax_rate`` must match the claim's state.

    The sharp, non-brittle invariant (the E275 signature): a NON-NY claim must
    never carry the flat NY 8% default. NY itself is exempt (its modeled rate IS
    0.08). For non-NY states we additionally check the rate against the modeled
    state rate from ``building_codes.lookup.get_sales_tax`` (the production
    source) — allowing a higher local rate, but flagging the exact NY default
    or a rate that EXCEEDS what the state would ever charge.
    """
    state = _state_of(config)
    if not state:
        return []  # null state is E275 (deferred)
    fin = config.get("financials") or {}
    if "tax_rate" not in fin:
        return []  # no estimate tax to police
    rate = fin.get("tax_rate")
    try:
        rate = float(rate)
    except (TypeError, ValueError):
        return [f"#7/E275 TAX-VS-STATE: non-numeric tax_rate {rate!r} for {state}"]

    if state.upper() == "NY":
        return []  # NY's real rate is the 8% default — exempt

    violations = []
    # (1) The exact E275 signature: the flat NY default on a non-NY claim.
    if abs(rate - _NY_DEFAULT_TAX_RATE) < 1e-9:
        violations.append(
            f"#7/E275 TAX-VS-STATE: non-NY claim ({state}) carries the flat NY "
            f"8% default tax_rate (0.08) — sales tax is not state-aware"
        )
        return violations  # the 8% leak is the headline; one message is enough
    # (2) A rate that exceeds what the modeled state base rate could justify.
    #     (Local add-ons are real, so allow a generous margin above the base.)
    state_base = _bc_lookup.get_sales_tax(state)
    if rate > state_base + 0.03 + 1e-9:
        violations.append(
            f"#7/E275 TAX-VS-STATE: {state} tax_rate {rate:.4f} far exceeds the "
            f"modeled state base {state_base:.4f} (+local) — likely a wrong-state rate"
        )
    return violations


# ══════════════════════════════════════════════════════════════════════════
# E273 — CARRIER-UNDERSCOPE
# ══════════════════════════════════════════════════════════════════════════

def measured_roof_sf_from_config(config: dict) -> float:
    """Resolve the measured roof area (SF) from a config, GATED on the production
    ``compliance_report.has_measurements`` (the same yes/no the PDF path uses).
    Returns 0.0 when the config has no usable measurements — in which case the
    E273 invariant abstains (a 0 denominator was the E273 root cause itself; we
    must not invent one)."""
    if not config or not _compliance_report.has_measurements(config):
        return 0.0
    m = config.get("measurements") or {}
    # Mirror carrier_analyst._build_ground_truth's canonical-first resolution.
    area_sf = (
        float(m.get("total_roof_area_sf") or 0)
        or (float(m.get("total_roof_area_sq") or 0) * 100)
        or sum(float(s.get("roof_area_sf", 0) or 0) for s in (config.get("structures") or []) if isinstance(s, dict))
        or sum(float(s.get("roof_area_sq", 0) or 0) for s in (config.get("structures") or []) if isinstance(s, dict)) * 100
        or float(m.get("total_area") or 0) * (100 if float(m.get("total_area") or 0) < 1000 else 1)
    )
    return float(area_sf or 0)


def check_carrier_underscope_area(carrier_analyst_result: dict,
                                  measured_roof_sf: float = None,
                                  config: dict = None) -> list[str]:
    """Any carrier-analyst "underscope area" must be <= the measured roof area
    (never the sum of distinct same-surface SQ line items).

    Reuses the PRODUCTION detector ``carrier_analyst._implausible_area`` (same
    1.3x waste/overlap tolerance) over every text surface the analyst emits, so
    the invariant fires on exactly what the production guard considers phantom.

    Provide EITHER ``measured_roof_sf`` directly, OR a ``config`` (the roof area
    is then resolved via ``measured_roof_sf_from_config``, gated on the
    production ``has_measurements``).
    """
    if not carrier_analyst_result:
        return []
    if measured_roof_sf is None:
        measured_roof_sf = measured_roof_sf_from_config(config or {})
    roof_sf = float(measured_roof_sf or 0)
    roof_sq = round(roof_sf / 100.0, 2)
    if roof_sf <= 0 and roof_sq <= 0:
        return []  # no denominator — E273 root cause was a 0 area; can't judge text

    violations = []

    def _scan(label: str, text: str) -> None:
        hit = _carrier_analyst._implausible_area(text or "", roof_sq, roof_sf)
        if hit:
            val, unit, limit = hit
            violations.append(
                f"E273 CARRIER-UNDERSCOPE: {label} cites {val} {unit} > measured "
                f"roof {limit} {unit} — phantom additive-area underscope "
                f"(distinct same-surface line items summed)"
            )

    for i, tactic in enumerate(carrier_analyst_result.get("tactics_found") or []):
        if not isinstance(tactic, dict):
            continue
        _scan(
            f"tactic[{i}] '{tactic.get('tactic', '?')}'",
            f"{tactic.get('detail', '')} {tactic.get('counter_argument', '')}",
        )
    _scan(
        "overall_assessment/supplement_priority",
        str(carrier_analyst_result.get("overall_assessment", "")) + " "
        + " ".join(str(x) for x in (carrier_analyst_result.get("supplement_priority") or [])),
    )
    return violations


# ══════════════════════════════════════════════════════════════════════════
# #4 — MATERIAL-SELF-CONSISTENCY
# ══════════════════════════════════════════════════════════════════════════

def _label_family(label: str):
    """Resolve the material FAMILY declared by a human shingle_type label
    (asphalt|metal|slate|tile), or None if the label declares nothing
    family-specific. Longest token first so 'standing seam metal' -> metal."""
    low = (label or "").lower()
    found = None
    for token, fam in sorted(_LABEL_FAMILY_TOKENS.items(), key=lambda kv: -len(kv[0])):
        if token in low:
            # Keep the first (longest) family hit; if a later token names a
            # DIFFERENT family, that's itself a single-label contradiction.
            if found is None:
                found = fam
            elif found != fam:
                return ("__CONFLICT__", found, fam)
    return found


def check_material_self_consistency(config: dict, rendered_html: str = "") -> list[str]:
    """A single report must not assert two contradictory ROOF-SURFACE materials
    for the SAME surface (e.g. metal AND asphalt as the primary covering of one
    structure).

    Judged from the STRUCTURAL source of truth — the production
    ``material_enum`` resolver + the human ``shingle_type`` label per structure —
    NOT from prose. A property that legitimately carries DIFFERENT coverings on
    DIFFERENT structures (metal main + asphalt addition) is NOT a contradiction;
    only a self-contradictory SINGLE surface is. ``rendered_html`` is accepted
    for battery-uniform calling but unused (prose is too noisy: HAAG methodology
    boilerplate, metal siding, rooftop-HVAC housings).
    """
    violations = []
    structures = config.get("structures") or []

    # (1) per-structure: resolved enum vs the structure's own human label.
    for i, st in enumerate(structures):
        if not isinstance(st, dict):
            continue
        enum = _gen.material_enum(config, st)
        enum_fam = _ENUM_FAMILY.get(enum) if enum else None
        lbl = _label_family(st.get("shingle_type", ""))
        if isinstance(lbl, tuple) and lbl[0] == "__CONFLICT__":
            violations.append(
                f"#4 MATERIAL-SELF-CONSISTENCY: structure[{i}] shingle_type "
                f"'{st.get('shingle_type')}' names two material families "
                f"({lbl[1]} + {lbl[2]}) for one surface"
            )
            continue
        if enum_fam and lbl and enum_fam != lbl:
            violations.append(
                f"#4 MATERIAL-SELF-CONSISTENCY: structure[{i}] resolved roof "
                f"material '{enum}' ({enum_fam}) contradicts its shingle_type "
                f"label '{st.get('shingle_type')}' ({lbl})"
            )

    # (2) config-level enum vs a LONE structure (single-surface property: the
    #     two must agree). With multiple structures, differing coverings are
    #     legitimate, so we do not cross-check there.
    cfg_enum = _gen.material_enum(config, None)
    cfg_fam = _ENUM_FAMILY.get(cfg_enum) if cfg_enum else None
    if cfg_fam and len(structures) == 1 and isinstance(structures[0], dict):
        st0 = structures[0]
        st0_enum = _gen.material_enum(config, st0)
        st0_fam = _ENUM_FAMILY.get(st0_enum) if st0_enum else None
        if st0_fam and st0_fam != cfg_fam:
            violations.append(
                f"#4 MATERIAL-SELF-CONSISTENCY: config roof material "
                f"'{cfg_enum}' ({cfg_fam}) contradicts the single structure's "
                f"'{st0_enum}' ({st0_fam})"
            )
    return violations


# ══════════════════════════════════════════════════════════════════════════
# #17 — MEMBRANE/EPDM HAIL SIGNATURE ON A SLOPED ROOF
# ══════════════════════════════════════════════════════════════════════════

# The flat/low-slope sink in the canonical enum is 'other' (TPO/EPDM/mod-bit/BUR
# and anything unclassifiable). Every OTHER resolved enum is a SLOPED covering on
# which an EPDM/membrane HAIL SIGNATURE is fabricated.
_FLAT_ROOF_ENUM = "other"

# Constructions that ASSERT a flat-roof hail signature about the inspected
# surface — distinct from generic standards prose that merely MENTIONS membranes
# ("membrane roofs use different criteria"), which must NOT trip the check.
_MEMBRANE_HAIL_SIGNATURE_PATTERNS = [
    r"\b(?:epdm|tpo|membrane|rubber)\b[^.<>]{0,40}\bpunctur",
    r"\bpunctur[a-z]*\b[^.<>]{0,40}\b(?:epdm|tpo|membrane|rubber)\b",
    r"\b(?:epdm|tpo|membrane|rubber)\b[^.<>]{0,30}\bhail\b[^.<>]{0,20}(?:damage|impact|signature|punctur|strike)",
    r"\bhail\b[^.<>]{0,40}\b(?:epdm|tpo|membrane|rubber)\b",
]


def check_material_membrane_on_sloped(config: dict, rendered_html: str) -> list[str]:
    """#17 (regression-LOCK damage_detective #17): a SLOPED roof must not be
    reported with EPDM/membrane/rubber/TPO HAIL SIGNATURES — those belong to flat
    (low-slope) roofs only. #17 was fixed in prod by WS-3 (#82): the analyze_photos
    prompt carries an EPDM negative example and the synthesis path gates EPDM
    puncture language behind a real flat-roof signal. This LOCKS it.

    Anchored on the canonical roof enum (the WS-3 / production source of truth via
    _gen.material_enum), NOT raw prose: fires only when the resolved enum is a real
    sloped class (i.e. anything except the flat 'other' sink) AND the rendered HTML
    asserts a membrane *hail signature* (e.g. "EPDM puncture marks", "hail
    punctured the membrane"). Generic HAAG-style standards boilerplate that merely
    mentions membranes/flat systems does NOT trip it — the same prose-co-occurrence
    false-positive class that #4 (check_material_self_consistency) is deliberately
    built to avoid."""
    violations: list[str] = []
    enum = _gen.material_enum(config, None)
    if not enum:
        structures = config.get("structures") or []
        if len(structures) == 1 and isinstance(structures[0], dict):
            enum = _gen.material_enum(config, structures[0])
    if enum and enum != _FLAT_ROOF_ENUM:
        for pattern in _MEMBRANE_HAIL_SIGNATURE_PATTERNS:
            if re.search(pattern, rendered_html or "", re.I):
                violations.append(
                    f"#17 MEMBRANE-ON-SLOPED: sloped roof (enum '{enum}') cites a "
                    f"membrane/EPDM hail signature matching /{pattern}/ "
                    f"(damage_detective #17)"
                )
                break  # one violation per claim is enough signal
    return violations


# ══════════════════════════════════════════════════════════════════════════
# #6 — HAIL-ONLY-WITH-NOAA
# ══════════════════════════════════════════════════════════════════════════

def _noaa_has_near_hail(config: dict) -> bool:
    """True when NOAA shows a hail event at/near the property.

    Reads the production weather.noaa.events[] shape (event_type 'Hail' +
    distance_miles) plus the weather.hail_size signal — the same data the
    forensic renderer uses to justify hail language.
    """
    weather = config.get("weather") or {}

    # (1) explicit hail size measured at the property
    hail_size = (weather.get("hail_size") or "").strip()
    if hail_size:
        # any non-empty hail size with a digit means a measured hailstone
        if re.search(r"\d", hail_size):
            return True

    # (2) NOAA events within the near-property radius
    noaa = weather.get("noaa") or {}
    for ev in noaa.get("events") or []:
        if not isinstance(ev, dict):
            continue
        if (ev.get("event_type") or "").strip().lower() != "hail":
            continue
        dist = ev.get("distance_miles")
        try:
            dist = float(dist)
        except (TypeError, ValueError):
            dist = None
        if dist is None or dist <= _NOAA_HAIL_RADIUS_MILES:
            return True

    # (3) damage_thresholds sourced from NOAA hail (SWDI/NEXRAD) with a result
    for dt in weather.get("damage_thresholds") or []:
        if not isinstance(dt, dict):
            continue
        src = (dt.get("source") or "").lower()
        actual = (dt.get("storm_actual") or "").lower()
        if "noaa" in src and ("hail" in actual or "hail" in (dt.get("threshold") or "").lower()):
            return True
    return False


def check_hail_only_with_noaa(config: dict, rendered_html: str) -> list[str]:
    """A CAUSAL hail-damage assertion may appear only when NOAA shows hail
    at/near the property. If the rendered report asserts hail as a cause of loss
    but the NOAA record carries no near-property hail event (and no measured hail
    size), that is an unsupported hail claim.

    The rendered HTML is flattened to visible text and the generic SCAFFOLDING
    (HAAG "Damage Criteria" definition, the threshold-chart label, the
    differentiation-grid hail row — ``_HAIL_BOILERPLATE_PATTERNS``) is stripped
    FIRST, so a report whose ONLY hail mention is template boilerplate (e.g. the
    IN-wind / PA fixtures) does NOT fire. Only a claim-specific causal phrase
    that survives scrubbing counts.
    """
    text = _strip_hail_boilerplate(_visible_text(rendered_html))
    hail_phrases = _present_phrases(text, _HAIL_DAMAGE_PHRASES)
    if not hail_phrases:
        return []  # no CAUSAL hail language (only scaffolding, if any) to support
    if _noaa_has_near_hail(config):
        return []  # supported
    return [
        f"#6 HAIL-ONLY-WITH-NOAA: report asserts hail as a cause of loss "
        f"{hail_phrases} (beyond template boilerplate) but NOAA shows no hail "
        f"event at/near the property (no near-property hail event, no measured "
        f"hail size)"
    ]


# ══════════════════════════════════════════════════════════════════════════
# Battery registry — checks grouped by the input they need
# ══════════════════════════════════════════════════════════════════════════

# Checks that need (config, rendered_forensic_html).
CONFIG_PLUS_DOC_CHECKS = (
    check_tenant_identity_leak,
    check_climate_text_vs_state,
    check_material_self_consistency,
    check_material_membrane_on_sloped,
    check_hail_only_with_noaa,
)

# Checks that need only (config).
CONFIG_ONLY_CHECKS = (
    check_tax_vs_state,
)

# check_carrier_underscope_area is run separately — it needs a carrier-analyst
# result dict + a measured roof area, not the forensic HTML.


def run_doc_battery(config: dict, rendered_html: str) -> list[str]:
    """Run every (config + rendered-doc) and (config-only) invariant; return all
    violation strings across the battery (empty = all hold)."""
    out: list[str] = []
    for check in CONFIG_PLUS_DOC_CHECKS:
        out.extend(check(config, rendered_html))
    for check in CONFIG_ONLY_CHECKS:
        out.extend(check(config))
    return out
