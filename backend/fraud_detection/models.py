"""
Core data classes for the fraud detection system.
All results flow through these types — serializable to JSON for claim_config storage.
"""

from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
from datetime import datetime


@dataclass
class PhotoMetadata:
    """EXIF and file metadata extracted from a single photo."""
    file_path: str
    photo_key: str                          # e.g., "p03_01"
    timestamp: Optional[str] = None         # ISO format from EXIF DateTimeOriginal
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None
    heading: Optional[float] = None         # GPSImgDirection (compass bearing 0-360)
    altitude: Optional[float] = None        # GPSAltitude in meters (negative below sea level)
    focal_length_mm: Optional[float] = None # 35mm equivalent focal length (fallback: raw FocalLength)
    software: Optional[str] = None          # EXIF Software tag
    camera_make: Optional[str] = None
    camera_model: Optional[str] = None
    image_width: int = 0
    image_height: int = 0
    perceptual_hash: Optional[str] = None   # pHash hex string

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FraudFlag:
    """A single fraud detection flag on a photo."""
    photo_key: str
    check_type: str         # from config.py CHECK_* constants
    tier: str               # "informational", "review", "critical"
    message: str            # Human-readable description
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PhotoVerification:
    """Complete verification result for a single photo."""
    photo_key: str
    file_path: str
    metadata: PhotoMetadata
    flags: List[FraudFlag] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        """True if no tier 2+ flags."""
        return not any(
            f.tier in ("review", "critical") for f in self.flags
        )

    @property
    def highest_tier(self) -> Optional[str]:
        """Return the highest severity tier among flags."""
        tiers = {"critical": 3, "review": 2, "informational": 1}
        if not self.flags:
            return None
        return max(self.flags, key=lambda f: tiers.get(f.tier, 0)).tier

    def to_dict(self) -> dict:
        return {
            "photo_key": self.photo_key,
            "file_path": self.file_path,
            "metadata": self.metadata.to_dict(),
            "flags": [f.to_dict() for f in self.flags],
            "passed": self.passed,
            "highest_tier": self.highest_tier,
        }


@dataclass
class ClaimIntegrityReport:
    """Aggregated fraud check results for an entire claim."""
    claim_slug: str
    property_address: str
    run_timestamp: str = ""
    photos_checked: int = 0
    photos_passed: int = 0
    photos_flagged: int = 0
    tier_1_count: int = 0
    tier_2_count: int = 0
    tier_3_count: int = 0
    overall_status: str = "clean"       # "clean", "review_needed", "critical_flags"
    verifications: List[PhotoVerification] = field(default_factory=list)
    property_coordinates: Optional[Dict[str, Any]] = None
    checker_version: str = "1.0.0"

    def compute_summary(self):
        """Recompute summary stats from verifications."""
        self.photos_checked = len(self.verifications)
        self.photos_passed = sum(1 for v in self.verifications if v.passed)
        self.photos_flagged = self.photos_checked - self.photos_passed

        all_flags = [f for v in self.verifications for f in v.flags]
        self.tier_1_count = sum(1 for f in all_flags if f.tier == "informational")
        self.tier_2_count = sum(1 for f in all_flags if f.tier == "review")
        self.tier_3_count = sum(1 for f in all_flags if f.tier == "critical")

        if self.tier_3_count > 0:
            self.overall_status = "critical_flags"
        elif self.tier_2_count > 0:
            self.overall_status = "review_needed"
        else:
            self.overall_status = "clean"

    def to_dict(self) -> dict:
        """Serialize for claim_config.json storage."""
        return {
            "last_checked": self.run_timestamp,
            "checker_version": self.checker_version,
            "overall_status": self.overall_status,
            "photos_checked": self.photos_checked,
            "photos_passed": self.photos_passed,
            "photos_flagged": self.photos_flagged,
            "tier_summary": {
                "tier_1": self.tier_1_count,
                "tier_2": self.tier_2_count,
                "tier_3": self.tier_3_count,
            },
            "flags": [
                f.to_dict()
                for v in self.verifications
                for f in v.flags
            ],
            "property_coordinates": self.property_coordinates,
        }

    def print_summary(self):
        """Print a formatted summary to stdout."""
        status_icon = {
            "clean": "PASSED",
            "review_needed": "REVIEW NEEDED",
            "critical_flags": "CRITICAL FLAGS",
        }
        icon = status_icon.get(self.overall_status, "UNKNOWN")
        print(f"\n  Photo Integrity: {icon}")
        print(f"  Photos checked: {self.photos_checked}")
        print(f"  Photos passed:  {self.photos_passed}")
        if self.photos_flagged > 0:
            print(f"  Photos flagged: {self.photos_flagged}")
            if self.tier_1_count:
                print(f"    Tier 1 (informational): {self.tier_1_count}")
            if self.tier_2_count:
                print(f"    Tier 2 (review):        {self.tier_2_count}")
            if self.tier_3_count:
                print(f"    Tier 3 (CRITICAL):      {self.tier_3_count}")
            print()
            for v in self.verifications:
                for f in v.flags:
                    tier_label = f.tier.upper()
                    print(f"    [{tier_label}] {f.photo_key}: {f.message}")
