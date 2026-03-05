"""
DumbRoof.ai Fraud Detection & Integrity System
Phase 1 MVP: EXIF validation, GPS verification, duplicate detection, editing software detection.
"""

__version__ = "1.0.0"

from fraud_detection.models import (
    PhotoMetadata,
    FraudFlag,
    PhotoVerification,
    ClaimIntegrityReport,
)
from fraud_detection.pipeline import run_fraud_checks
