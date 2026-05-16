import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/admin/retail?status=
 * Returns retail jobs for the caller's company. Optional status filter.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("company_id")
    .eq("user_id", user.id)
    .limit(1);
  const companyId = profileRows?.[0]?.company_id;
  if (!companyId) return NextResponse.json({ jobs: [] });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  let q = supabaseAdmin
    .from("retail_jobs")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && status !== "all") q = q.eq("status", status);

  const { data: jobs } = await q;
  if (!jobs || jobs.length === 0) return NextResponse.json({ jobs: [] });

  // Pull invoice rollups in one shot
  const jobIds = jobs.map((j) => j.id as string);
  const { data: invoices } = await supabaseAdmin
    .from("retail_invoices")
    .select("retail_job_id, amount_cents, status, paid_amount_cents")
    .in("retail_job_id", jobIds);

  const invByJob = new Map<
    string,
    { total: number; paid: number; sent: number; drafts: number }
  >();
  for (const j of jobIds) {
    invByJob.set(j, { total: 0, paid: 0, sent: 0, drafts: 0 });
  }
  for (const inv of invoices || []) {
    const bucket = invByJob.get(inv.retail_job_id as string);
    if (!bucket) continue;
    bucket.total += inv.amount_cents ?? 0;
    if (inv.status === "paid") {
      bucket.paid += inv.paid_amount_cents ?? inv.amount_cents ?? 0;
    } else if (inv.status === "sent") {
      bucket.sent += inv.amount_cents ?? 0;
    } else if (inv.status === "draft") {
      bucket.drafts += 1;
    }
  }

  const enriched = jobs.map((j) => ({
    ...j,
    invoice_rollup: invByJob.get(j.id as string),
  }));

  return NextResponse.json({ jobs: enriched });
}
