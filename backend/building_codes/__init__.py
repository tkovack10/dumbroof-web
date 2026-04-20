"""Single source of truth for state-specific residential building codes.

Loaded once per process from `state_codes.json`. Use the public functions in
`lookup` for all state→code resolution. Never hardcode state branches in
business logic — add a row to the JSON instead.
"""
from .lookup import (
    get_state_codes,
    get_prefix,
    get_jurisdiction,
    get_code_reference,
    get_ice_barrier,
    get_sales_tax,
    get_code_citation,
    get_advocacy_reg,
    all_states,
)

__all__ = [
    "get_state_codes",
    "get_prefix",
    "get_jurisdiction",
    "get_code_reference",
    "get_ice_barrier",
    "get_sales_tax",
    "get_code_citation",
    "get_advocacy_reg",
    "all_states",
]
