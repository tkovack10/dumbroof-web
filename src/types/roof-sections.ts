export interface RoofSection {
  structure_index: number;
  structure_name: string;
  pitch: string;
  area_sf: number;
  area_sq: number;
  percent: number;
  detected_material: string;
  user_material_override: string | null;
}

export interface RoofSectionsData {
  provider: string;
  sections: RoofSection[];
  total_area_sf: number;
  total_area_sq: number;
}

export const ROOF_MATERIALS = [
  { value: "asphalt_shingle", label: "Asphalt Shingle" },
  { value: "laminated", label: "Laminated Shingle" },
  { value: "3tab", label: "3-Tab Shingle" },
  { value: "metal_standing_seam", label: "Standing Seam Metal" },
  { value: "metal", label: "Metal Panel" },
  { value: "slate", label: "Slate" },
  { value: "tile", label: "Clay Tile" },
  { value: "concrete_tile", label: "Concrete Tile" },
  { value: "wood_shake", label: "Wood Shake" },
  { value: "flat", label: "TPO / Flat" },
  { value: "epdm", label: "EPDM" },
  { value: "modified_bitumen", label: "Modified Bitumen" },
] as const;

export type RoofMaterialValue = (typeof ROOF_MATERIALS)[number]["value"];
