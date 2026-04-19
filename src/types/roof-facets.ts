// Per-slope roof facets + damage aggregation — written by backend/processor.py
// (extract_roof_facets + slope_mapping.aggregate_slope_damage).

export type Cardinal = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface RoofFacet {
  facet_id: string;
  cardinal?: Cardinal | null;
  pitch?: string | null;
  area_pct?: number | null;
  // Normalized 0-1000 on both axes (origin top-left). Clockwise corners.
  polygon_pixels?: Array<[number, number]>;
}

export interface RoofFacetsPayload {
  roof_facets: RoofFacet[];
  // Degrees clockwise from image-up (0 = north is up)
  north_arrow_angle?: number;
  scale_bar?: { pixels: number; feet: number } | null;
  // True when the backend synthesized a 4-cardinal skeleton because Vision
  // couldn't extract facets from the measurement PDF. UI should render as a
  // cardinal list/compass-rose rather than an overhead polygon map.
  _synthesized?: boolean;
}

export interface SlopeDamageRow {
  facet_id: string;
  cardinal?: Cardinal | null;
  pitch?: string | null;
  area_pct?: number | null;
  total_photos: number;
  damage_photos: number;
  weighted_damage_pct: number;
  dominant_damage_type?: string | null;
}

export interface RoofPhotoMapPhoto {
  annotation_key: string;
  filename?: string | null;
  slope_id?: string | null;
  damage_type?: string | null;
  severity?: string | null;
  annotation_text?: string | null;
  heading?: number | null;
}
