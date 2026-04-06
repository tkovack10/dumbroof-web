/**
 * Shared types for the twice-daily funnel monitor.
 * See src/app/api/cron/funnel-monitor/route.ts and the per-source modules.
 */

export type AnomalySeverity = "critical" | "warning" | "info";

export type Anomaly = {
  severity: AnomalySeverity;
  code: string;
  message: string;
  /** Optional pointer to the source that triggered it */
  source?: string;
};

export type SignupRow = {
  email: string;
  created_at: string;
  provider: string;
  signup_source: string | null;
  ip: string | null;
  user_agent: string | null;
};

export type ClaimRow = {
  slug: string;
  user_email: string;
  contractor_rcv: number;
  status: string;
  created_at: string;
};

export type SupabaseSection = {
  signups_count: number;
  uploads_count: number;
  active_users_24h: number;
  zero_claim_users: number;
  recent_signups: SignupRow[];
  recent_claims: ClaimRow[];
  cohort_week1_retention: number | null;
};

export type ResendSection = {
  total_sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  opened: number;
  clicked: number;
  delivery_rate: number;
  open_rate: number;
  click_rate: number;
};

export type StripeSection = {
  new_subscriptions: number;
  mrr_delta_cents: number;
  failed_payments: number;
  active_subscriptions: number;
  coupon_firstclaim50_uses: number;
};

export type VercelAnalyticsSection = {
  visitors: number;
  page_views: number;
  bounce_rate: number;
  top_referrers: Array<{ source: string; count: number }>;
  top_pages: Array<{ path: string; count: number }>;
  device_split: Record<string, number>;
};

export type GA4Section = {
  engagement_rate: number;
  avg_engagement_time_seconds: number;
  scroll_rate: number;
  conversions: number;
  top_geo: Array<{ city: string; users: number }>;
};

export type MetaAdsSection = {
  campaigns: Array<{
    name: string;
    status: string;
    spend_cents: number;
    impressions: number;
    clicks: number;
    conversions: number;
    cost_per_conversion_cents: number | null;
  }>;
  total_spend_24h_cents: number;
  total_conversions_24h: number;
};

export type RailwaySection = {
  status: "ok" | "degraded" | "down";
  cpu_percent?: number;
  ram_mb?: number;
  process_memory_mb?: number;
};

export type FunnelReport = {
  generated_at: string;
  window_start: string;
  window_end: string;
  duration_ms: number;

  // Per-source data (may be null if disabled or failed)
  supabase: SupabaseSection | null;
  resend: ResendSection | null;
  stripe: StripeSection | null;
  vercel_analytics: VercelAnalyticsSection | null;
  ga4: GA4Section | null;
  meta_ads: MetaAdsSection | null;
  railway: RailwaySection | null;

  // Cross-cutting
  anomalies: Anomaly[];
  ai_insight: string | null;

  sources_succeeded: string[];
  sources_failed: string[];
};
