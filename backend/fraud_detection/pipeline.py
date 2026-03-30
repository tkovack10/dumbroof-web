"""
Fraud detection pipeline orchestrator.
Runs all Phase 1 checks on a claim's photos, aggregates results.
"""

import os
import glob
from datetime import datetime
from typing import Optional, List, Tuple

from fraud_detection.config import (
    STATUS_CLEAN,
    STATUS_REVIEW_NEEDED,
    STATUS_CRITICAL,
    DUPLICATE_SKIP_KEYS,
)
from fraud_detection.models import (
    PhotoMetadata,
    FraudFlag,
    PhotoVerification,
    ClaimIntegrityReport,
)
from fraud_detection.exif_analyzer import (
    extract_metadata,
    check_timestamp,
    check_editing_software,
)
from fraud_detection.geo_validator import (
    check_gps_distance,
    compute_gps_consensus,
)
from fraud_detection.duplicate_detector import (
    compute_hash,
    check_duplicates,
)
from fraud_detection.manipulation_detector import run_manipulation_checks
from fraud_detection.geocoder import get_property_coordinates
from fraud_detection.db import FraudDB


def _discover_photos(config: dict) -> List[Tuple[str, str]]:
    """
    Discover all photos for a claim.
    Returns list of (photo_key, file_path) tuples.
    """
    photos_dir = config.get("_photos_dir", "")
    photo_map = config.get("photo_map", {})
    results = []

    if photo_map:
        # Use explicit photo_map
        for key, filename in photo_map.items():
            path = os.path.join(photos_dir, filename)
            if os.path.exists(path):
                results.append((key, path))
    else:
        # Glob for standard CompanyCam naming pattern
        pattern = os.path.join(photos_dir, "page*_img*_*.jpeg")
        for path in sorted(glob.glob(pattern)):
            basename = os.path.basename(path)
            # Extract page and img numbers from filename
            # Format: page03_img01_1512x2016.jpeg
            parts = basename.split("_")
            if len(parts) >= 2:
                try:
                    page_str = parts[0].replace("page", "")
                    img_str = parts[1].replace("img", "")
                    page = int(page_str)
                    img = int(img_str)
                    key = f"p{page:02d}_{img:02d}"
                    results.append((key, path))
                except (ValueError, IndexError):
                    continue

        # Also check for JPEG/JPG files that might be non-standard names
        if not results:
            for ext in ("*.jpeg", "*.jpg", "*.JPEG", "*.JPG"):
                for path in sorted(glob.glob(os.path.join(photos_dir, ext))):
                    basename = os.path.basename(path)
                    if basename.lower().startswith("usarm_logo"):
                        continue  # Skip logo
                    key = os.path.splitext(basename)[0]
                    results.append((key, path))

    return results


def _parse_reference_date(config: dict) -> Optional[datetime]:
    """
    Extract reference date from claim config for timestamp validation.
    Uses the LATEST available date — photos should be taken at or before the
    most recent inspection, not necessarily the date of loss.
    """
    dates = config.get("dates", {})
    candidates = []

    def try_parse(date_str):
        if not date_str or not isinstance(date_str, str):
            return None
        for fmt in ("%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y"):
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        return None

    # Report date (best reference — latest known date for the claim)
    dt = try_parse(dates.get("report_date"))
    if dt:
        candidates.append(dt)

    # Carrier inspection date
    dt = try_parse(dates.get("carrier_inspection_date"))
    if dt:
        candidates.append(dt)

    # Fall back to date_of_loss
    dt = try_parse(dates.get("date_of_loss"))
    if dt:
        candidates.append(dt)

    # Return the latest date — photos must predate this
    if candidates:
        return max(candidates)

    return None


def run_fraud_checks(
    config: dict,
    claim_slug: str,
    db: Optional[FraudDB] = None,
    skip_duplicates: bool = False,
) -> ClaimIntegrityReport:
    """
    Run all Phase 1 fraud detection checks on a claim's photos.

    Args:
        config: Loaded claim_config.json dict (with _photos_dir resolved)
        claim_slug: Claim directory name (e.g., "73-theron-st")
        db: FraudDB instance (created automatically if None)
        skip_duplicates: Skip duplicate detection (for backfill operations)

    Returns:
        ClaimIntegrityReport with all verification results
    """
    # Initialize report
    prop = config.get("property", {})
    address = f"{prop.get('address', '')}, {prop.get('city', '')}, {prop.get('state', '')}"
    report = ClaimIntegrityReport(
        claim_slug=claim_slug,
        property_address=address,
        run_timestamp=datetime.now().isoformat(),
    )

    # Initialize DB
    if db is None:
        try:
            db = FraudDB()
        except Exception as e:
            print(f"  WARN: FraudDB init failed: {e}")
            db = None

    # Discover photos
    photos = _discover_photos(config)
    if not photos:
        report.compute_summary()
        return report

    # Get property coordinates
    property_coords = get_property_coordinates(config)

    # Phase 1: Extract metadata for all photos
    metadata_list = []
    for photo_key, file_path in photos:
        meta = extract_metadata(file_path, photo_key)
        meta.perceptual_hash = compute_hash(file_path)
        metadata_list.append(meta)

    # If no property coords from config/geocoder, try GPS consensus
    if property_coords is None:
        consensus = compute_gps_consensus(metadata_list)
        if consensus:
            property_coords = consensus
            report.property_coordinates = {
                "latitude": consensus[0],
                "longitude": consensus[1],
                "source": "exif_consensus",
            }
    else:
        report.property_coordinates = {
            "latitude": property_coords[0],
            "longitude": property_coords[1],
            "source": "config" if prop.get("latitude") else "geocoded",
        }

    # Get reference date for timestamp validation
    reference_date = _parse_reference_date(config)

    # Phase 1: Run checks on each photo
    for meta in metadata_list:
        verification = PhotoVerification(
            photo_key=meta.photo_key,
            file_path=meta.file_path,
            metadata=meta,
        )

        # Check 1: Timestamp validation
        ts_flag = check_timestamp(meta, reference_date)
        if ts_flag:
            verification.flags.append(ts_flag)

        # Check 2: GPS distance validation
        if property_coords:
            gps_flag = check_gps_distance(meta, property_coords[0], property_coords[1])
            if gps_flag:
                verification.flags.append(gps_flag)

        # Check 3: Editing software detection
        sw_flag = check_editing_software(meta)
        if sw_flag:
            verification.flags.append(sw_flag)

        # Check 4: Duplicate detection (cross-claim)
        # Skip cover page photos (CompanyCam branding — identical by design)
        if not skip_duplicates and db and meta.perceptual_hash:
            if meta.photo_key not in DUPLICATE_SKIP_KEYS:
                dup_flags = check_duplicates(meta, claim_slug, db)
                verification.flags.extend(dup_flags)

        # Check 5: Manipulation detection (Phase 2 stubs — returns empty)
        manip_flags = run_manipulation_checks(meta.file_path, meta)
        verification.flags.extend(manip_flags)

        report.verifications.append(verification)

        # Log flags to DB
        if db:
            for f in verification.flags:
                try:
                    db.log_flag(claim_slug, f)
                except Exception as e:
                    print(f"  WARN: DB flag logging failed for {meta.photo_key}: {e}")

        # Register hash in DB for future duplicate detection
        if db and meta.perceptual_hash:
            try:
                db.register_hash(
                    claim_slug=claim_slug,
                    photo_key=meta.photo_key,
                    file_path=meta.file_path,
                    phash=meta.perceptual_hash,
                    timestamp=meta.timestamp,
                    gps_lat=meta.gps_lat,
                    gps_lon=meta.gps_lon,
                )
            except Exception as e:
                print(f"  WARN: Hash registration failed for {meta.photo_key}: {e}")

    report.compute_summary()
    return report


def backfill_claim(config: dict, claim_slug: str, db: FraudDB) -> int:
    """
    Backfill hash database from an existing claim's photos.
    Skips duplicate checks (since we're building the baseline).
    Returns number of photos registered.
    """
    photos = _discover_photos(config)
    count = 0

    for photo_key, file_path in photos:
        meta = extract_metadata(file_path, photo_key)
        phash = compute_hash(file_path)
        if phash:
            db.register_hash(
                claim_slug=claim_slug,
                photo_key=photo_key,
                file_path=file_path,
                phash=phash,
                timestamp=meta.timestamp,
                gps_lat=meta.gps_lat,
                gps_lon=meta.gps_lon,
            )
            count += 1

    return count
