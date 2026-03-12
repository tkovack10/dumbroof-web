export interface LineItemForReview {
  id: string;
  claim_id: string;
  category: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  total: number;
  xactimate_code: string | null;
  trade: string | null;
  source: string;
  feedback_status: "approved" | "corrected" | "removed" | null;
}

export interface LineItemFeedback {
  line_item_id: string;
  status: "approved" | "corrected" | "removed";
  corrected_description?: string;
  corrected_qty?: number;
  corrected_unit_price?: number;
  corrected_unit?: string;
  notes?: string;
}

export interface NewLineItem {
  claim_id: string;
  category: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
}

export interface ScopeReviewResponse {
  items: LineItemForReview[];
  contractor_rcv: number;
  total_items: number;
  reviewed_count: number;
  categories: string[];
}
