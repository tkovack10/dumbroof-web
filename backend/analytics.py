"""
Analytics Module — Pricing intelligence, settlement predictions, and claim analytics.
=====================================================================================
Queries the data warehouse tables to provide:
- Regional pricing reports (USARM vs carrier vs settlement)
- Price deviation detection
- Settlement prediction based on claim parameters
- Claim outcome analytics and trends
"""

from __future__ import annotations

from typing import Optional


def get_pricing_report(sb, region: str = None, category: str = None) -> dict:
    """Generate a pricing comparison report: USARM vs Carrier prices."""
    try:
        query = sb.table("pricing_benchmarks").select("*")
        if region:
            query = query.eq("region", region)
        if category:
            query = query.eq("category", category)

        results = query.execute().data

        if not results:
            return {"region": region, "items": [], "message": "No pricing data"}

        # Group by description + unit
        groups = {}
        for r in results:
            key = f"{r['description']}|{r['unit']}"
            if key not in groups:
                groups[key] = {
                    "description": r["description"],
                    "unit": r["unit"],
                    "usarm_prices": [],
                    "carrier_prices": [],
                    "settlement_prices": [],
                }
            g = groups[key]
            price = r.get("unit_price", 0)
            source = r.get("source", "")
            if source == "usarm":
                g["usarm_prices"].append(price)
            elif source == "carrier":
                g["carrier_prices"].append(price)
            elif source == "settlement":
                g["settlement_prices"].append(price)

        # Calculate averages and gaps
        items = []
        for g in groups.values():
            usarm_avg = _avg(g["usarm_prices"])
            carrier_avg = _avg(g["carrier_prices"])
            settlement_avg = _avg(g["settlement_prices"])
            gap = usarm_avg - carrier_avg if usarm_avg and carrier_avg else None

            items.append({
                "description": g["description"],
                "unit": g["unit"],
                "usarm_avg": round(usarm_avg, 2) if usarm_avg else None,
                "carrier_avg": round(carrier_avg, 2) if carrier_avg else None,
                "settlement_avg": round(settlement_avg, 2) if settlement_avg else None,
                "price_gap": round(gap, 2) if gap else None,
                "gap_pct": round(gap / carrier_avg * 100, 1) if gap and carrier_avg else None,
                "data_points": len(g["usarm_prices"]) + len(g["carrier_prices"]) + len(g["settlement_prices"]),
            })

        # Sort by price gap (largest discrepancies first)
        items.sort(key=lambda x: abs(x.get("price_gap") or 0), reverse=True)

        return {
            "region": region,
            "total_items": len(items),
            "items": items,
        }
    except Exception as e:
        return {"error": str(e)}


def detect_price_deviations(sb, claim_items: list, price_list: str = "NYBI26",
                            threshold_pct: float = 15.0) -> list:
    """Flag carrier line items that deviate >threshold% from regional benchmarks."""
    try:
        # Get regional benchmarks for this price list
        benchmarks = (
            sb.table("pricing_benchmarks")
            .select("description, unit, unit_price, source")
            .eq("price_list", price_list)
            .eq("source", "usarm")
            .execute()
            .data
        )

        if not benchmarks:
            return []

        # Build lookup: description -> avg price
        price_lookup = {}
        for b in benchmarks:
            key = b["description"].lower().strip()
            if key not in price_lookup:
                price_lookup[key] = []
            price_lookup[key].append(b["unit_price"])

        avg_lookup = {k: _avg(v) for k, v in price_lookup.items()}

        # Check each carrier item against benchmarks
        deviations = []
        for item in claim_items:
            desc = (item.get("description") or item.get("item", "")).lower().strip()
            carrier_price = item.get("unit_price") or item.get("carrier_amount", 0)

            if not carrier_price or not desc:
                continue

            # Try exact match first, then fuzzy
            benchmark = avg_lookup.get(desc)
            if not benchmark:
                # Try partial match
                for key, avg in avg_lookup.items():
                    if _fuzzy_match(desc, key):
                        benchmark = avg
                        break

            if benchmark and benchmark > 0:
                deviation_pct = ((carrier_price - benchmark) / benchmark) * 100
                if abs(deviation_pct) > threshold_pct:
                    deviations.append({
                        "description": item.get("description") or item.get("item", ""),
                        "carrier_price": carrier_price,
                        "benchmark_price": round(benchmark, 2),
                        "deviation_pct": round(deviation_pct, 1),
                        "direction": "over" if deviation_pct > 0 else "under",
                    })

        return sorted(deviations, key=lambda x: abs(x["deviation_pct"]), reverse=True)
    except Exception as e:
        return [{"error": str(e)}]


def predict_settlement(sb, carrier: str, trades: list, state: str,
                       roof_area_sq: float = 0, hail_size: str = "",
                       carrier_rcv: float = 0) -> dict:
    """Predict settlement range based on historical claim outcomes."""
    try:
        query = sb.table("claim_outcomes").select("*").eq("carrier", carrier)
        results = query.execute().data

        if not results:
            return {
                "confidence": "none",
                "message": f"No historical data for {carrier}",
            }

        # Filter to similar claims
        similar = results  # Start with all
        if state:
            state_filtered = [r for r in results if r.get("state") == state]
            if len(state_filtered) >= 2:
                similar = state_filtered

        if trades:
            trade_filtered = [
                r for r in similar
                if set(trades).intersection(set(r.get("trades") or []))
            ]
            if len(trade_filtered) >= 2:
                similar = trade_filtered

        n = len(similar)
        if n < 2:
            return {
                "confidence": "low",
                "data_points": n,
                "message": f"Only {n} similar claims — prediction unreliable",
            }

        # Calculate statistics
        win_claims = [s for s in similar if s.get("win")]
        win_rate = len(win_claims) / n * 100

        movements = [s.get("movement_pct", 0) for s in win_claims if s.get("movement_pct")]
        avg_movement_pct = _avg(movements) if movements else 0

        usarm_rcvs = [s.get("usarm_rcv", 0) for s in similar if s.get("usarm_rcv")]
        avg_usarm = _avg(usarm_rcvs) if usarm_rcvs else 0

        settlements = [s.get("settlement_amount", 0) for s in win_claims if s.get("settlement_amount")]
        avg_settlement = _avg(settlements) if settlements else 0

        # Predict range
        predicted_movement = 0
        if carrier_rcv and avg_movement_pct:
            predicted_movement = carrier_rcv * (avg_movement_pct / 100)

        confidence = "low"
        if n >= 5:
            confidence = "medium"
        if n >= 10:
            confidence = "high"

        return {
            "confidence": confidence,
            "data_points": n,
            "win_probability_pct": round(win_rate, 1),
            "avg_movement_pct": round(avg_movement_pct, 1),
            "predicted_additional_amount": round(predicted_movement, 0) if carrier_rcv else None,
            "predicted_settlement_range": {
                "low": round(carrier_rcv + predicted_movement * 0.5, 0) if carrier_rcv else None,
                "mid": round(carrier_rcv + predicted_movement, 0) if carrier_rcv else None,
                "high": round(carrier_rcv + predicted_movement * 1.5, 0) if carrier_rcv else None,
            } if carrier_rcv else None,
            "avg_usarm_rcv": round(avg_usarm, 0),
            "avg_settlement": round(avg_settlement, 0),
            "note": f"Based on {n} similar claims against {carrier}",
        }
    except Exception as e:
        return {"error": str(e)}


def get_claim_analytics(sb) -> dict:
    """Get overall claim portfolio analytics."""
    try:
        outcomes = sb.table("claim_outcomes").select("*").execute().data
        if not outcomes:
            return {"total_claims": 0, "message": "No claims data"}

        total = len(outcomes)
        wins = [o for o in outcomes if o.get("win")]
        total_usarm = sum(o.get("usarm_rcv", 0) for o in outcomes)
        total_carrier = sum(o.get("original_carrier_rcv", 0) for o in outcomes)
        total_movement = sum(o.get("movement_amount", 0) for o in wins)

        # Per-carrier breakdown
        carriers = {}
        for o in outcomes:
            c = o.get("carrier", "Unknown")
            if c not in carriers:
                carriers[c] = {"total": 0, "wins": 0, "movement": 0}
            carriers[c]["total"] += 1
            if o.get("win"):
                carriers[c]["wins"] += 1
                carriers[c]["movement"] += o.get("movement_amount", 0)

        carrier_breakdown = [
            {
                "carrier": c,
                "claims": d["total"],
                "wins": d["wins"],
                "win_rate": round(d["wins"] / d["total"] * 100, 1) if d["total"] else 0,
                "total_movement": round(d["movement"], 0),
            }
            for c, d in sorted(carriers.items(), key=lambda x: x[1]["total"], reverse=True)
        ]

        # Per-trade breakdown
        trade_counts = {}
        for o in outcomes:
            for t in (o.get("trades") or []):
                trade_counts[t] = trade_counts.get(t, 0) + 1

        return {
            "total_claims": total,
            "total_wins": len(wins),
            "win_rate_pct": round(len(wins) / total * 100, 1),
            "total_usarm_rcv": round(total_usarm, 0),
            "total_carrier_rcv": round(total_carrier, 0),
            "total_movement_on_wins": round(total_movement, 0),
            "avg_claim_size": round(total_usarm / total, 0),
            "carrier_breakdown": carrier_breakdown,
            "trade_frequency": dict(sorted(trade_counts.items(), key=lambda x: x[1], reverse=True)),
        }
    except Exception as e:
        return {"error": str(e)}


def get_processing_costs(sb, claim_id: str = None) -> dict:
    """Get processing cost analytics."""
    try:
        query = sb.table("processing_logs").select("*")
        if claim_id:
            query = query.eq("claim_id", claim_id)

        results = query.execute().data
        if not results:
            return {"total_calls": 0, "message": "No processing logs"}

        total_cost = sum(r.get("total_cost", 0) for r in results)
        total_tokens = sum(r.get("prompt_tokens", 0) + r.get("completion_tokens", 0) for r in results)
        total_duration = sum(r.get("duration_ms", 0) for r in results)
        failures = [r for r in results if not r.get("success")]

        # Cost by step
        step_costs = {}
        for r in results:
            step = r.get("step_name", "unknown")
            if step not in step_costs:
                step_costs[step] = {"calls": 0, "cost": 0, "duration_ms": 0, "failures": 0}
            s = step_costs[step]
            s["calls"] += 1
            s["cost"] += r.get("total_cost", 0)
            s["duration_ms"] += r.get("duration_ms", 0)
            if not r.get("success"):
                s["failures"] += 1

        # Per-claim costs
        claim_costs = {}
        for r in results:
            cid = r.get("claim_id", "unknown")
            claim_costs[cid] = claim_costs.get(cid, 0) + r.get("total_cost", 0)

        n_claims = len(claim_costs)
        avg_cost_per_claim = total_cost / n_claims if n_claims else 0

        return {
            "total_calls": len(results),
            "total_cost_usd": round(total_cost, 4),
            "total_tokens": total_tokens,
            "total_duration_sec": round(total_duration / 1000, 1),
            "failure_count": len(failures),
            "failure_rate_pct": round(len(failures) / len(results) * 100, 1) if results else 0,
            "claims_processed": n_claims,
            "avg_cost_per_claim": round(avg_cost_per_claim, 4),
            "cost_by_step": {
                k: {
                    "calls": v["calls"],
                    "cost_usd": round(v["cost"], 4),
                    "avg_duration_sec": round(v["duration_ms"] / v["calls"] / 1000, 1) if v["calls"] else 0,
                    "failures": v["failures"],
                }
                for k, v in sorted(step_costs.items(), key=lambda x: x[1]["cost"], reverse=True)
            },
        }
    except Exception as e:
        return {"error": str(e)}


def get_photo_analytics(sb) -> dict:
    """Get photo portfolio analytics."""
    try:
        photos = sb.table("photos").select("damage_type, material, trade, severity, fraud_score").execute().data
        if not photos:
            return {"total_photos": 0, "message": "No photo data"}

        total = len(photos)

        # Damage type distribution
        damage_types = {}
        for p in photos:
            dt = p.get("damage_type") or "unclassified"
            damage_types[dt] = damage_types.get(dt, 0) + 1

        # Material distribution
        materials = {}
        for p in photos:
            m = p.get("material") or "unclassified"
            materials[m] = materials.get(m, 0) + 1

        # Trade distribution
        trades = {}
        for p in photos:
            t = p.get("trade") or "unclassified"
            trades[t] = trades.get(t, 0) + 1

        # Fraud score distribution
        flagged = [p for p in photos if (p.get("fraud_score") or 0) > 50]

        return {
            "total_photos": total,
            "flagged_count": len(flagged),
            "damage_types": dict(sorted(damage_types.items(), key=lambda x: x[1], reverse=True)),
            "materials": dict(sorted(materials.items(), key=lambda x: x[1], reverse=True)),
            "trades": dict(sorted(trades.items(), key=lambda x: x[1], reverse=True)),
        }
    except Exception as e:
        return {"error": str(e)}


# ===================================================================
# HELPERS
# ===================================================================

def _avg(values: list) -> float:
    """Safe average."""
    return sum(values) / len(values) if values else 0


def _fuzzy_match(a: str, b: str) -> bool:
    """Simple fuzzy matching — checks if key words overlap."""
    a_words = set(a.lower().split())
    b_words = set(b.lower().split())
    # Remove common filler words
    filler = {"r&r", "remove", "replace", "install", "-", "&", "and", "the", "a", "an"}
    a_key = a_words - filler
    b_key = b_words - filler
    if not a_key or not b_key:
        return False
    overlap = a_key.intersection(b_key)
    return len(overlap) >= min(2, len(a_key))
