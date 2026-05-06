"""Carrier-name canonicalization for the recursive memory system (E211).

Problem: `carrier_tactics` and `claim_outcomes` were keyed on whatever string
the carrier-extraction pipeline pulled out of the carrier scope PDF, which
produced 68 distinct values for ~20 actual insurers. Liberty Mutual alone
fragmented into 3 buckets (Liberty Mutual Insurance / Liberty Mutual Mid
Atlantic / The First Liberty Insurance Corporation), splitting the
self-learning memory and making every Liberty claim partially blind to
intel from the other variants.

Solution: every write goes through `canonical_carrier_name()` first.
`load_carrier_playbook()` reads against the canonical name. A one-shot
backfill normalizes the 1,741 existing tactics rows + 300 outcomes rows.

Two-level identity (PARENT vs BRAND):
- PARENT (canonical) is what `canonical_carrier_name()` returns and what
  gets written to the `carrier` column. Cross-portfolio intel pools here.
- BRAND is what `canonical_carrier_brand_pair()` returns as the second
  tuple element and what gets written to `carrier_brand`. Most carriers
  have no separate brand (BRAND == PARENT), but a handful of operationally
  distinct sub-brands stay split:
    Safeco               → parent: Liberty Mutual,  brand: Safeco
    Foremost             → parent: Farmers,         brand: Foremost
    Crestbrook           → parent: Nationwide,      brand: Crestbrook
    Mid-Century          → parent: Farmers,         brand: Mid-Century
    Truck Exchange       → parent: Farmers,         brand: Truck Insurance Exchange
    Fidelity & Guaranty  → parent: Travelers,       brand: Fidelity & Guaranty
  Reasoning: Safeco's adjusters negotiate while Liberty Mutual proper
  denies fully. Same parent owner, distinct claim behavior. Splitting
  preserves the operational signal while the parent column still pools
  intel for cross-brand pattern recognition.

Design choices:
- Substring/regex matching, NOT exact-equal — so future spelling drift
  ("Liberty Mut Insurance") still routes correctly without a code change.
- TPAs (Sedgwick, J.S. Held, John M Dorner, Eberl, etc.) get a `tpa:`
  prefix to distinguish from real carriers — they shouldn't pollute
  carrier-level win-rate calcs.
- Garbage values ("Insurance Company Name", "Unknown - Inferred...")
  return empty string so callers can skip them.
- Test suite (test_carrier_normalizer.py) locks in current behavior so
  alias additions don't accidentally break existing routes.
"""
from __future__ import annotations
import re
from typing import Optional

# Each tuple: (regex pattern, canonical PARENT, distinct BRAND or None).
# - PARENT is what `canonical_carrier_name()` returns and what gets stored in
#   the `carrier` column. Cross-portfolio intel pools at this level.
# - BRAND is what `canonical_carrier_brand_pair()` returns as the second tuple
#   element and what gets stored in `carrier_brand`. None means "same as
#   parent" — most carriers don't have an operationally-distinct sub-brand.
# Patterns are case-insensitive. Order matters — more specific first.
_CARRIER_PATTERNS: list[tuple[str, str, Optional[str]]] = [
    # ── TPAs / Independent Adjusters / Restoration (NOT carriers) ──
    (r"\bsedgwick\b",                          "tpa:Sedgwick",                      None),
    (r"\bj\.?s\.?\s*held\b",                   "tpa:J.S. Held",                     None),
    (r"\bjohn\s*m\.?\s*dorner\b",              "tpa:John M Dorner",                 None),
    (r"\beberl\s+claims?\b",                   "tpa:Eberl Claims Service",          None),
    (r"\bcis\s+specialty\b",                   "tpa:CIS Specialty",                 None),
    (r"\bdecker\s+associates\b",               "tpa:Decker Associates",             None),
    (r"\blamarche\s+associates\b",             "tpa:LaMarche Associates",           None),
    (r"\bprofessional\s+claims?\s+adjustment\b", "tpa:Professional Claims Adjustment", None),
    (r"\bmark\s*1\s+restoration\b",            "tpa:Mark 1 Restoration",            None),

    # ── Operationally-distinct sub-brands (parent + brand split) ──
    # These six match BEFORE their parent's general pattern so the brand
    # override sticks. Parent column still gets cross-portfolio intel; brand
    # column preserves per-brand adjuster-behavior signal.
    (r"\bsafeco\b",                            "Liberty Mutual", "Safeco"),
    (r"\bforemost\s+insurance\b",              "Farmers",        "Foremost"),
    (r"\bcrestbrook\b",                        "Nationwide",     "Crestbrook"),
    (r"\bmid[-\s]?century\s+insurance\b",      "Farmers",        "Mid-Century"),
    (r"\btruck\s+insurance\s+exchange\b",      "Farmers",        "Truck Insurance Exchange"),
    (r"\bfidelity\s+and\s+guaranty\b",         "Travelers",      "Fidelity & Guaranty"),

    # ── Specific multi-word carriers (must precede shorter patterns) ──
    (r"\bnation\s*wide\b",                                                 "Nationwide", None),
    (r"\bnationwide\s+(general|private|property|crestbrook|/\s*crestbrook)", "Nationwide", None),
    (r"\bnational\s+catastrophe\s+center\b|\bencompass\b",                 "Encompass",  None),
    (r"\bfarmers?\s+property\s+(and|&)\s+casualty\b",                      "Farmers",    None),
    (r"\bfarmers?\s+insurance(\s+exchange)?\b",                            "Farmers",    None),
    (r"^\s*farmers\s*$",                                                   "Farmers",    None),
    (r"\bfirst\s+liberty\b|\bliberty\s+mutual(\s+\w+)*",                   "Liberty Mutual", None),
    (r"\bnycm\b|\bnew\s+york\s+central\s+mutual\b",                        "NYCM",       None),
    (r"\b(travco|travelers?\s+home\s+and\s+marine)\b",                     "Travelers",  None),
    (r"\btravelers?\b",                                                    "Travelers",  None),
    (r"\busaa\b|\bunited\s+services\s+automobile\b",                       "USAA",       None),
    (r"\b(all\s*state)\b",                                                 "Allstate",   None),  # covers "Allstate" + "All State" / "All state"
    (r"\bstate\s+farm\b",                                                  "State Farm", None),
    (r"\bcolumbia\s+lloyds\b",                                             "Columbia Lloyds", None),
    (r"\bgoodville\s+mutual\b",                                            "Goodville Mutual", None),
    (r"\bhanover\s+insurance\b|\bthe\s+hanover\b",                         "Hanover",    None),
    (r"\bguideone\b|\bguide\s+one\b",                                      "GuideOne",   None),
    (r"\bchubb\b",                                                         "Chubb",      None),
    (r"\bamica\b",                                                         "Amica",      None),
    (r"\bsterling\s+insurance\b",                                          "Sterling",   None),
    (r"\bpure\s+insurance\b",                                              "Pure",       None),
    (r"\bprogressive\b",                                                   "Progressive", None),
    (r"\bamerican\s+family\b",                                             "American Family", None),
    (r"\bplymouth\s+rock\b",                                               "Plymouth Rock", None),
    (r"\berie\s+insurance\b",                                              "Erie",       None),
    (r"\bleatherstocking\b",                                               "Leatherstocking Cooperative", None),
    (r"\bhomesite\s+insurance\b",                                          "Homesite",   None),
    (r"\bmidstate\s+mutual\b",                                             "Midstate Mutual", None),
    (r"\bassurant\b",                                                      "Assurant",   None),
    (r"\bchurch\s+mutual\b",                                               "Church Mutual", None),
    (r"\bwestfield\b",                                                     "Westfield",  None),
]

# Garbage values that should be skipped entirely (empty string return).
_GARBAGE_PATTERNS: list[str] = [
    r"^\s*$",                                  # empty
    r"^\s*[?\-]+\s*$",                         # "?", "-", "—"
    r"^\s*(n[/.\s]*a\.?|not?\s+available|unknown)\s*$",  # NA / N/A / N.A. / Unknown
    r"^\s*insurance\s+company\s+name\s*$",     # placeholder
    r"^\s*unknown\s*[-–—]\s*inferred",          # "Unknown - Inferred from IA Report"
    r"^\s*tbd\s*$|^\s*pending\s*$",
]


def _resolve(raw: Optional[str]) -> tuple[str, Optional[str]]:
    """Internal resolver: returns (parent_canonical, brand_or_None).

    `brand` is None when no operationally-distinct sub-brand applies. Callers
    of `canonical_carrier_brand_pair()` get the parent as the brand fallback.
    """
    if not raw or not isinstance(raw, str):
        return "", None
    s = re.sub(r"\s+", " ", raw).strip()
    if not s:
        return "", None
    for pat in _GARBAGE_PATTERNS:
        if re.match(pat, s, re.IGNORECASE):
            return "", None
    for pat, parent, brand in _CARRIER_PATTERNS:
        if re.search(pat, s, re.IGNORECASE):
            return parent, brand
    # Unknown carrier — preserve as title-cased + collapsed-whitespace.
    # Logged as a candidate to add to _CARRIER_PATTERNS.
    return s.title(), None


def canonical_carrier_name(raw: Optional[str]) -> str:
    """Return the canonical PARENT carrier name for any of its known spellings.

    Backwards-compatible signature — still returns a single string. For the
    parent + brand pair, use `canonical_carrier_brand_pair()` instead.

    Returns:
        - Canonical parent (e.g. "Liberty Mutual" for "Safeco Insurance Company").
        - "tpa:Name" for known TPAs.
        - Empty string for garbage values.
        - Title-cased fallback for novel carriers.
    """
    parent, _ = _resolve(raw)
    return parent


def canonical_carrier_brand_pair(raw: Optional[str]) -> tuple[str, str]:
    """Return (parent_canonical, brand_specific) for the carrier name.

    `brand_specific` defaults to `parent_canonical` when no operationally-
    distinct sub-brand exists — so writers can blindly populate both columns
    without worrying about None handling.

    Returns ("", "") for garbage / empty input. Callers should skip writes
    when parent is empty.

    Examples:
        "Safeco Insurance Company" → ("Liberty Mutual", "Safeco")
        "Liberty Mutual Insurance" → ("Liberty Mutual", "Liberty Mutual")
        "State Farm Fire and Casualty" → ("State Farm", "State Farm")
        "Foremost Insurance Group" → ("Farmers", "Foremost")
        "Truck Insurance Exchange (Farmers Insurance)" → ("Farmers", "Truck Insurance Exchange")
        "?" → ("", "")
    """
    parent, brand = _resolve(raw)
    if not parent:
        return "", ""
    return parent, (brand if brand else parent)


def is_tpa(canonical_name: str) -> bool:
    """True if the canonical name represents a TPA / IA / restoration vendor,
    not a real insurance carrier."""
    return canonical_name.startswith("tpa:")


def display_name(canonical_name: str) -> str:
    """Strip the `tpa:` prefix for UI display."""
    if canonical_name.startswith("tpa:"):
        return canonical_name[4:]
    return canonical_name
