"""
Brand-isolation helpers for the PDF generation pipeline.

Centralizes the logic that decides whether to copy USARM's bundled logo
into a claim's photos_dir. Extracted from processor.py so the gating
logic can be unit-tested without spinning up the whole process_claim
pipeline.

Background: E182 — non-USARM users had USARM logo on their PDFs because
the fallback was triggered too aggressively. The fix gates the bundled
USARM logo behind three explicit checks; this module is the single
source of truth for those checks.
"""

from __future__ import annotations
import glob
import os
import shutil
from typing import Optional


def stage_usarm_fallback_logo(
    photos_dir: str,
    *,
    user_logo_downloaded: bool,
    is_usarm: bool,
    bundled_logo_paths: list[str],
) -> Optional[str]:
    """Copy the bundled USARM logo into ``photos_dir`` only when appropriate.

    Returns the destination path if a fallback was applied, otherwise None.

    Three gates must all pass before the fallback fires (E182 prevention):

    1. The caller did NOT successfully download the user's own logo
       (``user_logo_downloaded`` is False).
    2. No ``usarm_logo.*`` file already exists in ``photos_dir`` —
       defends against partial downloads being clobbered by the bundled
       default. Uses glob to match any extension (.jpg/.jpeg/.png/.webp).
    3. The company has the ``is_usarm`` flag set on their
       ``company_profiles`` row. This is the brand-identity gate —
       only USARM team members ever see the bundled USARM fallback.

    The first matching ``bundled_logo_paths`` entry that exists on disk
    is copied to ``{photos_dir}/usarm_logo.jpg``. Order matters — pass
    the most-preferred source first.
    """
    if user_logo_downloaded:
        return None
    if glob.glob(os.path.join(photos_dir, "usarm_logo.*")):
        return None
    if not is_usarm:
        return None

    dest = os.path.join(photos_dir, "usarm_logo.jpg")
    for src in bundled_logo_paths:
        if os.path.exists(src):
            shutil.copy2(src, dest)
            return dest
    return None
