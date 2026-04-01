/**
 * USARM AOB NY — 2-page template field definitions.
 *
 * Coordinate system: pdf-lib (origin bottom-left, y increases upward).
 * Page size: 612 × 792 (US Letter).
 *
 * Field types: text | signature | initials | date | checkbox
 * filledBy:
 *   "auto"   — resolved from claim / company profile data
 *   "sender" — rep fills before sending
 *   "signer" — homeowner fills during signing
 */

export interface TemplateField {
  id: string;
  label: string;
  type: "text" | "signature" | "initials" | "date" | "checkbox";
  page: number; // 0-indexed
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  filledBy: "auto" | "sender" | "signer";
  binding?: string; // auto-fill key
  required?: boolean;
  group?: string;
}

// Binding keys resolved at fill time
export type BindingKey =
  | "homeowner_name"
  | "homeowner_phone"
  | "homeowner_email"
  | "address"
  | "city_state_zip"
  | "carrier"
  | "claim_number"
  | "adjuster_info"
  | "date_of_loss"
  | "rep_name"
  | "rep_date"
  | "current_date"
  | "job_number";

export const USARM_AOB_NY_FIELDS: TemplateField[] = [
  // ==========================================
  // PAGE 1 — Authorization & Assignment
  // ==========================================

  // --- Header fields (auto/sender) ---
  {
    id: "owner_name_p1",
    label: "Owner(s)",
    type: "text",
    page: 0,
    x: 75,
    y: 653,
    width: 270,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "homeowner_name",
    required: true,
    group: "header",
  },
  {
    id: "phone_p1",
    label: "Phone",
    type: "text",
    page: 0,
    x: 400,
    y: 653,
    width: 150,
    height: 12,
    fontSize: 9,
    filledBy: "sender",
    binding: "homeowner_phone",
    group: "header",
  },
  {
    id: "address_p1",
    label: "Address",
    type: "text",
    page: 0,
    x: 70,
    y: 631,
    width: 280,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "address",
    required: true,
    group: "header",
  },
  {
    id: "email_p1",
    label: "Email",
    type: "text",
    page: 0,
    x: 405,
    y: 631,
    width: 160,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "homeowner_email",
    group: "header",
  },
  {
    id: "insurance_co_p1",
    label: "Insurance Co.",
    type: "text",
    page: 0,
    x: 100,
    y: 609,
    width: 115,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "carrier",
    group: "header",
  },
  {
    id: "claim_number_p1",
    label: "Claim #",
    type: "text",
    page: 0,
    x: 265,
    y: 609,
    width: 85,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "claim_number",
    group: "header",
  },
  {
    id: "adjuster_info_p1",
    label: "Adjuster Info",
    type: "text",
    page: 0,
    x: 398,
    y: 609,
    width: 180,
    height: 12,
    fontSize: 9,
    filledBy: "sender",
    binding: "adjuster_info",
    group: "header",
  },

  // --- Section 1: Claim assignment ---
  {
    id: "claim_no_s1",
    label: "Claim No.",
    type: "text",
    page: 0,
    x: 170,
    y: 530,
    width: 130,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "claim_number",
    group: "section1",
  },
  {
    id: "loss_date_s1",
    label: "Loss Date",
    type: "text",
    page: 0,
    x: 395,
    y: 530,
    width: 90,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "date_of_loss",
    group: "section1",
  },

  // --- Section 2: Agreement reference ---
  {
    id: "section_ref",
    label: "Section",
    type: "text",
    page: 0,
    x: 414,
    y: 468,
    width: 45,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "section_ref", // always "2"
    group: "section2",
  },
  {
    id: "agreement_date",
    label: "Agreement Date",
    type: "date",
    page: 0,
    x: 68,
    y: 458,
    width: 95,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "current_date",
    group: "section2",
  },

  // --- Rep side (auto-filled from company profile) ---
  {
    id: "rep_name_p1",
    label: "Rep Name",
    type: "text",
    page: 0,
    x: 360,
    y: 82,
    width: 200,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "rep_name",
    group: "rep_signature",
  },
  {
    id: "rep_date_p1",
    label: "Rep Date",
    type: "date",
    page: 0,
    x: 360,
    y: 63,
    width: 200,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "rep_date",
    group: "rep_signature",
  },

  // --- Homeowner signer fields (page 1) ---
  {
    id: "ho_signature_p1",
    label: "Your Signature",
    type: "signature",
    page: 0,
    x: 75,
    y: 93,
    width: 210,
    height: 25,
    filledBy: "signer",
    required: true,
    group: "ho_signature",
  },
  {
    id: "ho_print_name_p1",
    label: "Your Printed Name",
    type: "text",
    page: 0,
    x: 85,
    y: 82,
    width: 190,
    height: 12,
    fontSize: 10,
    filledBy: "signer",
    required: true,
    group: "ho_signature",
  },
  {
    id: "ho_date_p1",
    label: "Date",
    type: "date",
    page: 0,
    x: 55,
    y: 63,
    width: 220,
    height: 12,
    fontSize: 10,
    filledBy: "signer",
    required: true,
    group: "ho_signature",
  },
  {
    id: "ho_initials_p1",
    label: "Your Initials (Sections 3-5)",
    type: "initials",
    page: 0,
    x: 125,
    y: 44,
    width: 80,
    height: 20,
    filledBy: "signer",
    required: true,
    group: "ho_signature",
  },

  // ==========================================
  // PAGE 2 — Scope of Work (Section 2)
  // ==========================================

  // --- Header fields ---
  {
    id: "job_number_p2",
    label: "Job #",
    type: "text",
    page: 1,
    x: 68,
    y: 619,
    width: 270,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "job_number",
    group: "header_p2",
  },
  {
    id: "date_p2",
    label: "Date",
    type: "date",
    page: 1,
    x: 390,
    y: 619,
    width: 175,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "current_date",
    group: "header_p2",
  },
  {
    id: "owner_name_p2",
    label: "Owner(s)",
    type: "text",
    page: 1,
    x: 100,
    y: 600,
    width: 210,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "homeowner_name",
    group: "header_p2",
  },
  {
    id: "property_p2",
    label: "Property",
    type: "text",
    page: 1,
    x: 405,
    y: 600,
    width: 160,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "address",
    group: "header_p2",
  },
  {
    id: "city_state_zip_p2",
    label: "City, State & Zip",
    type: "text",
    page: 1,
    x: 170,
    y: 581,
    width: 195,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "city_state_zip",
    group: "header_p2",
  },
  {
    id: "phone_p2",
    label: "Phone",
    type: "text",
    page: 1,
    x: 430,
    y: 581,
    width: 140,
    height: 12,
    fontSize: 9,
    filledBy: "sender",
    binding: "homeowner_phone",
    group: "header_p2",
  },

  // --- Trade checkboxes (sender fills) ---
  {
    id: "trade_roofing",
    label: "Roofing System",
    type: "checkbox",
    page: 1,
    x: 43,
    y: 520,
    width: 12,
    height: 12,
    filledBy: "sender",
    group: "trades",
  },
  {
    id: "trade_gutters",
    label: "Gutter / Roof Drainage System",
    type: "checkbox",
    page: 1,
    x: 43,
    y: 506,
    width: 12,
    height: 12,
    filledBy: "sender",
    group: "trades",
  },
  {
    id: "trade_siding",
    label: "Siding & Capping",
    type: "checkbox",
    page: 1,
    x: 43,
    y: 492,
    width: 12,
    height: 12,
    filledBy: "sender",
    group: "trades",
  },
  {
    id: "trade_windows",
    label: "Windows",
    type: "checkbox",
    page: 1,
    x: 43,
    y: 478,
    width: 12,
    height: 12,
    filledBy: "sender",
    group: "trades",
  },
  {
    id: "trade_other",
    label: "Other",
    type: "checkbox",
    page: 1,
    x: 43,
    y: 464,
    width: 12,
    height: 12,
    filledBy: "sender",
    group: "trades",
  },
  {
    id: "trade_other_text",
    label: "Other (describe)",
    type: "text",
    page: 1,
    x: 105,
    y: 464,
    width: 475,
    height: 12,
    fontSize: 9,
    filledBy: "sender",
    group: "trades",
  },

  // --- Cancellation initials (signer) ---
  {
    id: "ho_cancel_initials_1",
    label: "Owner #1 Initials",
    type: "initials",
    page: 1,
    x: 98,
    y: 268,
    width: 30,
    height: 14,
    filledBy: "signer",
    group: "cancel_initials",
  },
  {
    id: "ho_cancel_initials_2",
    label: "Owner #2 Initials",
    type: "initials",
    page: 1,
    x: 172,
    y: 268,
    width: 30,
    height: 14,
    filledBy: "signer",
    group: "cancel_initials",
  },

  // --- Rep side page 2 (auto) ---
  {
    id: "rep_name_p2",
    label: "Rep Name",
    type: "text",
    page: 1,
    x: 360,
    y: 152,
    width: 200,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "rep_name",
    group: "rep_signature_p2",
  },
  {
    id: "rep_date_p2",
    label: "Rep Date",
    type: "date",
    page: 1,
    x: 360,
    y: 133,
    width: 200,
    height: 12,
    fontSize: 9,
    filledBy: "auto",
    binding: "rep_date",
    group: "rep_signature_p2",
  },

  // --- Homeowner signer fields (page 2) ---
  {
    id: "ho_signature_p2",
    label: "Your Signature (Page 2)",
    type: "signature",
    page: 1,
    x: 82,
    y: 163,
    width: 200,
    height: 25,
    filledBy: "signer",
    required: true,
    group: "ho_signature_p2",
  },
  {
    id: "ho_print_name_p2",
    label: "Your Printed Name",
    type: "text",
    page: 1,
    x: 95,
    y: 152,
    width: 180,
    height: 12,
    fontSize: 10,
    filledBy: "signer",
    required: true,
    group: "ho_signature_p2",
  },
  {
    id: "ho_date_p2",
    label: "Date",
    type: "date",
    page: 1,
    x: 62,
    y: 133,
    width: 210,
    height: 12,
    fontSize: 10,
    filledBy: "signer",
    required: true,
    group: "ho_signature_p2",
  },
];

/** Trade checkbox IDs mapped to display labels for the sender UI */
export const TRADE_CHECKBOXES = [
  { id: "trade_roofing", label: "Roofing System" },
  { id: "trade_gutters", label: "Gutter / Roof Drainage System" },
  { id: "trade_siding", label: "Siding & Capping" },
  { id: "trade_windows", label: "Windows" },
  { id: "trade_other", label: "Other" },
] as const;

/** Default auto-fill values that don't come from claim data */
export const DEFAULT_BINDINGS: Record<string, string> = {
  section_ref: "2",
};
