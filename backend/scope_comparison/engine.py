"""
Scope Comparison Engine — Orchestrator for structured data.

Accepts pre-extracted structured dicts (carrier items, USARM items, EagleView measurements).
NO PDF parsing — delegates that to processor.py's existing extraction pipeline.

Orchestration flow:
  1. registry.pre_match_scope_comparison() — 6-pass intent matching
  2. run_all_rules() — UP001-UP008 underpayment pattern detection
  3. Enrich comparison rows with rule findings
  4. Return (comparison_rows, rules_result)
"""

from scope_comparison.rules import run_all_rules, RulesResult


class ScopeEngine:
    """Thin orchestrator: matching + rules + enrichment from pre-extracted data."""

    def run(self, registry, carrier_items, usarm_items, measurements, state, config_hints=None):
        """Orchestrate scope comparison from pre-extracted structured data.

        Args:
            registry: XactRegistry instance (has pre_match_scope_comparison method)
            carrier_items: list[dict] — carrier line items (from processor extraction)
            usarm_items: list[dict] — USARM line items (from build_line_items)
            measurements: dict — EagleView measurements (ground truth quantities)
            state: str — 2-letter state code (NY, PA, NJ, etc.)
            config_hints: dict — optional hints like {shingle_type: "laminated"}

        Returns:
            tuple: (comparison_rows: list[dict], rules_result: RulesResult | None)
                comparison_rows: 30+ field dicts with matched_by, status, note, trick_flag, etc.
                rules_result: UP001-UP008 findings, or None if rules failed
        """
        # --- Phase 1: Intent-based matching ---
        comparison_rows = registry.pre_match_scope_comparison(
            carrier_items, usarm_items,
            measurements=measurements,
            state=state,
            config_hints=config_hints
        )

        # Log match statistics
        by_method = {}
        for m in comparison_rows:
            method = m.get("matched_by", "unknown")
            by_method[method] = by_method.get(method, 0) + 1
        stats_str = " ".join(f"{k}={v}" for k, v in sorted(by_method.items()))
        print(f"[SCOPE ENGINE] EagleView-first: {stats_str} total={len(comparison_rows)}", flush=True)

        # --- Phase 2: UP001-UP008 underpayment pattern detection ---
        rules_result = None
        try:
            eagleview_data = self._build_eagleview_data(measurements)
            rules_result = run_all_rules(
                carrier_data={"line_items": carrier_items},
                eagleview_data=eagleview_data,
                state=state
            )

            if rules_result and rules_result.findings:
                # --- Phase 3: Enrich comparison rows with rule findings ---
                self._enrich_with_findings(comparison_rows, rules_result.findings)
                print(f"[SCOPE ENGINE] UP pattern detection: {len(rules_result.findings)} findings, "
                      f"${rules_result.total_supplement:,.0f} total supplement value", flush=True)
            else:
                print("[SCOPE ENGINE] UP pattern detection: 0 findings", flush=True)

        except ImportError:
            print("[SCOPE ENGINE] scope_comparison/rules.py not available — skipping UP detection", flush=True)
        except Exception as e:
            print(f"[SCOPE ENGINE] UP pattern detection failed (non-fatal): {e}", flush=True)

        return comparison_rows, rules_result

    @staticmethod
    def _build_eagleview_data(measurements):
        """Convert processor scope_meas dict to rules.py eagleview_data format."""
        return {
            "total_area_sf": measurements.get("total_roof_area_sf", 0),
            "total_squares": measurements.get("total_roof_area_sq", 0),
            "eave_lf": measurements.get("eave", 0),
            "valley_lf": measurements.get("valley", 0),
            "ridge_lf": measurements.get("ridge", 0),
            "rake_lf": measurements.get("rake", 0),
            "ridge_hip_lf": measurements.get("ridge", 0) + measurements.get("hip", 0),
            "step_flashing_lf": measurements.get("step_flashing", 0),
            "facets": measurements.get("facets", 0),
            "stories": measurements.get("stories", 1),
        }

    @staticmethod
    def _enrich_with_findings(comparison_rows, findings):
        """Enrich comparison rows with UP rule findings by description overlap."""
        for finding in findings:
            finding_desc = finding.item_description.lower()
            for row in comparison_rows:
                row_desc = (row.get("checklist_desc") or row.get("usarm_desc") or "").lower()
                if row_desc and (finding_desc in row_desc or row_desc in finding_desc):
                    existing_note = row.get("note", "")
                    rule_note = f"[{finding.rule_id}] {finding.detail}"
                    if rule_note not in existing_note:
                        row["note"] = f"{existing_note} | {rule_note}" if existing_note else rule_note
                    if finding.code_reference and not row.get("code_citation"):
                        row["irc_code"] = finding.code_reference
                    break
