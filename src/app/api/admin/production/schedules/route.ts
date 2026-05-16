import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logClaimEvent } from "@/lib/claim-events";

interface ScheduleRow {
  id: string;
  claim_id: string;
  crew_id: string | null;
  scheduled_at: string;
  end_at: string | null;
  status: string;
  notes: string | null;
  notify_homeowner: boolean;
  notified_at: string | null;
  created_at: string;
}

/**
 * GET /api/admin/production/schedules?from=ISO&to=ISO
 * Returns schedules in the window for the admin's company,
 * hydrated with claim + crew info for calendar rendering.
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
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;
  if (!companyId) {
    return NextResponse.json({ schedules: [], crews: [] });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let q = supabaseAdmin
    .from("production_schedules")
    .select("*")
    .eq("company_id", companyId)
    .neq("status", "superseded")
    .order("scheduled_at", { ascending: true });

  if (from) q = q.gte("scheduled_at", from);
  if (to) q = q.lte("scheduled_at", to);

  const [{ data: schedules }, { data: crews }] = await Promise.all([
    q,
    supabaseAdmin
      .from("crews")
      .select("id, name, color, active")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name"),
  ]);

  const rows = (schedules || []) as ScheduleRow[];
  if (rows.length === 0) {
    return NextResponse.json({ schedules: [], crews: crews || [] });
  }

  // Hydrate claim summaries in one shot
  const claimIds = Array.from(new Set(rows.map((r) => r.claim_id)));
  const { data: claims } = await supabaseAdmin
    .from("claims")
    .select("id, address, homeowner_name, homeowner_email, carrier_name, status")
    .in("id", claimIds);

  const claimById = new Map(
    (claims || []).map((c) => [c.id as string, c])
  );

  const enriched = rows.map((r) => ({
    ...r,
    claim: claimById.get(r.claim_id) ?? null,
  }));

  return NextResponse.json({ schedules: enriched, crews: crews || [] });
}

/**
 * POST /api/admin/production/schedules
 * Body: { claim_id, scheduled_at, end_at?, crew_id?, notes?, notify_homeowner? }
 *
 * Schedules a claim. If the claim already has an active schedule, the
 * existing one is marked 'superseded' (history preserved) and a new row
 * is inserted. Emits install_scheduled claim_event.
 *
 * notify_homeowner defaults to true. Email send is the caller's responsibility
 * via POST /api/admin/production/schedules/[id]/notify (kept separate so we
 * can dry-run / preview / cancel a schedule without firing emails).
 */
export async function POST(req: Request) {
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

  const body = await req.json().catch(() => ({}));
  const { claim_id, scheduled_at, end_at, crew_id, notes, notify_homeowner } = body;

  if (!claim_id || !scheduled_at) {
    return NextResponse.json(
      { error: "claim_id and scheduled_at are required" },
      { status: 400 }
    );
  }

  // Confirm the claim belongs to this admin's company
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("id, company_id")
    .eq("id", claim_id)
    .maybeSingle();
  if (!claim || claim.company_id !== companyId) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // Supersede any existing active schedule for this claim
  await supabaseAdmin
    .from("production_schedules")
    .update({ status: "superseded" })
    .eq("claim_id", claim_id)
    .in("status", ["scheduled", "in_progress"]);

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("production_schedules")
    .insert({
      claim_id,
      company_id: companyId,
      crew_id: crew_id || null,
      scheduled_at,
      end_at: end_at || null,
      notify_homeowner: notify_homeowner !== false,
      notes: notes || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message || "Failed to schedule" },
      { status: 500 }
    );
  }

  await logClaimEvent(claim_id, "install_scheduled", {
    source: "user",
    createdBy: user.id,
    metadata: {
      schedule_id: inserted.id,
      scheduled_at,
      end_at: end_at || null,
      crew_id: crew_id || null,
    },
  });

  return NextResponse.json({ schedule: inserted });
}
