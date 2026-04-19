-- DS/TAS calibration + per-slope photo mapping — combined schema migration.
--
-- Two product initiatives ship on this migration:
--  1. Persist DS/TAS component subscores so we can calibrate weights against
--     claim_outcomes (roadmap pillar 8, fast-win item 1).
--  2. Add per-slope photo mapping data (facet polygons, photo slope_id,
--     per-slope damage aggregation, >=25% full-reroof trigger) — roadmap
--     pillar 8 items 3-4.

-- ---------------------------------------------------------------
-- claims: DS/TAS component subscores (were computed in-memory, discarded)
-- ---------------------------------------------------------------
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS ds_roof_surface     smallint,
  ADD COLUMN IF NOT EXISTS ds_evidence_cascade smallint,
  ADD COLUMN IF NOT EXISTS ds_soft_metal       smallint,
  ADD COLUMN IF NOT EXISTS ds_documentation    smallint,
  ADD COLUMN IF NOT EXISTS ds_per_slope        smallint,
  ADD COLUMN IF NOT EXISTS tas_damage          real,
  ADD COLUMN IF NOT EXISTS tas_product         real,
  ADD COLUMN IF NOT EXISTS tas_code            real,
  ADD COLUMN IF NOT EXISTS tas_carrier         real,
  ADD COLUMN IF NOT EXISTS tas_scope           real,
  ADD COLUMN IF NOT EXISTS score_version       text DEFAULT 'v1';

COMMENT ON COLUMN claims.ds_roof_surface IS
  'Damage Score component A: Roof Surface Damage (currently weighted 40pts of 100). See backend/damage_scoring/damage_scorer.py.';
COMMENT ON COLUMN claims.ds_evidence_cascade IS
  'Damage Score component B: Evidence Cascade (currently 25pts).';
COMMENT ON COLUMN claims.ds_soft_metal IS
  'Damage Score component C: Soft Metal (currently 20pts).';
COMMENT ON COLUMN claims.ds_documentation IS
  'Damage Score component D: Documentation Quality (currently 15pts).';
COMMENT ON COLUMN claims.ds_per_slope IS
  'Damage Score component E: Per-Slope Severity (reserved for Phase 4 rebalance once slope_damage is populated).';
COMMENT ON COLUMN claims.tas_damage IS
  'Technical Approval Score: Damage factor component (35% weight).';
COMMENT ON COLUMN claims.tas_product IS
  'Technical Approval Score: Product component (25% weight).';
COMMENT ON COLUMN claims.tas_code IS
  'Technical Approval Score: Code Triggers component (20% weight).';
COMMENT ON COLUMN claims.tas_carrier IS
  'Technical Approval Score: Carrier Behavior component (10% weight).';
COMMENT ON COLUMN claims.tas_scope IS
  'Technical Approval Score: Scope component (10% weight).';
COMMENT ON COLUMN claims.score_version IS
  'Scoring weight-set version the aggregate + subscores were computed with. Enables A/B of recalibrated weights (v1=original heuristic, v2=data-calibrated).';

-- ---------------------------------------------------------------
-- claims: per-slope photo mapping + full-reroof trigger
-- ---------------------------------------------------------------
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS roof_facets          jsonb,
  ADD COLUMN IF NOT EXISTS slope_damage         jsonb,
  ADD COLUMN IF NOT EXISTS full_reroof_trigger  boolean DEFAULT false;

COMMENT ON COLUMN claims.roof_facets IS
  'Per-facet polygons extracted from EagleView overhead via Claude Vision second pass. Shape: [{facet_id, cardinal, pitch, area_sf, polygon_pixels:[[x,y],...], area_pct}] plus north_arrow_angle + scale_bar. Drives per-slope damage aggregation and roof map UI.';
COMMENT ON COLUMN claims.slope_damage IS
  'Per-slope damage aggregation computed from photos. Shape: [{facet_id, total_photos, damage_photos, weighted_damage_pct (critical=3x, severe=2x, moderate=1x, minor=0.5x), dominant_damage_type}].';
COMMENT ON COLUMN claims.full_reroof_trigger IS
  'True when any slope_damage[].weighted_damage_pct >= 0.25 (carrier-standard threshold). Drives auto-selection of full-reroof line items in estimate + forensic narrative.';

-- Index the trigger for dashboard filtering.
CREATE INDEX IF NOT EXISTS idx_claims_full_reroof_trigger
  ON claims (last_processed_at DESC)
  WHERE full_reroof_trigger = true;

-- ---------------------------------------------------------------
-- photos: EXIF heading/altitude/focal length + slope assignment
-- ---------------------------------------------------------------
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS heading          real,
  ADD COLUMN IF NOT EXISTS altitude         real,
  ADD COLUMN IF NOT EXISTS focal_length_mm  real,
  ADD COLUMN IF NOT EXISTS slope_id         text;

COMMENT ON COLUMN photos.heading IS
  'EXIF GPSImgDirection (tag 17) — compass bearing 0-360 deg the camera was pointing. Null for non-phone uploads. Key input to photo->slope assignment.';
COMMENT ON COLUMN photos.altitude IS
  'EXIF GPSAltitude (tag 6) in meters. Helps distinguish aerial drone shots from ground photos.';
COMMENT ON COLUMN photos.focal_length_mm IS
  'EXIF FocalLength (tag 37386) in 35mm equivalent. Used for field-of-view calcs in V2 polygon ray-cast.';
COMMENT ON COLUMN photos.slope_id IS
  'Facet ID this photo was assigned to (matches claims.roof_facets[].facet_id). Null = unassigned (no GPS/heading and Vision fallback inconclusive).';

-- Index for "show all photos on facet F1" queries from the roof map UI.
CREATE INDEX IF NOT EXISTS idx_photos_slope_id
  ON photos (claim_id, slope_id)
  WHERE slope_id IS NOT NULL;
