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
  settlement_amount?: number | null;
  claim_outcome?: string | null; // pending | won | lost
  // Communication
  correspondence_count?: number;
  pending_drafts?: number;
  pending_edits?: number;
  latest_carrier_position?: string;
  // Analysis
  photo_integrity?: { total: number; flagged: number; score: string } | null;
  processing_warnings?: string[] | null;
  // Admin enrichment
  user_email?: string;
}
