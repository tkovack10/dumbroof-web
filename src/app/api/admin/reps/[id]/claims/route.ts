import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface ClaimRow {
  id: string;
  address: string | null;
  carrier_name: string | null;
  status: string | null;
  last_touched_at: string | null;
  created_at: string | null;
  financials: { total?: number } | null;
}

interface EventRow {
  claim_id: string;
  event_type: string;
  occurred_at: string;
}

/**
 * GET /api/admin/reps/[id]/claims
 * Returns one rep's claims plus aggregated checkpoint status for each.
 *
 * Auth: admin in the rep's company. RLS prevents cross-company peeking
 * since both queries go through company_profiles → company_id.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: repUserId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: callerRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);

  if (!callerRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const callerCompanyId = callerRows[0].company_id;

  // Verify the rep is in the caller's company
  const { data: repRows } = await supabaseAdmin
    .from("company_profiles")
    .select("company_id")
    .eq("user_id", repUserId)
    .limit(1);

  if (!repRows?.[0] || repRows[0].company_id !== callerCompanyId) {
    return NextResponse.json({ claims: [] });
  }

  // Pull the rep's claims (assigned_user_id is the canonical rep field)
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select("id, address, carrier_name, status, last_touched_at, created_at, financials")
    .eq("assigned_user_id", repUserId)
    .order("last_touched_at", { ascending: false })
    .limit(100);

  const claims = (claimRows || []) as ClaimRow[];
  if (claims.length === 0) {
    return NextResponse.json({ claims: [] });
  }

  const claimIds = claims.map((c) => c.id);

  // Pull all checkpoint events in one shot
  const checkpointTypes = [
    "forensic_sent_to_carrier",
    "forensic_sent_to_homeowner",
    "supplement_sent_to_carrier",
    "coc_sent_to_homeowner",
    "homeowner_engagement_sent",
    "check_received",
  ];
  const { data: eventRows } = await supabaseAdmin
    .from("claim_events")
    .select("claim_id, event_type, occurred_at")
    .in("claim_id", claimIds)
    .in("event_type", checkpointTypes);

  // Aggregate: for each claim, did we see each checkpoint?
  const byClaim = new Map<
    string,
    {
      forensic: { done: boolean; at: string | null };
      supplement: { done: boolean; at: string | null };
      coc: { done: boolean; at: string | null };
      engagement: { done: boolean; at: string | null };
      check_received: { done: boolean; at: string | null };
    }
  >();

  for (const id of claimIds) {
    byClaim.set(id, {
      forensic: { done: false, at: null },
      supplement: { done: false, at: null },
      coc: { done: false, at: null },
      engagement: { done: false, at: null },
      check_received: { done: false, at: null },
    });
  }

  for (const e of (eventRows || []) as EventRow[]) {
    const bucket = byClaim.get(e.claim_id);
    if (!bucket) continue;
    let key: keyof typeof bucket | null = null;
    if (
      e.event_type === "forensic_sent_to_carrier" ||
      e.event_type === "forensic_sent_to_homeowner"
    ) {
      key = "forensic";
    } else if (e.event_type === "supplement_sent_to_carrier") {
      key = "supplement";
    } else if (e.event_type === "coc_sent_to_homeowner") {
      key = "coc";
    } else if (e.event_type === "homeowner_engagement_sent") {
      key = "engagement";
    } else if (e.event_type === "check_received") {
      key = "check_received";
    }
    if (!key) continue;
    const slot = bucket[key];
    if (!slot.done || (slot.at && e.occurred_at > slot.at)) {
      bucket[key] = { done: true, at: e.occurred_at };
    }
  }

  // Pull commission counts per claim
  const { data: commRows } = await supabaseAdmin
    .from("commission_requests")
    .select("claim_id, status, amount_cents")
    .in("claim_id", claimIds)
    .eq("rep_user_id", repUserId);

  const commByClaim = new Map<
    string,
    { pending_count: number; pending_cents: number; paid_cents: number }
  >();
  for (const id of claimIds) {
    commByClaim.set(id, { pending_count: 0, pending_cents: 0, paid_cents: 0 });
  }
  for (const c of commRows || []) {
    const bucket = commByClaim.get(c.claim_id);
    if (!bucket) continue;
    if (c.status === "pending") {
      bucket.pending_count += 1;
      bucket.pending_cents += c.amount_cents ?? 0;
    } else if (c.status === "paid") {
      bucket.paid_cents += c.amount_cents ?? 0;
    }
  }

  const enriched = claims.map((c) => ({
    ...c,
    checkpoints: byClaim.get(c.id)!,
    commission: commByClaim.get(c.id)!,
  }));

  return NextResponse.json({ claims: enriched });
}
