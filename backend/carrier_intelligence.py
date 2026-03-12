"""
Carrier Intelligence Engine — Auto-learning playbooks from structured data.
============================================================================
Queries carrier_tactics, claim_outcomes, and pricing_benchmarks to provide:
- Carrier win rates and scoring
- Most effective arguments by carrier + trade
- Pre-claim argument suggestions
- Common denial patterns
"""

from __future__ import annotations

from typing import Optional


def get_carrier_score(sb, carrier: str) -> dict:
    """Get comprehensive carrier intelligence score."""
    try:
        outcomes = (
            sb.table("claim_outcomes")
            .select("*")
            .eq("carrier", carrier)
            .execute()
            .data
        )

        if not outcomes:
            return {"carrier": carrier, "total_claims": 0, "message": "No claims data"}

        total = len(outcomes)
        wins = [o for o in outcomes if o.get("win")]
        losses = [o for o in outcomes if not o.get("win")]

        avg_movement = 0
        if wins:
            movements = [o.get("movement_pct", 0) for o in wins if o.get("movement_pct")]
            avg_movement = sum(movements) / len(movements) if movements else 0

        avg_usarm = sum(o.get("usarm_rcv", 0) for o in outcomes) / total
        avg_carrier = sum(o.get("original_carrier_rcv", 0) for o in outcomes) / total
        avg_underpayment = ((avg_usarm - avg_carrier) / avg_carrier * 100) if avg_carrier else 0

        return {
            "carrier": carrier,
            "total_claims": total,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": round(len(wins) / total * 100, 1) if total else 0,
            "avg_win_movement_pct": round(avg_movement, 1),
            "avg_usarm_rcv": round(avg_usarm, 0),
            "avg_carrier_rcv": round(avg_carrier, 0),
            "avg_underpayment_pct": round(avg_underpayment, 1),
            "common_trades": _most_common([t for o in outcomes for t in (o.get("trades") or [])]),
        }
    except Exception as e:
        return {"carrier": carrier, "error": str(e)}


def get_effective_arguments(sb, carrier: str, trade: Optional[str] = None, limit: int = 10) -> list:
    """Get most effective counter-arguments against a carrier, ranked by impact."""
    try:
        query = (
            sb.table("carrier_tactics")
            .select("*")
            .eq("carrier", carrier)
            .eq("effective", True)
            .order("settlement_impact", desc=True)
            .limit(limit)
        )
        if trade:
            query = query.eq("trade", trade)

        results = query.execute().data

        return [
            {
                "argument": r.get("counter_argument"),
                "tactic_countered": r.get("tactic_type"),
                "dollar_impact": r.get("settlement_impact", 0),
                "trade": r.get("trade"),
                "description": r.get("description"),
            }
            for r in results
        ]
    except Exception as e:
        return [{"error": str(e)}]


def get_common_denials(sb, carrier: str, trade: Optional[str] = None) -> list:
    """Get most common denial patterns for a carrier."""
    try:
        query = (
            sb.table("carrier_tactics")
            .select("tactic_type, description, counter_argument, effective, settlement_impact")
            .eq("carrier", carrier)
        )
        if trade:
            query = query.eq("trade", trade)

        results = query.execute().data

        # Group by tactic type
        tactic_groups = {}
        for r in results:
            ttype = r.get("tactic_type", "unknown")
            if ttype not in tactic_groups:
                tactic_groups[ttype] = {
                    "tactic_type": ttype,
                    "count": 0,
                    "examples": [],
                    "countered_count": 0,
                    "total_impact": 0,
                }
            g = tactic_groups[ttype]
            g["count"] += 1
            if r.get("effective"):
                g["countered_count"] += 1
                g["total_impact"] += r.get("settlement_impact", 0)
            if len(g["examples"]) < 3:
                g["examples"].append(r.get("description", "")[:200])

        return sorted(tactic_groups.values(), key=lambda x: x["count"], reverse=True)
    except Exception as e:
        return [{"error": str(e)}]


def get_effective_arguments_batch(sb, carrier: str, trades: list, limit_per_trade: int = 5) -> dict:
    """Get effective arguments for multiple trades in a single query."""
    try:
        results = (
            sb.table("carrier_tactics")
            .select("counter_argument, tactic_type, settlement_impact, trade, description")
            .eq("carrier", carrier)
            .eq("effective", True)
            .order("settlement_impact", desc=True)
            .execute()
            .data
        )
        by_trade = {}
        general = []
        for r in (results or []):
            entry = {
                "argument": r.get("counter_argument"),
                "tactic_countered": r.get("tactic_type"),
                "dollar_impact": r.get("settlement_impact", 0),
                "trade": r.get("trade"),
                "description": r.get("description"),
            }
            t = r.get("trade")
            if t and t in trades:
                by_trade.setdefault(t, [])
                if len(by_trade[t]) < limit_per_trade:
                    by_trade[t].append(entry)
            if len(general) < limit_per_trade:
                general.append(entry)
        return {"by_trade": by_trade, "general": general}
    except Exception as e:
        return {"by_trade": {}, "general": [], "error": str(e)}


def suggest_arguments(sb, carrier: str, trades: list, state: str = None) -> dict:
    """Pre-claim intelligence: suggest arguments based on historical effectiveness."""
    try:
        score = get_carrier_score(sb, carrier)
        args = get_effective_arguments_batch(sb, carrier, trades)
        denials = get_common_denials(sb, carrier)

        return {
            "carrier_score": score,
            "recommended_arguments_by_trade": args["by_trade"],
            "general_effective_arguments": args["general"],
            "anticipated_denials": denials if not denials or not denials[0].get("error") else [],
            "prediction": _predict_outcome(score, trades),
        }
    except Exception as e:
        return {"error": str(e)}


def get_all_carrier_scores(sb) -> list:
    """Get scores for all carriers."""
    try:
        # Get distinct carriers
        results = (
            sb.table("claim_outcomes")
            .select("carrier")
            .execute()
            .data
        )

        carriers = list(set(r["carrier"] for r in results if r.get("carrier")))
        scores = [get_carrier_score(sb, c) for c in sorted(carriers)]
        return [s for s in scores if s.get("total_claims", 0) > 0]
    except Exception as e:
        return [{"error": str(e)}]


def _predict_outcome(score: dict, trades: list) -> dict:
    """Simple prediction based on historical carrier data."""
    win_rate = score.get("win_rate_pct", 0)
    avg_movement = score.get("avg_win_movement_pct", 0)
    total = score.get("total_claims", 0)

    if total < 2:
        return {"confidence": "low", "message": f"Insufficient data ({total} claims)"}

    confidence = "low"
    if total >= 5:
        confidence = "medium"
    if total >= 10:
        confidence = "high"

    return {
        "confidence": confidence,
        "win_probability_pct": win_rate,
        "expected_movement_pct": avg_movement,
        "data_points": total,
        "note": f"Based on {total} historical claims against {score.get('carrier', 'carrier')}",
    }


def _most_common(items: list, n: int = 5) -> list:
    """Return n most common items from a list."""
    counts = {}
    for item in items:
        counts[item] = counts.get(item, 0) + 1
    return sorted(counts.keys(), key=lambda x: counts[x], reverse=True)[:n]
