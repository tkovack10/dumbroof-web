"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Build the Authorization header for backend Richard endpoints.
 *
 * The backend (`backend/main.py`) reads `Authorization: Bearer <jwt>` and
 * derives `user_id` from the verified Supabase auth token. When the env
 * flag `RICHARD_ENFORCE_AUTH=true` is set, missing/invalid tokens are 401d.
 * Soft-fail mode falls back to body.user_id for backwards compat during
 * the rollout — but always send the token when one is available so we
 * can flip the flag without breaking anyone.
 */
export async function getRichardAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token;

    // Proactively refresh a missing or near-expired access token BEFORE we
    // send it to the backend. The backend verifies every token against
    // Supabase /auth/v1/user, so a stale token → 401 "Authentication required"
    // even though the user is still "logged in" locally. On mobile browsers
    // the background auto-refresh timer is unreliable (tab suspension), so the
    // stored access token routinely outlives its ~1h TTL while the refresh
    // token is still perfectly valid. Without this, reps on a days-old session
    // get 401d on CompanyCam import AND Richard chat (one root cause, two
    // symptoms) — see project_usarm_reps_auth_block_2026_05_31.
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
