import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// GET /api/admin/leads — inbound prospect leads captured by the lead poller
// (and any other path that writes nurture_replies). Admin only. Read-only.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: me } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .single();
  if (!me?.is_admin) return NextResponse.json({ error: "admin only" }, { status: 403 });

  const { data, error } = await supabaseAdmin
    .from("nurture_replies")
    .select("id,from_email,subject,body_excerpt,matched_touch,opted_out,user_id,raw_payload,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ leads: data || [], generatedAt: new Date().toISOString() });
}
