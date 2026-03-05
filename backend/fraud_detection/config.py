"""
Central configuration for fraud detection thresholds and tier definitions.
All tunable constants live here — adjust without modifying logic modules.
"""

# --- EXIF Timestamp Validation ---
EXIF_TIMESTAMP_MAX_AGE_DAYS = 90          # Max days before date_of_loss a photo can be taken
EXIF_TIMESTAMP_WARN_AGE_DAYS = 180        # Beyond this → Tier 2
EXIF_TIMESTAMP_FUTURE_TOLERANCE_DAYS = 7  # Allow small clock drift

# --- GPS Distance Validation ---
GPS_MAX_DISTANCE_MILES = 0.25             # Tier 1 threshold
GPS_REVIEW_DISTANCE_MILES = 0.5           # Beyond this → Tier 2
GPS_CRITICAL_DISTANCE_MILES = 2.0         # Beyond this → Tier 3
GPS_MAX_DISTANCE_METERS = 402.336         # 0.25 miles in meters
GPS_REVIEW_DISTANCE_METERS = 804.672      # 0.5 miles in meters
GPS_CRITICAL_DISTANCE_METERS = 3218.688   # 2.0 miles in meters

# --- Duplicate Detection ---
DUPLICATE_HASH_THRESHOLD = 8              # Hamming distance for near-match
DUPLICATE_EXACT_THRESHOLD = 0             # Hamming distance for exact match

# --- Editing Software Detection ---
EDITING_SOFTWARE_SIGNATURES = [
    "adobe photoshop",
    "lightroom",
    "snapseed",
    "gimp",
    "pixelmator",
    "affinity photo",
    "picsart",
    "facetune",
    "canva",
    "photoshop express",
    "photoshop mix",
    "photoshop fix",
    "vsco",
    "prisma",
    "remini",
    "fotor",
    "inshot",
    "pic collage",
]

LEGITIMATE_SOFTWARE = [
    "companycam ios",
    "companycam android",
    "companycam",
    "",           # empty = native camera app
]

# --- Tier Definitions ---
TIER_1_INFORMATIONAL = "informational"   # Yellow — minor, accepted with note
TIER_2_REVIEW = "review"                 # Orange — held, admin reviews
TIER_3_CRITICAL = "critical"             # Red — suspected fraud

# --- Check Types ---
CHECK_EXIF_TIMESTAMP = "exif_timestamp"
CHECK_EXIF_MISSING = "exif_missing"
CHECK_GPS_DISTANCE = "gps_distance"
CHECK_GPS_MISSING = "gps_missing"
CHECK_EDITING_SOFTWARE = "editing_software"
CHECK_DUPLICATE_EXACT = "duplicate_exact"
CHECK_DUPLICATE_NEAR = "duplicate_near"
CHECK_MANIPULATION = "manipulation"       # Phase 2 stub
CHECK_DAMAGE_PATTERN = "damage_pattern"   # Phase 3 stub

# --- Duplicate Detection Exclusions ---
# Cover page photos (CompanyCam header/branding) are identical across claims by design.
# These are page 1 images with no EXIF data — skip them for duplicate detection.
DUPLICATE_SKIP_KEYS = {"p01_01", "p01_02", "p01_03", "p00_01"}

# --- Overall Status ---
STATUS_CLEAN = "clean"
STATUS_REVIEW_NEEDED = "review_needed"
STATUS_CRITICAL = "critical_flags"
