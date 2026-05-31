/**
 * Public unsubscribe endpoint. No auth — identity comes from the signed token
 * (or an email entered on the page). Sets company_profiles.settings
 * .nurture_opted_out = true, which the nurture / repeat-usage / storm-alert
 * crons all honor.
 *
 * POST handles three callers:
 *  1. Gmail/Yahoo one-click (RFC 8058): token in ?token=, body
 *     `List-Unsubscribe=One-Click` (form-urlencoded).
 *  2. Page confirm button: JSON { token }.
 *  3. Page email-entry form: JSON { email }.
 *
 * GET redirects to the page (so a link-scanner that GETs the header URL can't
 * trigger an opt-out — only an explicit POST does).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyUnsubToken } from "@/lib/unsubscribe";

export const runtime = "nodejs";

interface ProfileSettings {
  [key: string]: unknown;
  nurture_opted_out?: boolean;
}

async function optOutByUserId(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("company_profiles")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[unsubscribe] uid lookup failed:", error.message);
    return false;
  }
  const prev = ((data?.settings as ProfileSettings | null) || {}) as ProfileSettings;
  if (prev.nurture_opted_out === true) return true; // idempotent
  const { error: upErr } = await supabaseAdmin
    .from("company_profiles")
    .update({ settings: { ...prev, nurture_opted_out: true } })
    .eq("user_id", userId);
  if (upErr) {
    console.error("[unsubscribe] uid update failed:", upErr.message);
    return false;
  }
  return true;
}

/** Opt out every profile matching this email (case-insensitive). */
async function optOutByEmail(email: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id, settings")
    .ilike("email", email);
  if (error) {
    console.error("[unsubscribe] email lookup failed:", error.message);
    return;
  }
  const rows = (data || []) as Array<{ user_id: string; settings: ProfileSettings | null }>;
  for (const r of rows) {
    const prev = (r.settings || {}) as ProfileSettings;
    if (prev.nurture_opted_out === true) continue;
    const { error: upErr } = await supabaseAdmin
      .from("company_profiles")
      .update({ settings: { ...prev, nurture_opted_out: true } })
      .eq("user_id", r.user_id);
    if (upErr) console.error(`[unsubscribe] email update failed for ${r.user_id}:`, upErr.message);
  }
}

export async function POST(req: NextRequest) {
  const qpToken = req.nextUrl.searchParams.get("token");

  let bodyToken: string | null = null;
  let bodyEmail: string | null = null;
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const j = (await req.json()) as { token?: unknown; email?: unknown };
      if (typeof j.token === "string") bodyToken = j.token;
      if (typeof j.email === "string") bodyEmail = j.email;
    } else {
      const form = await req.formData();
      const t = form.get("token");
      const e = form.get("email");
      if (typeof t === "string") bodyToken = t;
      if (typeof e === "string") bodyEmail = e;
    }
  } catch {
    /* empty/!parseable body — fall through to query token */
  }

  const token = qpToken || bodyToken;

  if (token) {
    const payload = verifyUnsubToken(token);
    if (!payload) {
      return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 400 });
    }
    await optOutByUserId(payload.uid);
    return NextResponse.json({ ok: true });
  }

  if (bodyEmail && bodyEmail.includes("@")) {
    // Generic success regardless of match — never leak whether an address exists.
    await optOutByEmail(bodyEmail.trim());
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "missing_token_or_email" }, { status: 400 });
}

/** A GET (link prefetch / scanner) must never opt out — send them to the page. */
export function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const dest = new URL("/unsubscribe", req.nextUrl.origin);
  if (token) dest.searchParams.set("token", token);
  return NextResponse.redirect(dest);
}
