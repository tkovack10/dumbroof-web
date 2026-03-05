"""
Product discontinuation matching engine.
Cross-references identified shingle products against the discontinuation database.
"""

import json
import os
from typing import Optional, List, Dict, Any

from damage_scoring.models import ProductMatch

_DB_PATH = os.path.join(os.path.dirname(__file__), "product_data.json")
_product_db = None


def _load_db() -> dict:
    """Load product database (cached)."""
    global _product_db
    if _product_db is None:
        with open(_DB_PATH, "r") as f:
            _product_db = json.load(f)
    return _product_db


def match_product(
    manufacturer: str = "",
    product_line: str = "",
    product_type: str = "",
    exposure_inches: float = 0.0,
) -> ProductMatch:
    """
    Match a shingle product against the discontinuation database.
    Returns ProductMatch with match details and TAS boost.
    """
    db = _load_db()
    products = db.get("discontinued_products", [])
    universal = db.get("universal_categories", {})

    # Normalize inputs
    mfr_lower = manufacturer.lower().strip()
    line_lower = product_line.lower().strip()
    type_lower = product_type.lower().strip()

    # Check universal categories first (T-Lock, organic mat, asbestos)
    for cat_key, cat in universal.items():
        if cat_key.replace("_", " ") in line_lower or cat_key.replace("_", "-") in line_lower:
            return ProductMatch(
                matched=True,
                manufacturer=manufacturer or "Various",
                product_line=product_line or cat["description"],
                product_type=product_type or cat_key,
                status="universally_discontinued",
                discontinuation_year=cat.get("last_manufactured"),
                matching_difficulty=cat["matching_difficulty"],
                car_repairability=cat["car_repairability"],
                tas_boost=cat["tas_boost"],
                confidence=0.95,
            )

    # Check for T-Lock by type
    if "t-lock" in type_lower or "tlock" in type_lower or "t lock" in type_lower:
        cat = universal.get("t_lock", {})
        return ProductMatch(
            matched=True,
            manufacturer=manufacturer or "Various",
            product_line=product_line or "T-Lock",
            product_type="t_lock",
            status="universally_discontinued",
            discontinuation_year=2005,
            matching_difficulty="impossible",
            car_repairability=False,
            tas_boost=12,
            confidence=0.95,
        )

    # Check for organic mat by type
    if "organic" in type_lower:
        cat = universal.get("organic_mat", {})
        return ProductMatch(
            matched=True,
            manufacturer=manufacturer or "Various",
            product_line=product_line or "Organic Mat",
            product_type="organic_mat",
            status="universally_discontinued",
            discontinuation_year=2008,
            matching_difficulty="impossible",
            car_repairability=False,
            tas_boost=12,
            confidence=0.95,
        )

    # Score each product in DB
    best_match = None
    best_score = 0.0

    for product in products:
        score = _match_score(product, mfr_lower, line_lower, type_lower, exposure_inches)
        if score > best_score:
            best_score = score
            best_match = product

    if best_match and best_score >= 0.4:
        return ProductMatch(
            matched=True,
            manufacturer=best_match["manufacturer"],
            product_line=best_match["product_line"],
            product_type=best_match["type"],
            exposure_inches=best_match["exposure_inches"],
            status=best_match["status"],
            discontinuation_year=best_match.get("discontinuation_year"),
            compatible_replacements=best_match.get("compatible_replacements", []),
            matching_difficulty=best_match["matching_difficulty"],
            car_compatibility=best_match.get("car_compatibility", True),
            car_availability=best_match.get("car_availability", True),
            car_repairability=best_match.get("car_repairability", True),
            tas_boost=best_match.get("tas_boost", 0),
            confidence=min(1.0, best_score),
        )

    # No match — check exposure alone for discontinuation signal
    # ANY shingle (3-tab OR laminate) at 5" exposure is unrepairable.
    # TAMKO was the last manufacturer to produce 5" laminates (~2012).
    # All manufacturers stopped 5" 3-tabs by ~2023 (GAF Royal Sovereign was last).
    if exposure_inches and exposure_inches <= 5.25:
        # Strong signal: 5" or 5-1/8" exposure = pre-metric, unrepairable
        inferred_type = product_type or type_lower
        if not inferred_type or inferred_type == "unknown":
            inferred_type = "asphalt_shingle"
        return ProductMatch(
            matched=True,
            manufacturer=manufacturer or "Unknown",
            product_line=product_line or f"Pre-metric {inferred_type} (5\" exposure)",
            product_type=inferred_type,
            exposure_inches=exposure_inches,
            status="discontinued",
            discontinuation_year=2012 if "architect" in inferred_type or "laminate" in inferred_type else 2023,
            matching_difficulty="impossible",
            car_compatibility=False,
            car_availability=False,
            car_repairability=False,
            tas_boost=12,
            confidence=0.7,
        )

    # IKO Advantage size — can only repair with IKO products
    if exposure_inches and 5.75 < exposure_inches <= 6.0:
        if not mfr_lower or "iko" not in mfr_lower:
            return ProductMatch(
                matched=False,
                product_type=product_type or "architectural",
                exposure_inches=exposure_inches,
                status="active",
                matching_difficulty="hard",
                car_repairability=True,
                tas_boost=0,
                confidence=0.3,
            )

    return ProductMatch(matched=False)


def _match_score(
    product: dict,
    mfr_lower: str,
    line_lower: str,
    type_lower: str,
    exposure: float,
) -> float:
    """Score how well a product matches the input."""
    score = 0.0

    # Manufacturer match (strong signal)
    prod_mfr = product["manufacturer"].lower()
    if mfr_lower and mfr_lower in prod_mfr or prod_mfr in mfr_lower:
        score += 0.35
    # Handle acquisitions
    if "elk" in mfr_lower and "gaf" in prod_mfr:
        score += 0.2
    if "bird" in mfr_lower and "certainteed" in prod_mfr:
        score += 0.2

    # Product line match (strongest signal)
    prod_line = product["product_line"].lower()
    if line_lower:
        if line_lower == prod_line:
            score += 0.45
        elif line_lower in prod_line or prod_line in line_lower:
            score += 0.35
        # Partial word match
        line_words = set(line_lower.split())
        prod_words = set(prod_line.split())
        common = line_words & prod_words
        if common and not (line_lower in prod_line or prod_line in line_lower):
            score += 0.15 * len(common) / max(len(line_words), len(prod_words))

    # Type match
    prod_type = product["type"].lower()
    if type_lower and type_lower in prod_type:
        score += 0.1

    # Exposure match (useful when product line unknown)
    if exposure > 0:
        prod_exp = product.get("exposure_inches", 0)
        if prod_exp > 0 and abs(exposure - prod_exp) < 0.01:
            score += 0.1

    return score


def get_all_discontinued() -> List[dict]:
    """Return all discontinued products."""
    db = _load_db()
    return [p for p in db.get("discontinued_products", [])
            if p.get("status") == "discontinued"]


def get_exposure_standards() -> dict:
    """Return exposure standards reference."""
    db = _load_db()
    return db.get("exposure_standards", {})
