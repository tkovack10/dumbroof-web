import type { RoofSectionsData } from "./roof-sections";

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
  user_notes?: string | null;
  // File arrays
  measurement_files?: string[] | null;
  photo_files?: string[] | null;
  scope_files?: string[] | null;
  weather_files?: string[] | null;
  other_files?: string[] | null;
  // Financial (populated by backend processor)
  contractor_rcv?: number | null;
  original_carrier_rcv?: number | null;
  current_carrier_rcv?: number | null;
  settlement_amount?: number | null;
  claim_outcome?: string | null; // pending | won | lost
  claim_number?: string | null;
  adjuster_name?: string | null;
  adjuster_email?: string | null;
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
  // Lifecycle (install → complete → invoice → paid)
  lifecycle_phase?: string | null;
  install_supplement_total?: number | null;
  completion_date?: string | null;
  // Admin enrichment
  user_email?: string;
}
