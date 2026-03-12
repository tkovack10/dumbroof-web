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
}
