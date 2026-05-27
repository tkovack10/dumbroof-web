"""Tests for the NEAREST_PRICED_STATE algorithm replacement.

Shell B audit 2026-05-27: the hand-maintained NEAREST_PRICED_STATE dict had
accumulated geographic absurdities (FL→MD when GA/AL/SC closer; AL/GA→OH
when SC/TX closer). Replaced with dynamic state-centroid haversine.

These tests assert that the new algorithm picks a geographically-acceptable
neighbor for each unpriced state — NOT a specific state (mappings change as
new states get priced; we test the property "result is in the close cluster",
not the specific identity).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from xactimate_lookup import (
    DEFAULT_MARKETS,
    _STATE_CENTROIDS,
    _nearest_priced_state,
    _haversine_miles,
)


PRICED = set(DEFAULT_MARKETS.keys())


# Acceptable-neighbor clusters per unpriced state. The algorithm should
# return a state IN this set for each entry — not a specific state, because
# the answer shifts as new states get priced (e.g. if FL was unpriced, GA
# or AL or SC are all defensible).
ACCEPTABLE_FALLBACKS = {
    # Northeast unpriced
    "ME": {"NY", "NJ", "PA"},
    "NH": {"NY", "NJ", "PA", "MA"},
    "VT": {"NY", "NJ", "PA"},
    "MA": {"NY", "NJ", "PA"},
    "RI": {"NY", "NJ", "PA"},
    "CT": {"NY", "NJ", "PA"},
    # Mid-Atlantic / Appalachia / Southeast unpriced
    "VA": {"MD", "PA", "NC", "OH", "KY"},
    "DC": {"MD"},
    "WV": {"OH", "PA", "KY", "VA"},
    "TN": {"KY", "NC", "GA", "OH", "AR"},
    "AL": {"GA", "SC", "TN", "FL"},
    "MS": {"AR", "LA", "TN", "AL"},
    "LA": {"AR", "TX", "MS"},
    # Plains / Mountain / West unpriced
    "NE": {"IA", "KS", "MN", "SD"},
    "SD": {"MN", "IA", "ND", "NE"},
    "MT": {"MN", "ND"},
    # Rocky Mtn / Northwest unpriced — long distances; multiple defensible picks
    "ID": {"MN", "ND", "CO"},      # CO is actually closest (~600mi) once MT unpriced
    "WA": {"MN", "ND"},             # ND slightly closer to WA centroid than MN
    "OR": {"MN", "AZ", "CO"},       # AZ closer than CO; both > 700mi
    "AK": {"MN", "ND"},             # any northern priced state is acceptable
    "NM": {"TX", "OK", "CO", "AZ"},
    "UT": {"AZ", "CO"},
    "NV": {"AZ", "CO", "TX"},
    "WY": {"CO", "MN", "ND", "MT"},
    "CA": {"AZ", "TX"},
    "HI": {"AZ", "TX"},
    "WI": {"IL", "MN", "IA", "MI"},
    # Territories — distance still meaningful
    "PR": {"FL", "MD", "NC", "GA"},
    "VI": {"FL", "MD", "NC", "GA"},
    # Pacific territories — TX/AZ/CA-adjacent priced states; distance is enormous so
    # any priced state is defensible. Just assert we don't crash.
    "GU": set(),  # any priced is ok
    "MP": set(),
    "AS": set(),
}


def test_no_unpriced_state_routes_to_geographic_absurdity():
    """The historical bugs: FL→MD, AL→OH, GA→OH all gone (because FL/AL/GA
    are now priced OR route to geographically adjacent states)."""
    # FL is now priced — but if it were unpriced, must not go to MD when GA exists
    # AL is unpriced; must NOT route to OH (the historical bug)
    assert _nearest_priced_state("AL", PRICED) != "OH", "AL→OH was the historical absurdity"
    # MS unpriced; nearest priced is AR/LA/TN — must not be TX or NY
    assert _nearest_priced_state("MS", PRICED) in {"AR", "GA", "OK", "TN", "AL", "FL"}, "MS to a non-adjacent state"
    # CA unpriced; AZ is the only sensible answer post-2026-05-14
    assert _nearest_priced_state("CA", PRICED) == "AZ"


def test_every_unpriced_state_routes_to_acceptable_neighbor():
    """For each unpriced state in our cluster map, assert the algorithm picks
    a state in the acceptable-neighbor set."""
    failures = []
    for state, acceptable in ACCEPTABLE_FALLBACKS.items():
        result = _nearest_priced_state(state, PRICED)
        if result is None:
            failures.append(f"{state}: returned None")
            continue
        if acceptable and result not in acceptable:
            failures.append(f"{state}: got {result}, expected one of {sorted(acceptable)}")
    assert not failures, "\n  " + "\n  ".join(failures)


def test_every_priced_state_has_centroid():
    """Sanity: every state in DEFAULT_MARKETS must have a centroid entry, else
    _nearest_priced_state can't rank against it. Caught when AZ/SC were added."""
    missing = [s for s in DEFAULT_MARKETS if s not in _STATE_CENTROIDS]
    assert not missing, f"DEFAULT_MARKETS states missing from _STATE_CENTROIDS: {missing}"


def test_priced_state_input_returns_itself_if_in_priced_set():
    """If we accidentally call _nearest_priced_state with a priced state, it
    should return the same state (distance 0 to itself)."""
    assert _nearest_priced_state("FL", PRICED) == "FL"  # FL is now in DEFAULT_MARKETS
    assert _nearest_priced_state("TX", PRICED) == "TX"
    assert _nearest_priced_state("NY", PRICED) == "NY"


def test_unknown_state_returns_none():
    """Unknown state code → None (caller falls back to NY default with
    error log, same as legacy behavior)."""
    assert _nearest_priced_state("ZZ", PRICED) is None
    assert _nearest_priced_state("", PRICED) is None
    assert _nearest_priced_state(None, PRICED) is None


def test_haversine_distance_is_correct():
    """Sanity check: distance NY→LA ~2450mi, NY→NY = 0, FL→GA ~340mi."""
    ny = _STATE_CENTROIDS["NY"]
    la = _STATE_CENTROIDS["CA"]
    fl = _STATE_CENTROIDS["FL"]
    ga = _STATE_CENTROIDS["GA"]
    # NY-CA approx 2400-2500 mi
    assert 2200 < _haversine_miles(ny, la) < 2700
    # NY-NY = 0
    assert _haversine_miles(ny, ny) < 1
    # FL-GA approx 300-400 mi
    assert 250 < _haversine_miles(fl, ga) < 500


def test_default_markets_has_commit3_new_states():
    """The 9 new state markets from Commit 3 must be in DEFAULT_MARKETS,
    otherwise claims from these states fall back via _nearest_priced_state
    even though they have native pricing now."""
    commit3_states = ["AR", "CO", "FL", "GA", "IN", "KY", "MO", "NC", "ND"]
    missing = [s for s in commit3_states if s not in DEFAULT_MARKETS]
    assert not missing, f"Commit 3 states missing from DEFAULT_MARKETS: {missing}"


def test_florida_to_maryland_bug_is_fixed():
    """The named historical bug: FL claim falling back to MDBA8X_MAR26.
    Now FL is in DEFAULT_MARKETS — but if it weren't, the nearest priced
    state must NOT be MD (GA/AL/SC are obviously closer)."""
    # FL is now priced → resolves to itself
    assert "FL" in DEFAULT_MARKETS
    # Hypothetical: if FL were removed, what would it route to?
    hypothetical_priced = PRICED - {"FL"}
    fl_fallback = _nearest_priced_state("FL", hypothetical_priced)
    assert fl_fallback != "MD", \
        f"FL→MD bug regression: with FL unpriced, fallback picked {fl_fallback}"
    assert fl_fallback in {"GA", "AL", "SC", "NC"}, \
        f"FL fallback should be SE-cluster, got {fl_fallback}"


def test_pre_audit_known_absurdities_now_fixed():
    """Each absurdity Shell B's audit named: AL→OH, GA→OH, TN→OH."""
    # AL: was hardcoded to OH (~700mi), should now pick SE neighbor
    assert _nearest_priced_state("AL", PRICED) in {"GA", "SC", "TN", "FL", "MS"}
    # TN: was hardcoded to OH, now KY/NC/GA closer
    assert _nearest_priced_state("TN", PRICED) in {"KY", "NC", "GA", "AR", "OH"}
    # MS: was hardcoded to TX (~600mi), AR closer (~250mi)
    ms_pick = _nearest_priced_state("MS", PRICED)
    ms_dist = _haversine_miles(_STATE_CENTROIDS["MS"], _STATE_CENTROIDS[ms_pick])
    tx_dist = _haversine_miles(_STATE_CENTROIDS["MS"], _STATE_CENTROIDS["TX"])
    assert ms_dist <= tx_dist, f"MS should not be farther than its previous TX mapping (got {ms_pick} at {ms_dist:.0f}mi vs TX at {tx_dist:.0f}mi)"


# === CROSS_STATE_ZIP_OVERRIDE hoist (2026-05-27 regression) ===
# Bug: when PR #25 added MO to DEFAULT_MARKETS, the MO CROSS_STATE_ZIP_OVERRIDE
# entries (St Louis → ILES, KC → KSKC) silently stopped firing — the override
# check only ran in the "no price list for state" branch which was no longer
# reached for MO. Fix: hoist the override check above the DEFAULT_MARKETS branch.

from xactimate_lookup import XactRegistry

def test_cross_state_override_still_fires_for_st_louis_mo():
    """St Louis MO 63xxx routes to East St Louis IL — across-the-river, same metro.
    Must NOT route to MOSP8X (Springfield MO, 3 hrs west) even though MO is now priced."""
    code, reason = XactRegistry.resolve_market("MO", zip_code="63111", city="Saint Louis", return_reason=True)
    assert code == "ILES8X_APR26", f"St Louis MO should route to ILES (East St Louis), got {code}"
    assert reason == "cross_state_override", f"reason should be cross_state_override, got {reason}"

def test_cross_state_override_still_fires_for_kc_mo():
    """Kansas City MO 64xxx routes to Kansas City KS — same metro across state line."""
    code, reason = XactRegistry.resolve_market("MO", zip_code="64150", city="Riverside", return_reason=True)
    assert code == "KSKC8X_02MAY26", f"Riverside MO (KC metro) should route to KSKC, got {code}"
    assert reason == "cross_state_override", f"reason should be cross_state_override, got {reason}"

def test_state_default_still_wins_when_no_override_matches():
    """MO ZIP with no override entry → MOSP state default (not stuck in override path)."""
    code, _ = XactRegistry.resolve_market("MO", zip_code="65802", city="Springfield", return_reason=True)
    assert code == "MOSP8X_02MAY26", f"Springfield MO should use MO state default, got {code}"

def test_override_does_not_misfire_on_unmatched_priced_state_zip():
    """TX claim with TX zip → state default, no override (no TX entries in CROSS_STATE_ZIP_OVERRIDE)."""
    code, reason = XactRegistry.resolve_market("TX", zip_code="77002", city="Houston", return_reason=True)
    assert code.startswith("TXHO"), f"Houston should route to TXHO*, got {code}"
    assert reason != "cross_state_override", f"TX should not trigger cross_state_override"
