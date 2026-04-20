"""State → Residential Building Code lookup.

Loads `state_codes.json` once at module load and exposes typed accessors.
Every caller passes a 2-letter state abbreviation (`"OH"`, `"NY"`, `"TX"`…);
unknown or empty state inputs fall back to the canonical IRC default row.

Design principles:
- One source of truth: the JSON file.
- Callers never care about the default-fallback — that logic lives here.
- Adding a state = add one JSON row.
- Dict returns are deep-copied so callers can't mutate cache.
"""
from __future__ import annotations

import copy
import json
import os
from functools import lru_cache
from typing import Any, Optional

_JSON_PATH = os.path.join(os.path.dirname(__file__), "state_codes.json")
_DEFAULT_KEY = "IRC"

# Full state name → 2-letter code. Upstream address parsers are inconsistent
# about whether they return "TX" or "Texas" — normalize both.
_STATE_NAME_TO_CODE = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "district of columbia": "DC", "washington d.c.": "DC", "washington dc": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY",
}


@lru_cache(maxsize=1)
def _load() -> dict:
    with open(_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Strip meta — never returned to callers
    data.pop("_meta", None)
    return data


def _normalize(state: str) -> str:
    """Accept either a 2-letter code or a full state name in any case.
    Returns the 2-letter uppercase code, or '' for empty input."""
    if not state:
        return ""
    s = state.strip()
    if len(s) == 2:
        return s.upper()
    lower = s.lower()
    return _STATE_NAME_TO_CODE.get(lower, s.upper())


def _row_for(state: str) -> dict:
    """Resolve a merged row for `state`. State-specific keys override defaults."""
    data = _load()
    state_u = _normalize(state)
    default = data.get(_DEFAULT_KEY, {})
    if state_u and state_u != _DEFAULT_KEY and state_u in data:
        merged = copy.deepcopy(default)
        # Shallow-merge top level, but preserve nested defaults for keys the
        # state row omits entirely (e.g. a state row without an ice_barrier
        # sub-dict still gets the IRC ice_barrier).
        state_row = data[state_u]
        for k, v in state_row.items():
            merged[k] = copy.deepcopy(v)
        return merged
    # Unknown state or explicit IRC request — return the default.
    return copy.deepcopy(default)


# ============================================================
# Public API
# ============================================================

def get_state_codes(state: str) -> dict:
    """Full merged code definition for a state. Never raises on unknown state."""
    return _row_for(state)


def get_prefix(state: str) -> str:
    """Short code prefix used in citations (e.g. "RCNYS", "RCO", "IRC")."""
    return _row_for(state).get("prefix", "IRC")


def get_jurisdiction(state: str) -> dict:
    """Compatibility shape for `compliance_report._get_jurisdiction()`.
    Returns {code, name, abbrev}."""
    row = _row_for(state)
    return {
        "code":   row.get("short_name", row.get("prefix", "IRC")),
        "name":   row.get("full_name", "International Residential Code (2021)"),
        "abbrev": row.get("short_name", row.get("prefix", "IRC")),
    }


def get_code_reference(state: str) -> str:
    """Human-readable jurisdiction name + abbrev, e.g.
    "Residential Code of Ohio (RCO)". Used on cover pages / narrative text.

    If `full_name` already contains a parenthetical (version year, amendment
    note, etc.) it's returned as-is — avoids double-paren output like
    "Florida Building Code, Residential (8th Edition, 2023) (FBC-R)".
    """
    row = _row_for(state)
    full = row.get("full_name", "International Residential Code")
    short = row.get("short_name") or row.get("prefix")
    if "(" in full:
        return full
    if short and short != full:
        return f"{full} ({short})"
    return full


def get_ice_barrier(state: str) -> dict:
    """Scope-comparison I&W requirements. Shape matches legacy IW_REQUIREMENTS[state]."""
    row = _row_for(state)
    ice = row.get("ice_barrier") or {}
    # Expose the old contract keys so callers don't have to change their
    # destructuring. Callers that want the full row can call get_state_codes.
    return {
        "description":     ice.get("description", ""),
        "eave_courses":    ice.get("eave_courses", 2),
        "valley_width_ft": ice.get("valley_width_ft", 3),
        "valley_sides":    ice.get("valley_sides", 2),
        "code_ref":        ice.get("code_ref", "IRC R905.1.2"),
    }


def get_sales_tax(state: str) -> float:
    """State sales-tax rate as a decimal (e.g. 0.08 for 8%).
    Returns 0.0 for any state without a modeled rate (matches prior STATE_TAX.get default)."""
    return float(_row_for(state).get("sales_tax", 0.0) or 0.0)


def get_code_citation(state: str, concept: str, fallback: Optional[str] = None) -> str:
    """Resolve a specific code citation for a named concept
    (`ice_barrier` | `drip_edge` | `ventilation` | `house_wrap_corners`
     | `two_layer_tearoff` | `underlayment` | `starter_strip`).

    Each concept's JSON row has a `code_ref` field. Unknown concepts fall
    back to the provided `fallback` (or empty string)."""
    row = _row_for(state)
    entry = row.get(concept)
    if isinstance(entry, dict):
        return entry.get("code_ref", fallback or "")
    return fallback or ""


def get_advocacy_reg(state: str) -> Optional[dict]:
    """State-specific claim-handling regulation (e.g. NY 11 NYCRR § 216).
    Returns None when not applicable — and ONLY used in PA / attorney
    compliance modes."""
    row = _row_for(state)
    reg = row.get("advocacy_reg")
    if isinstance(reg, dict):
        return copy.deepcopy(reg)
    return None


def all_states() -> list[str]:
    """List of 2-letter state keys currently in the JSON (excludes the
    `IRC` default row). Useful for tests + a pricing-coverage report."""
    data = _load()
    return sorted(k for k in data.keys() if k != _DEFAULT_KEY)
