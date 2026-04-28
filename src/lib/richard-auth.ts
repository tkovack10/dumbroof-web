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
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
