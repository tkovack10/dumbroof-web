"use client";

import { track } from "@vercel/analytics";

type EventProperties = Record<string, string | number | boolean | null>;

// gtag is the only global we add — fbq/ttq are already declared in
// src/types/global.d.ts and we don't want to clash with those.
declare global {
  interface Window {
    gtag?: (command: "event", eventName: string, params?: Record<string, unknown>) => void;
  }
}

/**
 * Fire a funnel event to BOTH Vercel Analytics AND GA4 simultaneously.
 *
 * Vercel Analytics → developer-facing dashboard, custom events for funnel
 * GA4 → marketing-facing, conversions feed back to Meta/Google Ads via CAPI
 *
 * Use this everywhere instead of `track()` directly.
 *
 * Anchor: see USARM-Claims-Platform funnel investigation 2026-04-06.
 * GA4 currently has 0 conversion events configured — adding these is critical
 * for Meta ads to optimize for the right action instead of Landing Page Views.
 */
export function trackBoth(event: string, properties?: EventProperties): void {
  // Vercel Analytics
  try {
    track(event, properties);
  } catch {
    // Vercel SDK not yet loaded — non-fatal
  }

  // GA4 dataLayer (gtag is wired in src/app/layout.tsx)
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    try {
      window.gtag("event", event, properties || {});
    } catch {
      // Non-fatal
    }
  }
}

/**
 * Funnel event names — keep in sync with the GA4 dashboard key event config.
 * Strings are the canonical source of truth.
 */
export const FunnelEvent = {
  HOMEPAGE_VIEW: "homepage_view",
  HERO_CTA_CLICKED: "hero_cta_clicked",
  SIGNUP_EMAIL_STEP_COMPLETED: "signup_email_step_completed",
  SIGNUP_PASSWORD_STEP_STARTED: "signup_password_step_started",
  SIGNUP_PASSWORD_SUBMITTED: "signup_password_submitted",
  SIGNUP_SUCCEEDED: "signup_succeeded",
  SIGNUP_FAILED: "signup_failed",
  OAUTH_STARTED: "oauth_started",
  MAGIC_LINK_REQUESTED: "magic_link_requested",
  PRICING_PAGE_VIEWED: "pricing_page_viewed",
  DASHBOARD_FIRST_VISIT: "dashboard_first_visit",
  NEW_CLAIM_FORM_STARTED: "new_claim_form_started",
  NEW_CLAIM_FORM_SUBMITTED: "new_claim_form_submitted",
  NEW_CLAIM_UPLOAD_FAILED: "new_claim_upload_failed",
  SCROLL_DEPTH: "scroll_depth",
  SAMPLE_PAGE_VIEWED: "sample_page_viewed",
} as const;

export type FunnelEventName = (typeof FunnelEvent)[keyof typeof FunnelEvent];
