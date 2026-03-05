"""
Geographic intelligence queries — heatmap, storm tracking, regional analysis.
"""

from typing import List, Dict, Any, Optional
from damage_scoring.db import DamageScoreDB


def heatmap(state: str = "", score_type: str = "damage", db: Optional[DamageScoreDB] = None) -> List[Dict]:
    """
    Get damage or approval heatmap by zip code.

    Args:
        state: Filter by state (e.g., "NY", "PA"). Empty = all states.
        score_type: "damage" or "approval"
        db: Optional DB client (creates one if not provided)
    """
    if db is None:
        db = DamageScoreDB()
    return db.get_heatmap(state=state, score_type=score_type)


def leaderboard(limit: int = 20, db: Optional[DamageScoreDB] = None) -> List[Dict]:
    """Get top claims ranked by approval score."""
    if db is None:
        db = DamageScoreDB()
    return db.get_leaderboard(limit=limit)


def format_heatmap(data: List[Dict], score_type: str = "damage") -> str:
    """Format heatmap data as a readable table."""
    if not data:
        return "No data available."

    col = "damage_score" if score_type == "damage" else "approval_score"
    header = f"{'Zip':<8} {'City':<25} {'County':<20} {score_type.upper():>8}"
    lines = [header, "-" * len(header)]

    for row in data:
        score = row.get(col, 0)
        lines.append(
            f"{row.get('zip_code', ''):.<8} "
            f"{row.get('city', ''):.<25} "
            f"{row.get('county', ''):.<20} "
            f"{score:>8}"
        )

    return "\n".join(lines)


def format_leaderboard(data: List[Dict]) -> str:
    """Format leaderboard as a readable table."""
    if not data:
        return "No data available."

    header = (f"{'#':>3} {'Claim':<30} {'DS':>4} {'DG':>3} "
              f"{'TAS':>4} {'TG':>3} {'Outcome':>8}")
    lines = [header, "-" * len(header)]

    for i, row in enumerate(data, 1):
        lines.append(
            f"{i:>3} "
            f"{row.get('claim_slug', ''):.<30} "
            f"{row.get('damage_score', 0):>4} "
            f"{row.get('damage_grade', ''):>3} "
            f"{row.get('approval_score', 0):>4} "
            f"{row.get('approval_grade', ''):>3} "
            f"{row.get('outcome', 'pending'):>8}"
        )

    return "\n".join(lines)
