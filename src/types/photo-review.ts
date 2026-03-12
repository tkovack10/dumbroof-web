export type FeedbackStatus = "approved" | "corrected" | "rejected";

export interface PhotoForReview {
  id: string; // photos table row id
  claim_id: string;
  address: string;
  annotation_key: string;
  annotation_text: string;
  damage_type: string | null;
  material: string | null;
  trade: string | null;
  elevation: string | null;
  severity: string | null;
  signed_url: string;
  feedback_status: FeedbackStatus | null;
}

export interface PhotoFeedback {
  photo_id: string;
  claim_id?: string;
  status: FeedbackStatus;
  corrected_annotation?: string;
  corrected_tags?: {
    damage_type?: string;
    material?: string;
    trade?: string;
    elevation?: string;
    severity?: string;
  };
  notes?: string;
}

export interface PhotoReviewResponse {
  photos: PhotoForReview[];
  total: number;
  reviewed: number;
}
