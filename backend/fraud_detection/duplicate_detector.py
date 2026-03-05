"""
Perceptual hash-based duplicate photo detection.
Detects when the same photo (or near-identical edit) appears across different claims.
"""

from typing import List, Optional

from fraud_detection.config import (
    DUPLICATE_HASH_THRESHOLD,
    DUPLICATE_EXACT_THRESHOLD,
    TIER_1_INFORMATIONAL,
    TIER_2_REVIEW,
    TIER_3_CRITICAL,
    CHECK_DUPLICATE_EXACT,
    CHECK_DUPLICATE_NEAR,
)
from fraud_detection.models import PhotoMetadata, FraudFlag

try:
    import imagehash
    from PIL import Image
    HAS_IMAGEHASH = True
except ImportError:
    HAS_IMAGEHASH = False


def compute_hash(file_path: str) -> Optional[str]:
    """
    Compute perceptual hash (pHash) for a photo.
    Returns hex string representation, or None if libraries unavailable.
    """
    if not HAS_IMAGEHASH:
        return None

    try:
        img = Image.open(file_path)
        h = imagehash.phash(img, hash_size=16)
        return str(h)
    except Exception:
        return None


def hamming_distance(hash1: str, hash2: str) -> int:
    """
    Compute Hamming distance between two hex hash strings.
    Lower distance = more similar images.
    """
    if not hash1 or not hash2:
        return 999  # Sentinel for "cannot compare"

    try:
        if HAS_IMAGEHASH:
            h1 = imagehash.hex_to_hash(hash1)
            h2 = imagehash.hex_to_hash(hash2)
            return h1 - h2
        else:
            # Manual fallback
            int1 = int(hash1, 16)
            int2 = int(hash2, 16)
            xor = int1 ^ int2
            return bin(xor).count("1")
    except (ValueError, TypeError):
        return 999


def check_duplicates(
    metadata: PhotoMetadata,
    claim_slug: str,
    db,
) -> List[FraudFlag]:
    """
    Check photo hash against database for cross-claim duplicates.
    Returns list of FraudFlags (empty if no duplicates found).
    """
    flags = []

    if not metadata.perceptual_hash:
        return flags

    if db is None:
        return flags

    # Query database for similar hashes
    matches = db.find_duplicate_hashes(
        phash=metadata.perceptual_hash,
        threshold=DUPLICATE_HASH_THRESHOLD,
        exclude_claim=claim_slug,
    )

    for match in matches:
        distance = match["hamming_distance"]
        match_claim = match["claim_slug"]
        match_key = match["photo_key"]

        if distance <= DUPLICATE_EXACT_THRESHOLD:
            # Exact duplicate across claims — critical
            flags.append(FraudFlag(
                photo_key=metadata.photo_key,
                check_type=CHECK_DUPLICATE_EXACT,
                tier=TIER_3_CRITICAL,
                message=f"Exact duplicate photo found in claim '{match_claim}' (photo {match_key})",
                details={
                    "match_claim": match_claim,
                    "match_photo_key": match_key,
                    "hamming_distance": distance,
                    "this_hash": metadata.perceptual_hash,
                    "match_hash": match["phash"],
                },
            ))
        else:
            # Near-match — review
            flags.append(FraudFlag(
                photo_key=metadata.photo_key,
                check_type=CHECK_DUPLICATE_NEAR,
                tier=TIER_2_REVIEW,
                message=f"Near-duplicate photo found in claim '{match_claim}' (photo {match_key}, similarity: {100 - distance}%)",
                details={
                    "match_claim": match_claim,
                    "match_photo_key": match_key,
                    "hamming_distance": distance,
                    "this_hash": metadata.perceptual_hash,
                    "match_hash": match["phash"],
                },
            ))

    return flags
