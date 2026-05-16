import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/admin/retail/[id]
 * Returns one retail job + all its invoices.
 *
 * PATCH /api/admin/retail/[id]
 * Body: { status?, line_items?, terms?, deposit_pct?, payment_schedule?,
 *         customer_name?, customer_email?, customer_phone?, address?,
 *         city_state_zip?, scope_description?, notes? }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
  if (!companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: job } = await supabaseAdmin
    .from("retail_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!job || job.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: invoices } = await supabaseAdmin
    .from("retail_invoices")
    .select("*")
    .eq("retail_job_id", id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ job, invoices: invoices || [] });
}

const ALLOWED_PATCH_FIELDS = [
  "status",
  "line_items",
  "subtotal_cents",
  "tax_rate",
  "tax_cents",
  "total_cents",
  "terms",
  "deposit_pct",
  "payment_schedule",
  "customer_name",
  "customer_email",
  "customer_phone",
  "address",
  "city_state_zip",
  "scope_description",
  "assigned_user_id",
  "notes",
] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
  if (!companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: existing } = await supabaseAdmin
    .from("retail_jobs")
    .select("id, company_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED_PATCH_FIELDS) {
    if (k in body) update[k] = body[k];
  }

  // Stamp accepted_at / proposal_sent_at on the appropriate transitions
  if (update.status === "accepted" && existing.status !== "accepted") {
    update.accepted_at = new Date().toISOString();
  }
  if (update.status === "proposal_sent" && existing.status === "draft") {
    update.proposal_sent_at = new Date().toISOString();
  }

  const { data: updated, error } = await supabaseAdmin
    .from("retail_jobs")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message || "Update failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ job: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;

  const { data: existing } = await supabaseAdmin
    .from("retail_jobs")
    .select("id, company_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Block delete if any paid invoice exists — cascade would wipe payment history.
  const { count: paidCount } = await supabaseAdmin
    .from("retail_invoices")
    .select("id", { count: "exact", head: true })
    .eq("retail_job_id", id)
    .eq("status", "paid");
  if ((paidCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Cannot delete a retail job with paid invoices. Mark it 'lost' or 'completed' instead.",
      },
      { status: 400 }
    );
  }

  await supabaseAdmin.from("retail_jobs").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
