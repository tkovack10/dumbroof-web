"""Shared date formatting utility — used by processor.py and qa_auditor.py."""

from datetime import datetime


def format_date_human(date_str: str) -> str:
    """Format a date string to human-readable form ("March 31, 2026").

    Accepts ISO dates ("2026-03-31"), slash dates ("3/31/2026"), or strings
    that are already human-readable. Returns the input unchanged if parsing
    fails.
    """
    if not date_str:
        return ""
    s = date_str.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%B %d, %Y")
        except ValueError:
            continue
    return s
