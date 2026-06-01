"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Build the Authorization header for backend Richard / integration endpoints.
 *
 * The backend (`backend/main.py`) reads `Authorization: Bearer <jwt>`, verifies
 * it against Supabase `/auth/v1/user`, and 401s any request without a valid one
 * (auth enforcement is permanent — it closes the cross-tenant IDOR). So every
 * direct browser→backend call MUST carry the token.
 *
 * PRIMARY source = our own same-origin `/api/auth/token` route. The browser
 * Supabase client's `getSession()` intermittently returns NO token on
 * long-lived dashboard tabs, so these cross-origin fetches were going out with
 * no `Authorization` header → backend 401 → "session expired, log in again" —
 * which re-login never fixed, because the session was actually valid. The
 * SERVER side reads the session reliably (middleware refreshes the auth cookies
 * on every dashboard nav), so we ask the server for the token and attach it.
 * Cookies are sent automatically on the same-origin fetch.
 *
 * FALLBACK = the original client-side path, for any edge case where the
 * same-origin route is unreachable.
 */
export async function getRichardAuthHeaders(): Promise<Record<string, string>> {
  // Primary: server-validated token via same-origin route (reliable path).
  try {
    const res = await fetch("/api/auth/token", { cache: "no-store" });
    if (res.ok) {
      const { access_token } = await res.json();
      if (access_token) return { Authorization: `Bearer ${access_token}` };
    }
  } catch {
    // Network/route error — fall through to the client-side path below.
  }

  // Fallback: client Supabase session (the legacy path).
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token;

    // Proactively refresh a missing or near-expired access token. On mobile
    // browsers the background auto-refresh timer is unreliable (tab
    // suspension), so the stored access token can outlive its ~1h TTL while
    // the refresh token is still valid.
    const expiresAt = data.session?.expires_at; // unix seconds
    const nowSec = Math.floor(Date.now() / 1000);
    const expiringSoon = typeof expiresAt === "number" && expiresAt - nowSec < 120;
    if (!token || expiringSoon) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      token = refreshed.session?.access_token ?? token;
    }

    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * After getRichardAuthHeaders() already tries a token refresh, a backend 401
 * means the refresh token itself is dead — the only recovery is a fresh login.
 * UIs use this to swap the cryptic raw "Authentication required" string for a
 * clear "session expired, log in again" prompt.
 */
export const SESSION_EXPIRED_MESSAGE =
  "Your DumbRoof session expired. Please log in again, then retry.";

/** Send the user to the login page to re-authenticate. */
export function goToLogin(): void {
  if (typeof window === "undefined") return;
  window.location.href = "/login";
}
