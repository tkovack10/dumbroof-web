"""Scope Comparison Engine — EagleView-first, checklist-driven, intent-based matching.

Integrates UP001-UP008 underpayment pattern detection with the pre_match_scope_comparison
pipeline. The engine module orchestrates matching + rules + enrichment from pre-extracted data.
"""
__version__ = "1.1.0"

from scope_comparison.rules import run_all_rules, RulesResult, Finding
from scope_comparison.engine import ScopeEngine
