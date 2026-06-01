import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Same-origin proxy for the Railway CRM-integration endpoints
 * (CompanyCam + AccuLynx). It attaches the caller's Supabase JWT
 * SERVER-SIDE and forwards to the backend.
 *
 * WHY THIS EXISTS: the browser used to call the Railway backend directly and
 * attach the token via `getRichardAuthHeaders()` → the browser Supabase
 * client's `getSession()` intermittently returned NO token on long-lived
 * dashboard tabs (esp. mobile Safari), so the cross-origin call went out with
 * no `Authorization` header → backend 401 → "session expired, log in again",
 * which re-login never fixed (the session was actually valid). PR #113/#125
 * tried to harden the client path; this removes it entirely.
 *
 * The SERVER reads the session reliably (middleware refreshes the auth cookies
 * on every dashboard nav; `/api/auth/token` confirmed returning 200 in prod),
 * so we resolve the token here and forward it. The browser just rides its
 * same-origin cookies — no client token handling, no cross-origin CORS.
 *
 * Identity is the JWT. We never forward a client-supplied `user_id` (the
 * backend 403s on a mismatch, and trusting the param would reopen the
 * cross-tenant IDOR that RICHARD_ENFORCE_AUTH closes).
 */

const BACKEND = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://dumbroof-backend-production.up.railway.app"
).replace(/\/$/, "");

/** Auth-gate 401 with the exact body the client's handle401 expects. */
function unauthenticated(): NextResponse {
  return NextResponse.json({ detail: "Authentication required" }, { status: 401 });
}

/**
 * Resolve the caller's live access token server-side: getUser() validates and,
 * if stale, refreshes; getSession() then yields the live token. Same reliable
 * path `/api/auth/token` uses. Returns null when there's no live session.
 */
async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** Stream the upstream body + status straight back to the browser. */
async function passthrough(upstream: Response): Promise<NextResponse> {
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** Proxy a GET, forwarding query params (minus user_id) + the Bearer token. */
export async function proxyIntegrationGET(
  req: NextRequest,
  backendPath: string
): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return unauthenticated();

  const params = new URLSearchParams(req.nextUrl.search);
  params.delete("user_id");
  const qs = params.toString();
  const target = `${BACKEND}${backendPath}${qs ? `?${qs}` : ""}`;

  try {
    const upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return passthrough(upstream);
  } catch (err) {
    return NextResponse.json(
      { error: "companycam_unavailable", message: `Upstream unreachable: ${String(err)}` },
      { status: 502 }
    );
  }
}

/** Proxy a POST, forwarding the JSON body (minus user_id) + the Bearer token. */
export async function proxyIntegrationPOST(
  req: NextRequest,
  backendPath: string
): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return unauthenticated();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  // Identity is the JWT — never forward a client-supplied user_id.
  delete body.user_id;

  try {
    const upstream = await fetch(`${BACKEND}${backendPath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return passthrough(upstream);
  } catch (err) {
    return NextResponse.json(
      { error: "companycam_unavailable", message: `Upstream unreachable: ${String(err)}` },
      { status: 502 }
    );
  }
}
