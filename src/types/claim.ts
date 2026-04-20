import type { RoofSectionsData } from "./roof-sections";
import type { RoofFacetsPayload, SlopeDamageRow } from "./roof-facets";

export interface Claim {
  id: string;
  user_id: string;
  address: string;
  carrier: string;
  phase: string;
  status: string;
  file_path: string;
  slug?: string;
  output_files: string[] | null;
  error_message: string | null;
  created_at: string;
  homeowner_name?: string | null;
  date_of_loss?: string | null;
  inspection_date?: string | null;
  user_notes?: string | null;
  // File arrays
  measurement_files?: string[] | null;
  photo_files?: string[] | null;
  scope_files?: string[] | null;
  weather_files?: string[] | null;
  other_files?: string[] | null;
  coc_files?: string[] | null;
  aob_files?: string[] | null;
  // Financial (populated by backend processor)
  contractor_rcv?: number | null;
  original_carrier_rcv?: number | null;
  current_carrier_rcv?: number | null;
  settlement_amount?: number | null;
  claim_outcome?: string | null; // pending | won | lost
  claim_number?: string | null;
  adjuster_name?: string | null;
  adjuster_email?: string | null;
  adjuster_phone?: string | null;
  // Homeowner contact (promoted from claim_config to top-level for fast composer pre-fill)
  homeowner_email?: string | null;
  homeowner_phone?: string | null;
  policy_number?: string | null;
  // Per-field source tracking ("manual" | "scope_2026-04-15" | "email_extract")
  contact_source?: Record<string, string | undefined> | null;
  // Team / company scoping (from 20260419_platform_expansion migration)
  company_id?: string | null;
  assigned_user_id?: string | null;
  last_touched_at?: string | null;
  homeowner_comms_count?: number | null;
  marketing_eligible?: boolean | null;
  // Communication
  correspondence_count?: number;
  pending_drafts?: number;
  pending_edits?: number;
  latest_carrier_position?: string;
  // Analysis
  photo_integrity?: { total: number; flagged: number; score: string } | null;
  processing_warnings?: string[] | null;
  // Damage Scoring
  damage_score?: number | null;
  damage_grade?: string | null;
  approval_score?: number | null;
  approval_grade?: string | null;
  improvement_guidance?: {
    summary: string;
    tips: { category: string; icon: string; title: string; detail: string }[];
  } | null;
  // Geo
  latitude?: number | null;
  longitude?: number | null;
  // Roof sections (slope editor)
  roof_sections?: RoofSectionsData | null;
  // Per-slope photo mapping (populated when an EagleView PDF has been processed)
  roof_facets?: RoofFacetsPayload | null;
  slope_damage?: SlopeDamageRow[] | null;
  full_reroof_trigger?: boolean | null;
  // DS/TAS component subscores (for calibration + detailed breakdowns)
  ds_roof_surface?: number | null;
  ds_evidence_cascade?: number | null;
  ds_soft_metal?: number | null;
  ds_documentation?: number | null;
  ds_per_slope?: number | null;
  tas_damage?: number | null;
  tas_product?: number | null;
  tas_code?: number | null;
  tas_carrier?: number | null;
  tas_scope?: number | null;
  score_version?: string | null;
  // Processing timestamp (for pending changes tracking)
  last_processed_at?: string | null;
  // Photo corrections
  excluded_photos?: string[] | null;
  // Scope comparison (JSONB from processor)
  scope_comparison?: unknown[] | null;
  o_and_p_enabled?: boolean | null;
  tax_rate?: number | null;
  trade_count?: number | null;
  // Line item corrections
  excluded_line_items?: string[] | null;
  // Report mode (full = 5-doc package, forensic_only = quick forensic report)
  report_mode?: string | null;
  // Estimate configuration (roof material, gutters, siding selections)
  estimate_request?: Record<string, string> | null;
  // Weather / storm data (NOAA events, hail swaths)
  weather_data?: {
    events?: Array<{
      event_type: string;
      date: string;
      hail_size?: number;
      wind_speed?: number;
      latitude: number;
      longitude: number;
      location: string;
      distance_miles?: number;
      source?: string;
    }>;
    max_hail_inches?: number;
    max_wind_mph?: number;
    event_count?: number;
  } | null;
  // Lifecycle (install → complete → invoice → paid)
  lifecycle_phase?: string | null;
  install_supplement_total?: number | null;
  completion_date?: string | null;
  // Admin enrichment
  user_email?: string;
  // QA auditor flags — written inline by backend/qa_auditor.py after each claim processes.
  // When critical[] is non-empty, status is set to 'qa_review_pending' and the customer
  // completion email is suppressed until an admin reviews via /admin/qa-review.
  qa_audit_flags?: QAAuditResult | null;
  carrier_analyst_flags?: Record<string, unknown> | null;
}

export interface QAAuditIssue {
  issue: string;
  location?: string;
  found?: string;
  expected?: string;
  quote?: string;
}

export interface QAAuditResult {
  passed: boolean;
  critical: QAAuditIssue[];
  medium: QAAuditIssue[];
  low: QAAuditIssue[];
  recommendation: "ship" | "hold" | "reprocess";
  summary: string;
  ground_truth?: Record<string, unknown>;
  audited_at?: string;
  audit_error?: string;
}
