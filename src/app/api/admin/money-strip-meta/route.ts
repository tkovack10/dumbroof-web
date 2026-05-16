import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/admin/money-strip-meta
 * Returns the admin's company_id for use as a Realtime channel filter.
 * Separate from /money-strip so we can keep the heavy aggregate query off
 * the Realtime subscribe path.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);

  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  return NextResponse.json({
    companyId: profileRows[0].company_id || null,
  });
}
