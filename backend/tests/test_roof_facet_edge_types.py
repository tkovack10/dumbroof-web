"""Vision facet EDGE classification — roof_facets.edge_types parallel array.

SHARED DATA CONTRACT (extend of the existing Vision facet pass):
Each facet object in claims.roof_facets gets a NEW parallel array `edge_types`.
For a facet whose `polygon_pixels` has N clockwise vertices, `edge_types` is an
array of N strings; `edge_types[i]` classifies the polygon EDGE from vertex i to
vertex (i+1) mod N as one of:
    eave, rake, ridge, valley, hip, wall, unknown.

These tests prove:
  * `_normalize_edge_types` enforces the parallel-array invariant
    (len(edge_types) == len(polygon_pixels)) in every shape Vision can return.
  * Unclassifiable / missing / malformed edges degrade to "unknown" — never crash.
  * A facet payload ROUND-TRIPS edge_types through BOTH persistence writes
    (claim_config dict + claims.roof_facets JSONB column) byte-identically.
  * Old claims persisted WITHOUT edge_types still load (backward compatible).

Run: python3 -m unittest tests.test_roof_facet_edge_types -v
"""
import copy
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from processor import _normalize_edge_types, _VALID_EDGE_TYPES  # noqa: E402


def _simulate_persist(roof_facets_payload: dict) -> tuple[dict, dict]:
    """Mirror the two production writes in processor.process_claim.

    Both sites persist the WHOLE roof_facets payload unchanged:
      * claim_config write:        config["roof_facets"] = roof_facets_data
      * claims.roof_facets column:  update_data["roof_facets"] = _rf_payload
    We deep-copy + JSON-round-trip (the column is JSONB) to prove edge_types
    survives the trip with no loss/mutation.
    """
    config: dict = {}
    if isinstance(roof_facets_payload, dict) and roof_facets_payload.get("roof_facets"):
        config["roof_facets"] = copy.deepcopy(roof_facets_payload)

    update_data: dict = {}
    rf = config.get("roof_facets")
    if isinstance(rf, dict) and rf.get("roof_facets"):
        # JSONB serialization round-trip (what Supabase does to the column).
        update_data["roof_facets"] = json.loads(json.dumps(rf))
    return config, update_data


class NormalizeEdgeTypesTests(unittest.TestCase):
    def test_well_formed_quad_passthrough(self):
        facet = {
            "facet_id": "F1",
            "polygon_pixels": [[0, 0], [10, 0], [10, 10], [0, 10]],
            "edge_types": ["eave", "rake", "ridge", "rake"],
        }
        self.assertEqual(
            _normalize_edge_types(facet), ["eave", "rake", "ridge", "rake"]
        )

    def test_length_always_matches_polygon(self):
        # 5 vertices but only 2 labels -> pad tail with "unknown" to length 5.
        facet = {
            "polygon_pixels": [[0, 0], [1, 0], [1, 1], [0, 1], [0, 2]],
            "edge_types": ["eave", "valley"],
        }
        out = _normalize_edge_types(facet)
        self.assertEqual(len(out), 5)
        self.assertEqual(out, ["eave", "valley", "unknown", "unknown", "unknown"])

    def test_too_many_labels_truncated(self):
        facet = {
            "polygon_pixels": [[0, 0], [1, 0], [1, 1]],  # 3 edges
            "edge_types": ["eave", "rake", "hip", "ridge", "valley"],
        }
        self.assertEqual(_normalize_edge_types(facet), ["eave", "rake", "hip"])

    def test_invalid_labels_become_unknown(self):
        facet = {
            "polygon_pixels": [[0, 0], [1, 0], [1, 1], [0, 1]],
            # "gable" not in the enum; None / number are junk -> all "unknown".
            "edge_types": ["EAVE", "gable", None, 7],
        }
        # "EAVE" lowercases to a valid label; the rest fall to "unknown".
        self.assertEqual(
            _normalize_edge_types(facet), ["eave", "unknown", "unknown", "unknown"]
        )

    def test_missing_edge_types_all_unknown(self):
        # Backward compat: an old facet with geometry but NO edge_types key.
        facet = {"polygon_pixels": [[0, 0], [1, 0], [1, 1]]}
        self.assertEqual(_normalize_edge_types(facet), ["unknown", "unknown", "unknown"])

    def test_no_polygon_empty_edge_array(self):
        # 3D-only / cardinal-skeleton facets carry polygon_pixels=[] -> edge_types=[]
        self.assertEqual(_normalize_edge_types({"polygon_pixels": []}), [])
        self.assertEqual(_normalize_edge_types({}), [])

    def test_malformed_edge_types_not_a_list(self):
        facet = {"polygon_pixels": [[0, 0], [1, 0], [1, 1]], "edge_types": "eave"}
        self.assertEqual(_normalize_edge_types(facet), ["unknown", "unknown", "unknown"])

    def test_only_contract_labels_emitted(self):
        facet = {
            "polygon_pixels": [[i, i] for i in range(7)],
            "edge_types": ["eave", "rake", "ridge", "valley", "hip", "wall", "unknown"],
        }
        out = _normalize_edge_types(facet)
        self.assertEqual(len(out), 7)
        for label in out:
            self.assertIn(label, _VALID_EDGE_TYPES)


class EdgeTypesRoundTripTests(unittest.TestCase):
    def test_payload_round_trips_edge_types_through_both_writes(self):
        """The PRIMARY contract test: a facet payload with edge_types persists
        identically into claim_config AND the claims.roof_facets JSONB column."""
        facet = {
            "facet_id": "F1",
            "pitch": "6/12",
            "cardinal": "N",
            "area_pct": 18.5,
            "polygon_pixels": [[100, 200], [300, 200], [300, 400], [100, 400]],
            "edge_types": ["eave", "rake", "ridge", "rake"],
        }
        # Normalize like extract_roof_facets does before persist.
        facet["edge_types"] = _normalize_edge_types(facet)
        payload = {
            "roof_facets": [facet],
            "north_arrow_angle": 0,
            "scale_bar": {"pixels": 100, "feet": 20},
        }

        config, update_data = _simulate_persist(payload)

        # Present in both writes.
        self.assertIn("roof_facets", config)
        self.assertIn("roof_facets", update_data)

        cfg_facet = config["roof_facets"]["roof_facets"][0]
        col_facet = update_data["roof_facets"]["roof_facets"][0]

        # edge_types survived both writes, unchanged, parallel to polygon_pixels.
        self.assertEqual(cfg_facet["edge_types"], ["eave", "rake", "ridge", "rake"])
        self.assertEqual(col_facet["edge_types"], ["eave", "rake", "ridge", "rake"])
        self.assertEqual(len(col_facet["edge_types"]), len(col_facet["polygon_pixels"]))

        # Existing fields untouched by the new array.
        for k in ("facet_id", "pitch", "cardinal", "area_pct", "polygon_pixels"):
            self.assertEqual(col_facet[k], facet[k])

    def test_legacy_payload_without_edge_types_still_persists(self):
        """Backward compat: an OLD payload (pre-edge_types) loads + persists
        without crashing. The two writes copy the whole dict regardless."""
        legacy = {
            "roof_facets": [
                {"facet_id": "F1", "pitch": "6/12", "cardinal": "N",
                 "area_pct": 50.0, "polygon_pixels": [[0, 0], [1, 0], [1, 1]]},
            ],
            "north_arrow_angle": 0,
            "scale_bar": None,
        }
        config, update_data = _simulate_persist(legacy)
        self.assertIn("roof_facets", config)
        self.assertIn("roof_facets", update_data)
        # No edge_types key present, and loading it must not raise.
        col_facet = update_data["roof_facets"]["roof_facets"][0]
        self.assertNotIn("edge_types", col_facet)
        # A consumer can still normalize it on read -> all "unknown" length 3.
        self.assertEqual(
            _normalize_edge_types(col_facet), ["unknown", "unknown", "unknown"]
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
