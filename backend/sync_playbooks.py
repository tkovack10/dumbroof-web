"""Sync carrier playbook JSON from Supabase carrier_tactics + claim_outcomes."""

import json
import os
from typing import Optional


def update_playbook_json(carrier_name: str, sb, platform_dir: str):
    """Query Supabase for carrier data, update JSON playbook with stats.

    Args:
        carrier_name: Full carrier name (e.g., "State Farm")
        sb: Supabase client instance
        platform_dir: Path to USARM-Claims-Platform root
    """
    if not carrier_name or not sb:
        return

    slug = carrier_name.lower().replace("/", "-").replace(" ", "-").replace("--", "-").strip("-")
    json_path = os.path.join(platform_dir, "carrier_playbooks", f"{slug}.json")

    # Load existing or start fresh
    existing = {}
    if os.path.exists(json_path):
        try:
            with open(json_path) as f:
                existing = json.load(f)
        except Exception:
            pass

    # Query carrier data from Supabase
    try:
        tactics_resp = sb.table("carrier_tactics").select("*").eq("carrier_name", carrier_name).execute()
        outcomes_resp = sb.table("claim_outcomes").select("*").eq("carrier", carrier_name).execute()
    except Exception as e:
        print(f"[PLAYBOOK-JSON] Supabase query failed for {carrier_name}: {e}")
        return

    tactics = tactics_resp.data or []
    outcomes = outcomes_resp.data or []

    # Compute stats
    wins = [o for o in outcomes if o.get("outcome") == "won"]
    total_movement = sum(o.get("carrier_movement", 0) for o in wins)
    win_rate = round(len(wins) / len(outcomes), 2) if outcomes else 0

    # Build/update playbook JSON
    playbook = {
        "carrier_name": carrier_name,
        "slug": slug,
        "stats": {
            "total_claims": len(outcomes),
            "wins": len(wins),
            "win_rate": win_rate,
            "total_movement": round(total_movement, 2),
            "avg_movement": round(total_movement / len(wins), 2) if wins else 0,
        },
        "effective_tactics": [
            {
                "description": t.get("tactic_description", ""),
                "category": t.get("category", ""),
                "claims_proven": t.get("claims_proven", []),
                "success_rate": t.get("success_rate", 0),
            }
            for t in tactics if t.get("effective")
        ],
        "ineffective_tactics": [
            {
                "description": t.get("tactic_description", ""),
                "category": t.get("category", ""),
                "notes": t.get("notes", ""),
            }
            for t in tactics if not t.get("effective")
        ],
        "claim_history": [
            {
                "address": o.get("address", ""),
                "outcome": o.get("outcome", ""),
                "usarm_rcv": o.get("usarm_rcv", 0),
                "carrier_rcv": o.get("carrier_rcv", 0),
                "movement": o.get("carrier_movement", 0),
            }
            for o in outcomes
        ],
    }

    # Preserve any existing fields not in our schema (manual additions)
    for key in existing:
        if key not in playbook:
            playbook[key] = existing[key]

    # Write
    try:
        os.makedirs(os.path.dirname(json_path), exist_ok=True)
        with open(json_path, "w") as f:
            json.dump(playbook, f, indent=2)
        print(f"[PLAYBOOK-JSON] Updated {slug}.json: {len(wins)} wins, ${total_movement:,.0f} movement")
    except Exception as e:
        print(f"[PLAYBOOK-JSON] Write failed for {slug}: {e}")
