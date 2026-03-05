"""
Phase 2 stub: Image manipulation detection.
ELA (Error Level Analysis), clone stamp detection, content-aware fill patterns.
Not implemented in Phase 1 — function signatures defined for pipeline interface stability.
"""

from typing import Optional, List
from fraud_detection.models import PhotoMetadata, FraudFlag


def check_ela(file_path: str, metadata: PhotoMetadata) -> Optional[FraudFlag]:
    """
    Phase 2: Error Level Analysis.
    Detects JPEG re-compression artifacts that indicate image editing.
    Requires: opencv-python, numpy
    """
    return None  # Phase 2


def check_clone_stamp(file_path: str, metadata: PhotoMetadata) -> Optional[FraudFlag]:
    """
    Phase 2: Clone stamp / copy-paste detection.
    Detects statistically identical regions within an image.
    Requires: opencv-python, scikit-image
    """
    return None  # Phase 2


def check_content_aware_fill(file_path: str, metadata: PhotoMetadata) -> Optional[FraudFlag]:
    """
    Phase 2: Content-aware fill pattern detection.
    Detects AI inpainting artifacts.
    Requires: trained model (Phase 3)
    """
    return None  # Phase 2


def run_manipulation_checks(file_path: str, metadata: PhotoMetadata) -> List[FraudFlag]:
    """
    Run all manipulation detection checks.
    Returns list of FraudFlags (empty in Phase 1).
    """
    flags = []
    for check_fn in (check_ela, check_clone_stamp, check_content_aware_fill):
        result = check_fn(file_path, metadata)
        if result:
            flags.append(result)
    return flags
