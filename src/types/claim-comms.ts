/**
 * Communications types — shared between page.tsx and the CommunicationsCenter
 * component. Previously defined inline in page.tsx; extracted for Phase 3c-1
 * (Communications consolidator).
 */

export interface EditRequest {
  id: string;
  claim_id: string;
  from_email: string;
  original_subject: string;
  original_body: string;
  request_type: string;
  attachment_paths: string[];
  ai_summary: {
    changes: { action: string; item: string; details: string }[];
    request_type: string;
    confidence: number;
  } | null;
  status: string;
  applied_at: string | null;
  created_at: string;
}

export interface Correspondence {
  id: string;
  original_from: string;
  original_subject: string;
  original_date: string;
  text_body: string;
  carrier_name: string;
  carrier_position: {
    stance: string;
    key_arguments: string[];
    weaknesses: { weakness: string; evidence: string; suggested_question: string }[];
    tone: string;
    urgency: string;
    summary: string;
  } | null;
  suggested_action: string;
  analysis_status: string;
  status: string;
  created_at: string;
  attachment_paths?: string[];  // populated by per-user Gmail poller (abec24f)
}

export interface EmailDraft {
  id: string;
  correspondence_id: string;
  to_email: string;
  subject: string;
  body_html: string;
  body_text: string;
  selected_photos: { path: string; annotation_key: string; description: string; reasons: string[]; score: number }[];
  response_strategy: string;
  carrier_weaknesses: { weakness: string; evidence: string; suggested_question: string }[];
  compliance_role: string;
  edited_body_html: string | null;
  status: string;
  generation_cost: number;
  created_at: string;
}
