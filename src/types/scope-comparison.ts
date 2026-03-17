export interface ManufacturerSpec {
  manufacturer: string;
  document: string;
  requirement: string;
  warranty_void: boolean;
  warranty_text: string;
}

export interface CodeCitation {
  code_tag: string;
  section: string;
  title: string;
  requirement: string;
  supplement_argument: string;
  manufacturer_specs: ManufacturerSpec[];
  has_warranty_void: boolean;
  jurisdiction: string;
}

export interface ScopeComparisonRow {
  checklist_desc: string;
  usarm_desc: string;
  usarm_amount: number;
  ev_qty: number;
  ev_unit: string;
  ev_formula: string;
  xact_code: string;
  xact_unit_price: number;
  carrier_desc: string;
  carrier_amount: number;
  carrier_qty: number;
  carrier_unit: string;
  carrier_unit_price: number;
  carrier_notes: string;
  matched_by: string;
  status: string;
  note: string;
  code_citation: CodeCitation | null;
  irc_code: string;
  supplement_argument: string;
  carrier_trick: string;
  trick_flag: string;
  qty_variance: string;
  price_variance: string;
  unit_mismatch: string;
  category: string;
  trade: string;
}

export interface CarrierLineItem {
  item: string;
  carrier_desc: string;
  qty: number;
  unit: string;
  unit_price: number;
  carrier_amount: number;
  xact_code: string;
  notes: string;
}

export interface ScopeComparisonSummary {
  total_items: number;
  missing_count: number;
  under_count: number;
  match_count: number;
  carrier_only_count: number;
  tricks_detected: string[];
}

export interface ScopeComparisonFinancials {
  carrier_rcv: number;
  contractor_rcv: number;
  variance: number;
  deductible: number;
  tax_rate: number;
  o_and_p: number;
  o_and_p_enabled: boolean;
  supplement_opportunity: number;
}

export interface ScopeComparisonResponse {
  comparison_rows: ScopeComparisonRow[];
  carrier_line_items: CarrierLineItem[];
  financials: ScopeComparisonFinancials;
  summary: ScopeComparisonSummary;
}
