"""
Canonical model selector for ALL dumbroof.ai (dumbroof-web) Claude API calls.
=============================================================================
ONE knob. Every backend Claude call — vision, reasoning, text extraction,
everything — resolves its model through `MODEL` here, so the whole product
runs a single model and the next version bump is a one-line change.

Default: claude-opus-4-8 (unified 2026-05-28 per Tom: "all dumbroof.ai
functions on one Opus 4.8 — vision, reasoning, text extraction, everything").

Override levers (retained for emergency rollback, default to the unified
model when unset, so the product stays on one model):
  - DUMBROOF_MODEL          → global override for every call at once
  - RICHARD_MODEL           → Richard chat only (see governance v2 runbook)
  - CLAIM_BRAIN_VISION_MODEL → file-classifier vision only

Set DUMBROOF_MODEL in the Railway env to bump every call without a redeploy.
The frontend mirror of this knob is src/lib/model.ts.
"""
from __future__ import annotations

import os

DEFAULT_MODEL = "claude-opus-4-8"

# Global knob. Set DUMBROOF_MODEL to override every call at once.
MODEL = os.environ.get("DUMBROOF_MODEL", DEFAULT_MODEL)


def model_for(surface: str | None = None) -> str:
    """Resolve the model for a surface. An explicit per-surface env var
    (e.g. RICHARD_MODEL) wins as an emergency override; otherwise the
    unified DUMBROOF_MODEL / DEFAULT_MODEL is used."""
    if surface:
        override = os.environ.get(f"{surface}_MODEL")
        if override:
            return override
    return MODEL
