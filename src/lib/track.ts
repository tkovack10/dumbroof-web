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
 * GA4 ecommerce-standard event names. GA4 auto-recognizes these (no manual
 * Key Event toggle required) and they populate the Generate Leads / Drive
 * Sales / Purchase Journey reports out of the box. Our internal custom
 * events (e.g. signup_succeeded) describe internal funnel steps; the mapped
 * GA4-standard name is fired alongside so Google's prebuilt reports light up.
 *
 * GA4's recommended event reference:
 * https://support.google.com/analytics/answer/9267735
 */
const GA4_STANDARD_MIRROR: Record<string, { name: string; params?: Record<string, unknown> }> = {
  signup_succeeded: { name: "sign_up", params: { method: "email" } },
  oauth_started: { name: "login", params: { method: "google" } },
  hero_cta_clicked: { name: "select_promotion" },
  pricing_page_viewed: { name: "view_item_list", params: { item_list_name: "pricing_tiers" } },
  new_claim_form_started: { name: "begin_checkout" },
  new_claim_form_submitted: { name: "purchase", params: { transaction_id: "claim_created" } },
};

/**
 * Stable anonymous session id (localStorage) so a visitor's funnel events stitch
 * into ONE journey across pages and — crucially — across the signup boundary
 * (homepage → signup → first claim). Falls back gracefully if storage is blocked.
 */
function funnelSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let s = window.localStorage.getItem("dr_sid");
    if (!s) {
      s =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      window.localStorage.setItem("dr_sid", s);
    }
    return s;
  } catch {
    return "";
  }
}

/**
 * Fire a funnel event to BOTH Vercel Analytics AND GA4 simultaneously.
 *
 * Vercel Analytics → developer-facing dashboard, custom events for funnel
 * GA4 → marketing-facing, conversions feed back to Meta/Google Ads via CAPI
 *
 * In addition to firing the named custom event, we also mirror it to a GA4
 * ecommerce-standard name when applicable (sign_up, login, purchase, etc.)
 * so GA4's prebuilt reports (Generate Leads, Purchase Journey) populate
 * automatically without needing a UI Key Event toggle on every property.
 *
 * Use this everywhere instead of `track()` directly.
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
      const mirror = GA4_STANDARD_MIRROR[event];
      if (mirror) {
        window.gtag("event", mirror.name, { ...(mirror.params || {}), ...(properties || {}) });
      }
    } catch {
      // Non-fatal
    }
  }

  // Persist to our OWN database (/api/track → funnel_events) so the funnel is
  // answerable in SQL, not only in the GA4 / Vercel consoles. Fire-and-forget;
  // sendBeacon survives page navigation/unload. Never blocks or throws.
  if (typeof window !== "undefined") {
    try {
      const payload = JSON.stringify({
        event,
        properties: properties || null,
        session_id: funnelSessionId(),
        path: window.location?.pathname || null,
      });
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      } else {
        void fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Non-fatal — analytics must never break the app
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
