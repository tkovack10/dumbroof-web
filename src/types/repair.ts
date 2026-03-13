export interface Repair {
  id: string;
  address: string;
  homeowner_name: string;
  status: string;
  file_path: string;
  output_files: string[] | null;
  created_at: string;
  leak_description: string | null;
  roofer_name: string | null;
  skill_level: string | null;
  preferred_language: string | null;
  repair_type: string | null;
  severity: string | null;
  total_price: number | null;
  error_message: string | null;
  homeowner_phone?: string | null;
  homeowner_email?: string | null;
  email_sent_at?: string | null;
  // Checkpoint fields
  current_checkpoint_id?: string | null;
  checkpoint_count?: number | null;
  original_diagnosis_code?: string | null;
  pivot_count?: number | null;
}

export interface RepairCheckpoint {
  id: string;
  repair_id: string;
  checkpoint_number: number;
  checkpoint_type: string;
  status: string;
  // AI instructions
  instructions_en: string;
  instructions_es: string | null;
  what_to_photograph: string | null;
  expected_finding: string | null;
  // Roofer response
  photo_files: string[];
  roofer_notes: string | null;
  // AI analysis
  diagnosis_snapshot: Record<string, unknown> | null;
  ai_analysis: string | null;
  ai_analysis_es: string | null;
  ai_confidence: number | null;
  ai_decision: string | null;
  pivot_reason: string | null;
  updated_diagnosis: Record<string, unknown> | null;
  updated_repair_plan: Record<string, unknown> | null;
  message_to_roofer_en: string | null;
  message_to_roofer_es: string | null;
  // Timestamps
  created_at: string;
  responded_at: string | null;
  analyzed_at: string | null;
}
