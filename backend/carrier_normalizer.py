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

# Each tuple: (regex pattern, canonical name). First match wins.
# Patterns are case-insensitive. Order matters — more specific first.
_CARRIER_PATTERNS: list[tuple[str, str]] = [
    # ── TPAs / Independent Adjusters / Restoration (NOT carriers) ──
    (r"\bsedgwick\b", "tpa:Sedgwick"),
    (r"\bj\.?s\.?\s*held\b", "tpa:J.S. Held"),
    (r"\bjohn\s*m\.?\s*dorner\b", "tpa:John M Dorner"),
    (r"\beberl\s+claims?\b", "tpa:Eberl Claims Service"),
    (r"\bcis\s+specialty\b", "tpa:CIS Specialty"),
    (r"\bdecker\s+associates\b", "tpa:Decker Associates"),
    (r"\blamarche\s+associates\b", "tpa:LaMarche Associates"),
    (r"\bprofessional\s+claims?\s+adjustment\b", "tpa:Professional Claims Adjustment"),
    (r"\bmark\s*1\s+restoration\b", "tpa:Mark 1 Restoration"),

    # ── Specific multi-word carriers (must precede shorter patterns) ──
    (r"\bnation\s*wide\b", "Nationwide"),  # split-word variants ("Nation wide")
    (r"\bnationwide\s+(general|private|property|crestbrook|/\s*crestbrook)", "Nationwide"),
    (r"\bcrestbrook\b", "Nationwide"),  # Crestbrook is Nationwide private-client
    (r"\bnational\s+catastrophe\s+center\b|\bencompass\b", "Encompass"),
    (r"\btruck\s+insurance\s+exchange\b", "Farmers"),  # owned by Farmers
    (r"\bmid[-\s]?century\s+insurance\b", "Farmers"),  # also a Farmers brand
    (r"\bfarmers?\s+property\s+(and|&)\s+casualty\b", "Farmers"),
    (r"\bfarmers?\s+insurance(\s+exchange)?\b", "Farmers"),
    (r"\bforemost\s+insurance\b", "Farmers"),  # Foremost is owned by Farmers
    (r"^\s*farmers\s*$", "Farmers"),
    (r"\bsafeco\b", "Liberty Mutual"),  # Safeco is owned by Liberty Mutual
    (r"\bfirst\s+liberty\b|\bliberty\s+mutual(\s+\w+)*", "Liberty Mutual"),
    (r"\bnycm\b|\bnew\s+york\s+central\s+mutual\b", "NYCM"),
    (r"\b(travco|travelers?\s+home\s+and\s+marine|fidelity\s+and\s+guaranty)\b", "Travelers"),
    (r"\btravelers?\b", "Travelers"),
    (r"\busaa\b|\bunited\s+services\s+automobile\b", "USAA"),
    (r"\b(all\s*state)\b", "Allstate"),  # covers "Allstate" + "All State" / "All state"
    (r"\bstate\s+farm\b", "State Farm"),
    (r"\bcolumbia\s+lloyds\b", "Columbia Lloyds"),
    (r"\bgoodville\s+mutual\b", "Goodville Mutual"),
    (r"\bhanover\s+insurance\b|\bthe\s+hanover\b", "Hanover"),
    (r"\bguideone\b|\bguide\s+one\b", "GuideOne"),
    (r"\bchubb\b", "Chubb"),
    (r"\bamica\b", "Amica"),
    (r"\bsterling\s+insurance\b", "Sterling"),
    (r"\bpure\s+insurance\b", "Pure"),
    (r"\bprogressive\b", "Progressive"),
    (r"\bamerican\s+family\b", "American Family"),
    (r"\bplymouth\s+rock\b", "Plymouth Rock"),
    (r"\berie\s+insurance\b", "Erie"),
    (r"\bleatherstocking\b", "Leatherstocking Cooperative"),
    (r"\bhomesite\s+insurance\b", "Homesite"),
    (r"\bmidstate\s+mutual\b", "Midstate Mutual"),
    (r"\bassurant\b", "Assurant"),
    (r"\bchurch\s+mutual\b", "Church Mutual"),
    (r"\bwestfield\b", "Westfield"),
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


def canonical_carrier_name(raw: str | None) -> str:
    """Return the canonical carrier name for any of its known spellings.

    Returns:
        - Canonical name (e.g. "State Farm", "Liberty Mutual") if matched.
        - "tpa:Name" prefixed string for known TPAs / independent adjusters.
        - Empty string for garbage values (caller should skip writing these rows).
        - Title-cased trimmed input as a last resort (preserves novel carriers
          for surfacing — they'll get their own bucket and we add a regex later).
    """
    if not raw or not isinstance(raw, str):
        return ""
    # Collapse internal whitespace + trim BEFORE pattern matching. Otherwise
    # variants like "All State " or "Nation wide" fall through to the title-
    # case fallback and create new orphan buckets ("All State", "Nation Wide")
    # separate from the canonical "Allstate" / "Nationwide" — the exact bug
    # this normalizer was built to prevent. (Code review #1, 2026-05-05.)
    s = re.sub(r"\s+", " ", raw).strip()
    if not s:
        return ""
    for pat in _GARBAGE_PATTERNS:
        if re.match(pat, s, re.IGNORECASE):
            return ""
    for pat, canonical in _CARRIER_PATTERNS:
        if re.search(pat, s, re.IGNORECASE):
            return canonical
    # Unknown carrier — preserve as title-cased + collapsed-whitespace.
    # Logged as a candidate to add to _CARRIER_PATTERNS.
    return re.sub(r"\s+", " ", s).strip().title()


def is_tpa(canonical_name: str) -> bool:
    """True if the canonical name represents a TPA / IA / restoration vendor,
    not a real insurance carrier."""
    return canonical_name.startswith("tpa:")


def display_name(canonical_name: str) -> str:
    """Strip the `tpa:` prefix for UI display."""
    if canonical_name.startswith("tpa:"):
        return canonical_name[4:]
    return canonical_name
