import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/admin/import/rollback/[run_id]
 * Deletes every check_uploads / production_schedules / import_unmatched_rows
 * row tagged with this import_run_id, and flips the run to 'rolled_back'.
 *
 * No-op if the run was never 'applied' (preview-only or already rolled back).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ run_id: string }> }
) {
  const { run_id: runId } = await params;
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

  const { data: run } = await supabaseAdmin
    .from("import_runs")
    .select("id, company_id, status, kind")
    .eq("id", runId)
    .maybeSingle();
  if (!run || run.company_id !== companyId) {
    return NextResponse.json({ error: "Import run not found" }, { status: 404 });
  }
  if (run.status !== "applied") {
    return NextResponse.json(
      { error: `Cannot roll back a ${run.status} run` },
      { status: 409 }
    );
  }

  // Delete tagged rows from check_uploads + production_schedules.
  // import_unmatched_rows are cascade-deleted via the FK.
  const { count: checksDeleted } = await supabaseAdmin
    .from("check_uploads")
    .delete({ count: "exact" })
    .eq("import_run_id", runId)
    .eq("company_id", companyId);

  const { count: schedDeleted } = await supabaseAdmin
    .from("production_schedules")
    .delete({ count: "exact" })
    .eq("import_run_id", runId)
    .eq("company_id", companyId);

  await supabaseAdmin
    .from("import_runs")
    .update({
      status: "rolled_back",
      rolled_back_at: new Date().toISOString(),
    })
    .eq("id", runId);

  return NextResponse.json({
    ok: true,
    deleted: {
      check_uploads: checksDeleted || 0,
      production_schedules: schedDeleted || 0,
    },
  });
}
