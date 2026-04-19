"""
EXIF metadata extraction and validation.
Handles timestamp checks, GPS extraction, editing software detection.
"""

import os
from datetime import datetime, timedelta
from typing import Optional, Tuple

from fraud_detection.config import (
    EXIF_TIMESTAMP_MAX_AGE_DAYS,
    EXIF_TIMESTAMP_WARN_AGE_DAYS,
    EXIF_TIMESTAMP_FUTURE_TOLERANCE_DAYS,
    EDITING_SOFTWARE_SIGNATURES,
    LEGITIMATE_SOFTWARE,
    TIER_1_INFORMATIONAL,
    TIER_2_REVIEW,
    TIER_3_CRITICAL,
    CHECK_EXIF_TIMESTAMP,
    CHECK_EXIF_MISSING,
    CHECK_EDITING_SOFTWARE,
)
from fraud_detection.models import PhotoMetadata, FraudFlag

try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


# EXIF tag IDs
EXIF_TAG_DATETIME_ORIGINAL = 36867
EXIF_TAG_DATETIME_DIGITIZED = 36868
EXIF_TAG_DATETIME = 306
EXIF_TAG_SOFTWARE = 305
EXIF_TAG_MAKE = 271
EXIF_TAG_MODEL = 272
EXIF_TAG_GPS_INFO = 34853
EXIF_TAG_FOCAL_LENGTH = 37386          # FocalLength (rational, mm at sensor)
EXIF_TAG_FOCAL_LENGTH_35MM = 41989     # FocalLengthIn35mmFilm (short, mm equivalent)

# GPS sub-tag IDs
GPS_TAG_LATITUDE_REF = 1
GPS_TAG_LATITUDE = 2
GPS_TAG_LONGITUDE_REF = 3
GPS_TAG_LONGITUDE = 4
GPS_TAG_ALTITUDE_REF = 5               # 0 = above sea level, 1 = below
GPS_TAG_ALTITUDE = 6                   # rational, meters
GPS_TAG_IMG_DIRECTION_REF = 16         # 'T' (true north) or 'M' (magnetic)
GPS_TAG_IMG_DIRECTION = 17             # rational, 0-360 degrees (compass bearing)


def _dms_to_decimal(dms_tuple, ref: str) -> Optional[float]:
    """Convert EXIF DMS (degrees, minutes, seconds) to decimal degrees."""
    try:
        degrees = float(dms_tuple[0])
        minutes = float(dms_tuple[1])
        seconds = float(dms_tuple[2])
        decimal = degrees + minutes / 60.0 + seconds / 3600.0
        if ref in ("S", "W"):
            decimal = -decimal
        return decimal
    except (TypeError, ValueError, IndexError, ZeroDivisionError):
        return None


def _rational_to_float(val) -> Optional[float]:
    """EXIF rational (numerator/denominator tuple or Pillow IFDRational) -> float."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        pass
    try:
        num, den = val
        if den == 0:
            return None
        return float(num) / float(den)
    except (TypeError, ValueError):
        return None


def _parse_exif_datetime(dt_string: str) -> Optional[datetime]:
    """Parse EXIF datetime string 'YYYY:MM:DD HH:MM:SS' to datetime."""
    if not dt_string or not isinstance(dt_string, str):
        return None
    dt_string = dt_string.strip().rstrip("\x00")
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y:%m:%d"):
        try:
            return datetime.strptime(dt_string, fmt)
        except ValueError:
            continue
    return None


def extract_metadata(file_path: str, photo_key: str) -> PhotoMetadata:
    """Extract all relevant EXIF metadata from a photo file."""
    meta = PhotoMetadata(file_path=file_path, photo_key=photo_key)

    if not HAS_PIL:
        return meta

    try:
        img = Image.open(file_path)
        meta.image_width, meta.image_height = img.size
    except Exception:
        return meta

    try:
        exif_data = img._getexif()
    except Exception:
        exif_data = None

    if not exif_data:
        return meta

    # Timestamp — prefer DateTimeOriginal, fall back to DateTimeDigitized, then DateTime
    for tag_id in (EXIF_TAG_DATETIME_ORIGINAL, EXIF_TAG_DATETIME_DIGITIZED, EXIF_TAG_DATETIME):
        raw = exif_data.get(tag_id)
        if raw:
            dt = _parse_exif_datetime(str(raw))
            if dt:
                meta.timestamp = dt.isoformat()
                break

    # Software
    software = exif_data.get(EXIF_TAG_SOFTWARE)
    if software:
        meta.software = str(software).strip()

    # Camera make/model
    make = exif_data.get(EXIF_TAG_MAKE)
    if make:
        meta.camera_make = str(make).strip()
    model = exif_data.get(EXIF_TAG_MODEL)
    if model:
        meta.camera_model = str(model).strip()

    # GPS coordinates, heading, altitude
    gps_info = exif_data.get(EXIF_TAG_GPS_INFO)
    if gps_info and isinstance(gps_info, dict):
        lat_dms = gps_info.get(GPS_TAG_LATITUDE)
        lat_ref = gps_info.get(GPS_TAG_LATITUDE_REF, "N")
        lon_dms = gps_info.get(GPS_TAG_LONGITUDE)
        lon_ref = gps_info.get(GPS_TAG_LONGITUDE_REF, "W")

        if lat_dms:
            meta.gps_lat = _dms_to_decimal(lat_dms, str(lat_ref))
        if lon_dms:
            meta.gps_lon = _dms_to_decimal(lon_dms, str(lon_ref))

        # Compass heading (camera pointing direction, 0-360 degrees)
        heading = _rational_to_float(gps_info.get(GPS_TAG_IMG_DIRECTION))
        if heading is not None and 0 <= heading <= 360:
            meta.heading = heading

        # Altitude in meters (negative if below sea level)
        altitude = _rational_to_float(gps_info.get(GPS_TAG_ALTITUDE))
        if altitude is not None:
            alt_ref = gps_info.get(GPS_TAG_ALTITUDE_REF, 0)
            try:
                if int(alt_ref) == 1:
                    altitude = -altitude
            except (TypeError, ValueError):
                pass
            meta.altitude = altitude

    # Focal length — prefer 35mm equivalent (directly comparable across sensors)
    focal_35 = exif_data.get(EXIF_TAG_FOCAL_LENGTH_35MM)
    if focal_35:
        try:
            meta.focal_length_mm = float(focal_35)
        except (TypeError, ValueError):
            pass
    if meta.focal_length_mm is None:
        focal_raw = _rational_to_float(exif_data.get(EXIF_TAG_FOCAL_LENGTH))
        if focal_raw is not None:
            meta.focal_length_mm = focal_raw

    return meta


def extract_exif_batch(photo_paths: list, photo_keys: Optional[list] = None) -> dict:
    """Extract EXIF metadata for a batch of photos.

    Returns a dict keyed by photo_key (or file basename if photo_keys is None).
    Only non-null fields are included per photo to keep the payload small.
    Safe to call even if Pillow is missing or photos lack EXIF — returns {} then.
    """
    if not HAS_PIL:
        return {}

    result = {}
    for i, path in enumerate(photo_paths):
        key = (photo_keys[i] if photo_keys and i < len(photo_keys) else os.path.basename(path))
        try:
            meta = extract_metadata(path, key)
        except Exception:
            continue
        entry = {}
        if meta.gps_lat is not None:
            entry["gps_lat"] = meta.gps_lat
        if meta.gps_lon is not None:
            entry["gps_lon"] = meta.gps_lon
        if meta.heading is not None:
            entry["heading"] = meta.heading
        if meta.altitude is not None:
            entry["altitude"] = meta.altitude
        if meta.focal_length_mm is not None:
            entry["focal_length_mm"] = meta.focal_length_mm
        if entry:
            result[key] = entry
    return result


def check_timestamp(
    metadata: PhotoMetadata,
    reference_date: Optional[datetime] = None,
) -> Optional[FraudFlag]:
    """
    Validate photo timestamp against reference date (date_of_loss or inspection_date).
    Returns a FraudFlag if issues detected, None if clean.
    """
    if not metadata.timestamp:
        return FraudFlag(
            photo_key=metadata.photo_key,
            check_type=CHECK_EXIF_MISSING,
            tier=TIER_1_INFORMATIONAL,
            message="No EXIF timestamp found — photo date cannot be verified",
            details={"field": "DateTimeOriginal"},
        )

    photo_dt = datetime.fromisoformat(metadata.timestamp)

    if reference_date is None:
        reference_date = datetime.now()

    # Future-dated photo (beyond tolerance)
    future_limit = reference_date + timedelta(days=EXIF_TIMESTAMP_FUTURE_TOLERANCE_DAYS)
    if photo_dt > future_limit:
        days_future = (photo_dt - reference_date).days
        return FraudFlag(
            photo_key=metadata.photo_key,
            check_type=CHECK_EXIF_TIMESTAMP,
            tier=TIER_2_REVIEW,
            message=f"Photo timestamp is {days_future} days in the future relative to reference date",
            details={
                "photo_timestamp": metadata.timestamp,
                "reference_date": reference_date.isoformat(),
                "days_future": days_future,
            },
        )

    # Photo older than warn threshold
    age_days = (reference_date - photo_dt).days
    if age_days > EXIF_TIMESTAMP_WARN_AGE_DAYS:
        return FraudFlag(
            photo_key=metadata.photo_key,
            check_type=CHECK_EXIF_TIMESTAMP,
            tier=TIER_2_REVIEW,
            message=f"Photo is {age_days} days old — significantly predates the claim",
            details={
                "photo_timestamp": metadata.timestamp,
                "reference_date": reference_date.isoformat(),
                "days_difference": age_days,
            },
        )

    # Photo older than max age
    if age_days > EXIF_TIMESTAMP_MAX_AGE_DAYS:
        return FraudFlag(
            photo_key=metadata.photo_key,
            check_type=CHECK_EXIF_TIMESTAMP,
            tier=TIER_1_INFORMATIONAL,
            message=f"Photo timestamp is {age_days} days before reference date (threshold: {EXIF_TIMESTAMP_MAX_AGE_DAYS})",
            details={
                "photo_timestamp": metadata.timestamp,
                "reference_date": reference_date.isoformat(),
                "days_difference": age_days,
            },
        )

    return None


def check_editing_software(metadata: PhotoMetadata) -> Optional[FraudFlag]:
    """
    Check if photo EXIF Software tag indicates editing software.
    Returns FraudFlag if editing software detected, None if clean.
    """
    if not metadata.software:
        return None

    software_lower = metadata.software.lower()

    # Skip known-legitimate software
    for legit in LEGITIMATE_SOFTWARE:
        if legit and legit.lower() in software_lower:
            return None

    # Check against editing software signatures
    for sig in EDITING_SOFTWARE_SIGNATURES:
        if sig.lower() in software_lower:
            return FraudFlag(
                photo_key=metadata.photo_key,
                check_type=CHECK_EDITING_SOFTWARE,
                tier=TIER_2_REVIEW,
                message=f"Editing software detected in EXIF: '{metadata.software}'",
                details={
                    "software_tag": metadata.software,
                    "matched_signature": sig,
                },
            )

    return None
