"""
Supabase client for the damage_scores table.
Uses curl (not Python urllib — Cloudflare blocks it).
"""

import json
import os
import subprocess
from typing import Optional, Dict, Any, List


SUPABASE_URL = "https://hdiyncxkaadxnhwiyagn.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


class DamageScoreDB:
    """Client for the damage_scores Supabase table."""

    def __init__(self, url: str = SUPABASE_URL, key: str = ""):
        self.url = url.rstrip("/")
        self.key = key or SUPABASE_KEY or os.environ.get("SUPABASE_KEY", "")

    def _request(self, method: str, endpoint: str, data: Optional[dict] = None,
                 params: str = "") -> dict:
        """Make a Supabase REST API request via curl."""
        url = f"{self.url}/rest/v1/{endpoint}"
        if params:
            url += f"?{params}"

        cmd = [
            "curl", "-s", "-X", method, url,
            "-H", f"apikey: {self.key}",
            "-H", f"Authorization: Bearer {self.key}",
            "-H", "Content-Type: application/json",
            "-H", "Prefer: return=representation",
        ]

        if data and method in ("POST", "PATCH", "PUT"):
            cmd.extend(["-d", json.dumps(data)])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return {"error": result.stderr}
        try:
            return json.loads(result.stdout) if result.stdout else {}
        except json.JSONDecodeError:
            return {"error": result.stdout}

    def upsert_score(self, score_data: dict) -> dict:
        """Insert or update a damage score record."""
        return self._request("POST", "damage_scores", score_data,
                             params="on_conflict=claim_slug")

    def get_score(self, claim_slug: str) -> Optional[dict]:
        """Get score for a specific claim."""
        result = self._request("GET", "damage_scores",
                               params=f"claim_slug=eq.{claim_slug}&limit=1")
        if isinstance(result, list) and result:
            return result[0]
        return None

    def get_all_scores(self) -> List[dict]:
        """Get all damage scores."""
        result = self._request("GET", "damage_scores",
                               params="order=damage_score.desc")
        if isinstance(result, list):
            return result
        return []

    def get_heatmap(self, state: str = "", score_type: str = "damage") -> List[dict]:
        """Get scores grouped by zip for heatmap display."""
        col = "damage_score" if score_type == "damage" else "approval_score"
        params = f"select=zip_code,city,county,{col}&order={col}.desc"
        if state:
            params += f"&state=eq.{state}"
        result = self._request("GET", "damage_scores", params=params)
        if isinstance(result, list):
            return result
        return []

    def get_leaderboard(self, limit: int = 20) -> List[dict]:
        """Get top claims by approval score."""
        params = (
            "select=claim_slug,address,city,state,damage_score,damage_grade,"
            "approval_score,approval_grade,outcome"
            f"&order=approval_score.desc&limit={limit}"
        )
        result = self._request("GET", "damage_scores", params=params)
        if isinstance(result, list):
            return result
        return []

    def get_calibration_data(self) -> List[dict]:
        """Get scores with known outcomes for calibration."""
        params = (
            "select=claim_slug,damage_score,approval_score,outcome"
            "&outcome=neq.pending&order=claim_slug"
        )
        result = self._request("GET", "damage_scores", params=params)
        if isinstance(result, list):
            return result
        return []


# SQL migration for creating the table
MIGRATION_SQL = """
-- damage_scores table for the USARM Dual Score System
CREATE TABLE IF NOT EXISTS damage_scores (
    id BIGSERIAL PRIMARY KEY,
    claim_slug TEXT UNIQUE NOT NULL,

    -- Property location
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    county TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,

    -- Damage Score (0-100)
    damage_score INTEGER DEFAULT 0,
    damage_grade TEXT DEFAULT 'F',
    ds_roof_surface INTEGER DEFAULT 0,
    ds_evidence_cascade INTEGER DEFAULT 0,
    ds_soft_metal INTEGER DEFAULT 0,
    ds_documentation INTEGER DEFAULT 0,

    -- Technical Approval Score (0-100)
    approval_score INTEGER DEFAULT 0,
    approval_grade TEXT DEFAULT 'F',
    tas_damage_factor INTEGER DEFAULT 0,
    tas_product_factor INTEGER DEFAULT 0,
    tas_code_triggers INTEGER DEFAULT 0,
    tas_carrier_factor INTEGER DEFAULT 0,
    tas_scope_factor INTEGER DEFAULT 0,

    -- Product intelligence
    product_manufacturer TEXT,
    product_line TEXT,
    product_status TEXT,
    product_discontinuation_year INTEGER,
    exposure_inches DOUBLE PRECISION,

    -- Code triggers
    triggered_codes TEXT[],
    house_wrap_triggered BOOLEAN DEFAULT FALSE,
    tearoff_required BOOLEAN DEFAULT FALSE,

    -- Carrier context
    carrier_name TEXT,
    carrier_win_rate INTEGER,

    -- Outcome tracking
    outcome TEXT DEFAULT 'pending',  -- won|lost|pending
    carrier_initial_rcv DOUBLE PRECISION,
    carrier_final_rcv DOUBLE PRECISION,
    usarm_rcv DOUBLE PRECISION,

    -- Full breakdown (JSONB)
    full_breakdown JSONB,

    -- Metadata
    scorer_version TEXT DEFAULT '1.0.0',
    scored_at TIMESTAMPTZ DEFAULT NOW(),
    photos_analyzed INTEGER DEFAULT 0,
    analysis_mode TEXT DEFAULT 'config_only',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for geographic queries
CREATE INDEX IF NOT EXISTS idx_damage_scores_state ON damage_scores(state);
CREATE INDEX IF NOT EXISTS idx_damage_scores_zip ON damage_scores(zip_code);
CREATE INDEX IF NOT EXISTS idx_damage_scores_county ON damage_scores(county);
CREATE INDEX IF NOT EXISTS idx_damage_scores_outcome ON damage_scores(outcome);

-- Views
CREATE OR REPLACE VIEW damage_heatmap AS
SELECT zip_code, city, county, state,
       AVG(damage_score) as avg_damage,
       MAX(damage_score) as max_damage,
       COUNT(*) as claim_count
FROM damage_scores
GROUP BY zip_code, city, county, state
ORDER BY avg_damage DESC;

CREATE OR REPLACE VIEW approval_heatmap AS
SELECT zip_code, city, county, state,
       AVG(approval_score) as avg_approval,
       MAX(approval_score) as max_approval,
       COUNT(*) as claim_count
FROM damage_scores
GROUP BY zip_code, city, county, state
ORDER BY avg_approval DESC;

CREATE OR REPLACE VIEW score_calibration AS
SELECT claim_slug, damage_score, damage_grade,
       approval_score, approval_grade, outcome,
       carrier_name, product_status
FROM damage_scores
WHERE outcome != 'pending'
ORDER BY outcome, approval_score DESC;

CREATE OR REPLACE VIEW storm_tracking AS
SELECT state, county, city, zip_code,
       AVG(damage_score) as avg_damage,
       COUNT(*) as claims,
       MAX(scored_at) as latest_score
FROM damage_scores
GROUP BY state, county, city, zip_code
HAVING COUNT(*) >= 1
ORDER BY avg_damage DESC;
"""
