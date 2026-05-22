import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/admin/import/runs?status=applied|preview|rolled_back|all
 * Lists import runs for this admin's company. Default: all non-preview.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_admin || !profile.company_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profile.company_id;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") || "non_preview";

  let q = supabaseAdmin
    .from("import_runs")
    .select(
      "id, kind, source, source_filename, row_count, matched_count, " +
      "dedup_count, unmatched_count, error_count, status, applied_at, " +
      "rolled_back_at, created_at, created_by"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (statusFilter === "non_preview") {
    q = q.neq("status", "preview");
  } else if (statusFilter !== "all") {
    q = q.eq("status", statusFilter);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: data || [] });
}
