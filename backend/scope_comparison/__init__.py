"""Scope Comparison Engine — EagleView-first, checklist-driven, intent-based matching.

Integrates UP001-UP008 underpayment pattern detection with the pre_match_scope_comparison
pipeline. The rules module provides carrier trick detection that enriches comparison rows.
"""
__version__ = "1.1.0"

from scope_comparison.rules import run_all_rules, RulesResult, Finding
