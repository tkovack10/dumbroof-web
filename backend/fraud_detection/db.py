"""
SQLite database manager for fraud detection persistent storage.
Handles: photo hash DB, flag audit trail, account enforcement records.
"""

import os
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional

from fraud_detection.models import FraudFlag

# Default DB location
DEFAULT_DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fraud_detection_db")
DEFAULT_DB_PATH = os.path.join(DEFAULT_DB_DIR, "usarm_fraud.db")

SCHEMA_SQL = """
-- Photo hash storage for cross-claim duplicate detection
CREATE TABLE IF NOT EXISTS photo_hashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_slug TEXT NOT NULL,
    photo_key TEXT NOT NULL,
    file_path TEXT NOT NULL,
    phash TEXT NOT NULL,
    timestamp TEXT,
    gps_lat REAL,
    gps_lon REAL,
    registered_at TEXT NOT NULL,
    UNIQUE(claim_slug, photo_key)
);

CREATE INDEX IF NOT EXISTS idx_phash ON photo_hashes(phash);
CREATE INDEX IF NOT EXISTS idx_claim_slug ON photo_hashes(claim_slug);

-- Flag history for audit trail
CREATE TABLE IF NOT EXISTS flag_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_slug TEXT NOT NULL,
    photo_key TEXT NOT NULL,
    check_type TEXT NOT NULL,
    tier TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    flagged_at TEXT NOT NULL,
    resolved_by TEXT,
    resolved_at TEXT,
    resolution TEXT
);

CREATE INDEX IF NOT EXISTS idx_flag_claim ON flag_history(claim_slug);

-- Account enforcement records (Phase 4, schema defined now)
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT UNIQUE NOT NULL,
    account_name TEXT,
    warning_count INTEGER DEFAULT 0,
    suspended INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0,
    suspended_at TEXT,
    banned_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Banned identifiers (email, phone, IP, device fingerprint)
CREATE TABLE IF NOT EXISTS ban_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier_type TEXT NOT NULL,
    identifier_value TEXT NOT NULL,
    account_id TEXT,
    banned_at TEXT NOT NULL,
    reason TEXT,
    UNIQUE(identifier_type, identifier_value)
);
"""


class FraudDB:
    """SQLite database manager for fraud detection."""

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = DEFAULT_DB_PATH
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()

    def _init_db(self):
        """Create tables if they don't exist (idempotent)."""
        conn = self._connect()
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        conn.close()

    def _connect(self) -> sqlite3.Connection:
        """Get a database connection."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # --- Photo Hashes ---

    def register_hash(
        self,
        claim_slug: str,
        photo_key: str,
        file_path: str,
        phash: str,
        timestamp: Optional[str] = None,
        gps_lat: Optional[float] = None,
        gps_lon: Optional[float] = None,
    ):
        """Store a photo hash in the database (upsert)."""
        conn = self._connect()
        conn.execute(
            """INSERT INTO photo_hashes (claim_slug, photo_key, file_path, phash, timestamp, gps_lat, gps_lon, registered_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(claim_slug, photo_key) DO UPDATE SET
                 phash = excluded.phash,
                 file_path = excluded.file_path,
                 timestamp = excluded.timestamp,
                 gps_lat = excluded.gps_lat,
                 gps_lon = excluded.gps_lon,
                 registered_at = excluded.registered_at""",
            (claim_slug, photo_key, file_path, phash, timestamp, gps_lat, gps_lon,
             datetime.now().isoformat()),
        )
        conn.commit()
        conn.close()

    def find_duplicate_hashes(
        self,
        phash: str,
        threshold: int = 8,
        exclude_claim: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Find photos with similar perceptual hashes.
        Returns list of matches with hamming distance.
        """
        conn = self._connect()
        if exclude_claim:
            rows = conn.execute(
                "SELECT * FROM photo_hashes WHERE claim_slug != ?",
                (exclude_claim,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM photo_hashes").fetchall()
        conn.close()

        matches = []
        for row in rows:
            dist = self._hamming_distance_hex(phash, row["phash"])
            if dist <= threshold:
                matches.append({
                    "claim_slug": row["claim_slug"],
                    "photo_key": row["photo_key"],
                    "file_path": row["file_path"],
                    "phash": row["phash"],
                    "hamming_distance": dist,
                    "timestamp": row["timestamp"],
                    "gps_lat": row["gps_lat"],
                    "gps_lon": row["gps_lon"],
                })

        return sorted(matches, key=lambda m: m["hamming_distance"])

    def _hamming_distance_hex(self, hash1: str, hash2: str) -> int:
        """Compute Hamming distance between two hex hash strings."""
        try:
            int1 = int(hash1, 16)
            int2 = int(hash2, 16)
            xor = int1 ^ int2
            return bin(xor).count("1")
        except (ValueError, TypeError):
            return 999

    def get_claim_hashes(self, claim_slug: str) -> List[Dict[str, Any]]:
        """Get all registered hashes for a claim."""
        conn = self._connect()
        rows = conn.execute(
            "SELECT * FROM photo_hashes WHERE claim_slug = ?",
            (claim_slug,),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def get_hash_count(self) -> int:
        """Get total number of registered photo hashes."""
        conn = self._connect()
        count = conn.execute("SELECT COUNT(*) FROM photo_hashes").fetchone()[0]
        conn.close()
        return count

    # --- Flag History ---

    def log_flag(self, claim_slug: str, flag: FraudFlag):
        """Record a fraud flag in the audit trail."""
        import json
        conn = self._connect()
        conn.execute(
            """INSERT INTO flag_history (claim_slug, photo_key, check_type, tier, message, details_json, flagged_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (claim_slug, flag.photo_key, flag.check_type, flag.tier,
             flag.message, json.dumps(flag.details), datetime.now().isoformat()),
        )
        conn.commit()
        conn.close()

    def get_claim_flags(self, claim_slug: str) -> List[Dict[str, Any]]:
        """Retrieve all flags for a claim."""
        conn = self._connect()
        rows = conn.execute(
            "SELECT * FROM flag_history WHERE claim_slug = ? ORDER BY flagged_at DESC",
            (claim_slug,),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def resolve_flag(self, flag_id: int, resolved_by: str, resolution: str):
        """Mark a flag as resolved (accepted, dismissed, or escalated)."""
        conn = self._connect()
        conn.execute(
            """UPDATE flag_history SET resolved_by = ?, resolved_at = ?, resolution = ?
               WHERE id = ?""",
            (resolved_by, datetime.now().isoformat(), resolution, flag_id),
        )
        conn.commit()
        conn.close()

    # --- Stats ---

    def get_stats(self) -> Dict[str, Any]:
        """Get overall database statistics."""
        conn = self._connect()
        stats = {
            "total_hashes": conn.execute("SELECT COUNT(*) FROM photo_hashes").fetchone()[0],
            "total_claims": conn.execute("SELECT COUNT(DISTINCT claim_slug) FROM photo_hashes").fetchone()[0],
            "total_flags": conn.execute("SELECT COUNT(*) FROM flag_history").fetchone()[0],
            "unresolved_flags": conn.execute(
                "SELECT COUNT(*) FROM flag_history WHERE resolution IS NULL"
            ).fetchone()[0],
        }
        conn.close()
        return stats
