export interface InvoiceLineItem {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  total: number;
}

export interface Invoice {
  id: string;
  claim_id: string;
  invoice_number: string;
  invoice_type: "carrier_supplement" | "homeowner_deductible" | "homeowner_balance" | "custom";
  recipient_name: string | null;
  recipient_email: string | null;
  line_items: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  o_and_p: number;
  total: number;
  deductible_applied: number;
  amount_due: number;
  notes: string | null;
  due_date: string | null;
  pdf_path: string | null;
  status: "draft" | "sent" | "paid" | "overdue";
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
}
