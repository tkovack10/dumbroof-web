import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Same-origin token vendor for browser → Railway-backend calls.
 *
 * The backend (`backend/main.py`) verifies a Supabase JWT and 401s any request
 * without one. The browser Supabase client's `getSession()` intermittently
 * returns no token on long-lived dashboard tabs, so direct browser→backend
 * fetches were going out with NO `Authorization` header → backend 401 →
 * "Your DumbRoof session expired. Please log in again" — which re-login never
 * fixed, because the session was actually fine (see getRichardAuthHeaders).
 *
 * The SERVER-side session path is reliable: middleware (`updateSession`)
 * refreshes the auth cookies on every `/dashboard/*` navigation, and
 * `createClient()` (createServerClient) reads them. This route hands the
 * browser that server-validated token so it can attach it to the cross-origin
 * backend call. Cookies ride along automatically on a same-origin fetch.
 *
 * Returns { access_token } on success, 401 otherwise. Never cached.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();

    // getUser() validates against Supabase /auth/v1/user and, if the access
    // token is stale, refreshes it (the server client persists the rotated
    // token via setAll — allowed in a Route Handler). This guarantees the
    // token we then read is live.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "not_authenticated" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? null;
    if (!token) {
      return NextResponse.json(
        { error: "no_session" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { access_token: token },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "token_unavailable" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
}
