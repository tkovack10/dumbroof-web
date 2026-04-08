/**
 * Shared types for the twice-daily document quality review cron.
 *
 * The cron route at src/app/api/cron/document-quality/route.ts queries
 * Supabase for every claim that hit `status='ready'` in the last cron
 * window, runs the QA checks defined in qa-checks.ts, grades each claim
 * A/B/C/F, renders an HTML email, and persists the run to the
 * `document_quality_runs` Supabase table.
 *
 * Sibling architecture to src/lib/funnel-monitor/. Same patterns:
 * fire-and-forget, anomaly bag, render-html.ts for the email template.
 */

export type Severity = "critical" | "warning" | "info";

export type Grade = "A" | "B" | "C" | "F";

export type CheckResult = {
  name: string;
  passed: boolean;
  severity: Severity;
  message: string;
};

export type ClaimQuality = {
  claim_id: string;
  slug: string;
  address: string;
  carrier: string;
  contractor_rcv: number;
  phase: string;
  status: string;
  last_processed_at: string;
  grade: Grade;
  passed_count: number;
  warned_count: number;
  failed_count: number;
  /** Top issue by severity — used for the email summary table */
  top_issue: string | null;
  /** Full list of all checks for the deep-dive section */
  checks: CheckResult[];
};

export type DocumentQualityReport = {
  generated_at: string;
  window_start: string;
  window_end: string;
  duration_ms: number;
  claims_reviewed: number;
  grades: { A: number; B: number; C: number; F: number };
  /** Per-claim breakdown sorted worst-first (F → C → B → A) */
  claim_grades: ClaimQuality[];
  /** Cross-cutting issues — e.g. "3 claims failed PDF generation" */
  critical_issues: string[];
};
