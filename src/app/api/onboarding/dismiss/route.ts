import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/onboarding/dismiss — User clicked × on the onboarding checklist
 * widget. Sets `onboarding_dismissed_at = now()` on their company_profiles row.
 * Auth required.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabaseAdmin
    .from("company_profiles")
    .update({ onboarding_dismissed_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) {
    console.error("[onboarding/dismiss] update failed", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
