import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logClaimEvent } from "@/lib/claim-events";

/**
 * PATCH /api/admin/production/schedules/[id]
 * Body: { scheduled_at?, end_at?, crew_id?, status?, notes? }
 *
 * Updates an existing schedule. Status transitions:
 *   scheduled → in_progress | completed | cancelled
 *   in_progress → completed | cancelled
 */
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
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;

  const { data: existing } = await supabaseAdmin
    .from("production_schedules")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const allowed = ["scheduled_at", "end_at", "crew_id", "status", "notes"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) update[k] = body[k];
  }

  if (update.status && typeof update.status === "string") {
    const validTransitions: Record<string, string[]> = {
      scheduled: ["in_progress", "completed", "cancelled"],
      in_progress: ["completed", "cancelled"],
      completed: [],
      cancelled: [],
      superseded: [],
    };
    const allowedNext = validTransitions[existing.status] ?? [];
    if (!allowedNext.includes(update.status as string)) {
      return NextResponse.json(
        { error: `Cannot transition ${existing.status} → ${update.status}` },
        { status: 400 }
      );
    }
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("production_schedules")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (updErr || !updated) {
    return NextResponse.json(
      { error: updErr?.message || "Update failed" },
      { status: 500 }
    );
  }

  // Emit claim event for status transitions
  if (update.status === "completed") {
    await logClaimEvent(existing.claim_id, "install_complete", {
      source: "user",
      createdBy: user.id,
      metadata: { schedule_id: id },
    });
  } else if (update.scheduled_at && update.scheduled_at !== existing.scheduled_at) {
    await logClaimEvent(existing.claim_id, "install_scheduled", {
      source: "user",
      createdBy: user.id,
      title: "Install rescheduled",
      metadata: {
        schedule_id: id,
        from: existing.scheduled_at,
        to: update.scheduled_at,
      },
    });
  }

  return NextResponse.json({ schedule: updated });
}

/**
 * DELETE /api/admin/production/schedules/[id]
 * Soft-cancel — sets status='cancelled' rather than deleting the row.
 */
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
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;

  const { data: existing } = await supabaseAdmin
    .from("production_schedules")
    .select("id, claim_id, company_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.status === "completed") {
    return NextResponse.json(
      { error: "Cannot cancel a completed schedule" },
      { status: 400 }
    );
  }

  await supabaseAdmin
    .from("production_schedules")
    .update({ status: "cancelled" })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
