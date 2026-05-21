export interface RetailTemplateDocument {
  label: string;
  type: string;
  url: string;
}

export interface RetailTemplateMeta {
  template_id: string;
  template_name: string;
  manufacturer: string;
  product_line: string;
  shingle_class: string;
  wind_warranty_mph?: number;
  wind_warranty_with_layerlock_mph?: number;
  wind_warranty_with_starter_mph?: number;
  wind_warranty_special_install_mph?: number;
  impact_resistance?: string;
  algae_resistance?: string;
  polymer_technology?: string;
  smog_reducing_granules?: string;
  insurance_discount_note?: string;
  environmental_note?: string;
  legacy_aliases?: string[];
  legacy_note?: string;
  system_warranty: {
    name: string;
    term: string;
    requirements: string;
    transferable: boolean;
    transfer_window_years: number;
    tier_below?: string;
  };
  documents: RetailTemplateDocument[];
  pricing_model: string;
  base_price_per_sq_usd: number;
  base_price_includes_waste: boolean;
  base_includes: string[];
  base_excludes: string[];
  currency: string;
  as_of_date: string;
  notes?: string;
}

export interface RetailTemplateItem {
  line: number;
  category: string;
  code: string;
  description: string;
  unit: string;
  unit_price: number;
  quantity_formula: string;
  bundled_in_base: boolean;
  is_billing_line?: boolean;
  notes?: string;
}

export interface RetailTemplateAddon {
  code: string;
  description: string;
  unit: string;
  unit_price: number;
  notes?: string;
}

export interface RetailTemplate {
  _meta: RetailTemplateMeta;
  items: RetailTemplateItem[];
  add_ons: RetailTemplateAddon[];
  warranty_disclosure: string;
  suggested_substitutions?: Record<string, string>;
}
