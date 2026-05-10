import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface ProfilePayload {
  company_name: string;
  contact_name: string;
  contact_title?: string | null;
  phone: string;
  website?: string | null;
  logo_path?: string | null;
}

// POST /api/onboarding/profile
// Required-profile gate handler. Writes (or upserts) the user's
// company_profiles row. Auth-gated; uses the user's session to identify them.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: ProfilePayload;
  try {
    body = (await request.json()) as ProfilePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Server-side validation — never trust the client.
  const company_name = (body.company_name || "").trim();
  const contact_name = (body.contact_name || "").trim();
  const contact_title = (body.contact_title || "Owner").trim() || "Owner";
  const phone = (body.phone || "").trim();
  const website = body.website?.trim() || null;
  const logo_path = body.logo_path?.trim() || null;

  if (company_name.length < 2) {
    return NextResponse.json({ error: "Company name is required" }, { status: 400 });
  }
  if (contact_name.length < 2) {
    return NextResponse.json({ error: "Your name is required" }, { status: 400 });
  }
  if (phone.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  // Upsert — there may already be a row from invite/referral flow with
  // company_id + role set. Don't clobber those linkage fields.
  const { data: existing } = await supabaseAdmin
    .from("company_profiles")
    .select("id, company_id, role")
    .eq("user_id", user.id)
    .limit(1);

  const baseFields = {
    company_name,
    contact_name,
    contact_title,
    phone,
    website,
    email: user.email,
    user_role: "contractor" as const,
    ...(logo_path ? { logo_path } : {}),
  };

  if (existing && existing.length > 0) {
    const { error: updErr } = await supabaseAdmin
      .from("company_profiles")
      .update(baseFields)
      .eq("user_id", user.id);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  } else {
    const { error: insErr } = await supabaseAdmin.from("company_profiles").insert({
      user_id: user.id,
      ...baseFields,
    });
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
