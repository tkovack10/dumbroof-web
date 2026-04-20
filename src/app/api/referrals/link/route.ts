import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/**
 * Link an authenticated user as the "referred_user_id" on a referrals row,
 * matched by referral_code. Called right after signup (by signup-client.tsx)
 * and by the auth callback on Google OAuth round-trip (via the dr_ref cookie).
 *
 * Idempotent: if the user already has a matching referral row, status is
 * advanced to 'signed_up' but nothing is duplicated.
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = (body.code || "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Referral code required" }, { status: 400 });
  }

  // Resolve referrer user from the code
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id, referral_code, email")
    .eq("referral_code", code)
    .limit(1);
  const referrerProfile = profileRows?.[0];
  if (!referrerProfile) {
    return NextResponse.json({ error: "Invalid referral code" }, { status: 404 });
  }
  if (referrerProfile.user_id === user.id) {
    return NextResponse.json({ error: "Can't refer yourself" }, { status: 400 });
  }
  // Block self-referral via email aliases (same provider-normalized local part).
  // Gmail treats "foo+bar" and "f.o.o" as the same mailbox as "foo" — Supabase
  // doesn't, so a fraudster can sign up me+1@gmail after referring me@gmail.
  const normalize = (email: string): string => {
    const [local = "", domain = ""] = email.toLowerCase().trim().split("@");
    if (domain === "gmail.com" || domain === "googlemail.com") {
      return local.split("+")[0].replace(/\./g, "") + "@gmail.com";
    }
    return email.toLowerCase().trim();
  };
  const referrerEmail = (referrerProfile.email as string | null) || "";
  const currentEmail = user.email || "";
  if (referrerEmail && currentEmail && normalize(referrerEmail) === normalize(currentEmail)) {
    return NextResponse.json({ error: "Can't refer yourself (alias detected)" }, { status: 400 });
  }

  // Find existing referral row for this referrer + either by matching email
  // OR any that hasn't been linked yet (pending/signed_up). Update to signed_up.
  const { data: existing } = await supabaseAdmin
    .from("referrals")
    .select("id, status, referred_email, referred_user_id")
    .eq("referrer_user_id", referrerProfile.user_id)
    .or(`referred_user_id.eq.${user.id},referred_email.eq.${(user.email || "").toLowerCase()}`)
    .order("created_at", { ascending: false })
    .limit(1);

  const row = existing?.[0];
  const nowIso = new Date().toISOString();

  if (row) {
    await supabaseAdmin
      .from("referrals")
      .update({
        referred_user_id: user.id,
        status: row.status === "pending" ? "signed_up" : row.status,
        signed_up_at: row.status === "pending" ? nowIso : undefined,
      })
      .eq("id", row.id);
    return NextResponse.json({ ok: true, referral_id: row.id, linked: true });
  }

  // No pre-existing row (the referred user signed up cold via /r/{code}
  // without the referrer having pre-sent them an email). Create one.
  const { data: inserted } = await supabaseAdmin
    .from("referrals")
    .insert({
      referrer_user_id: referrerProfile.user_id,
      referral_code: code,
      referred_email: (user.email || "").toLowerCase(),
      referred_user_id: user.id,
      status: "signed_up",
      signed_up_at: nowIso,
    })
    .select("id")
    .single();

  return NextResponse.json({ ok: true, referral_id: inserted?.id, linked: true });
}
