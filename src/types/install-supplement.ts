export interface InstallSupplement {
  id: string;
  claim_id: string;
  user_id: string;
  description: string;
  xactimate_code: string | null;
  category: string;
  qty: number;
  unit: string;
  unit_price: number;
  reason: string | null;
  building_code: string | null;
  photo_paths: string[];
  status: "draft" | "submitted" | "approved" | "denied";
  submitted_at: string | null;
  created_at: string;
}

export interface InstallSupplementCatalogItem {
  code: string;
  description: string;
  category: string;
  default_unit: string;
  default_unit_price: number;
  typical_reason: string;
  building_code: string | null;
}
