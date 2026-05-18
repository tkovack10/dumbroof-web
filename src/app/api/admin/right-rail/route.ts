import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/right-rail
 *
 * Phase 6 Slice 5 — admin right-rail data.
 *
 * Persistent "what matters now" surface for the admin pages. Same
 * shape as the per-claim right rail (damage score / contacts /
 * editable fields / timeline) but at the company level:
 *
 *   - Top rep this week (most check_uploads in last 7 days)
 *   - Biggest recent win (highest contractor_rcv on a 'won' claim in last 30 days)
 *   - Most recent check (last check_uploads row)
 *   - Oldest stalled claim (highest days-since-last_touched_at on active)
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
    .select("is_admin, email")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const teamLookup = await getTeamUserIds({
    id: user.id,
    email: user.email || profileRows[0].email || null,
  });
  const teamUserIds = teamLookup.userIds;
  const companyId = teamLookup.companyId;
  if (teamUserIds.length === 0) {
    return NextResponse.json(emptyResponse());
  }

  const now = Date.now();
  const day = 86_400_000;
  const sevenDaysAgo = new Date(now - 7 * day).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * day).toISOString();

  const [checksResp, winsResp, claimsResp] = await Promise.all([
    // Checks this week — per rep
    supabaseAdmin
      .from("check_uploads")
      .select("uploader_user_id, amount_cents, received_at, claim_id, payor")
      .eq("company_id", companyId ?? "00000000-0000-0000-0000-000000000000")
      .gte("received_at", sevenDaysAgo)
      .order("received_at", { ascending: false }),
    // Wins last 30 days (status='won' or contractor_rcv significantly above carrier)
    supabaseAdmin
      .from("claims")
      .select("id, address, contractor_rcv, current_carrier_rcv, last_touched_at, user_id, assigned_user_id, status")
      .in("user_id", teamUserIds)
      .or("status.eq.won,status.eq.paid")
      .gte("last_touched_at", thirtyDaysAgo)
      .order("contractor_rcv", { ascending: false, nullsFirst: false })
      .limit(5),
    // Stalled — active claims with oldest last_touched_at
    supabaseAdmin
      .from("claims")
      .select("id, address, carrier:carrier, last_touched_at, user_id, assigned_user_id, status, contractor_rcv")
      .in("user_id", teamUserIds)
      .not("status", "in", "(won,lost,paid,completed,closed)")
      .order("last_touched_at", { ascending: true, nullsFirst: true })
      .limit(5),
  ]);

  // Top rep by checks this week
  const checks = checksResp.data || [];
  const checksByRep = new Map<string, { count: number; cents: number }>();
  for (const c of checks) {
    const k = c.uploader_user_id;
    if (!k) continue;
    const slot = checksByRep.get(k) ?? { count: 0, cents: 0 };
    slot.count += 1;
    slot.cents += c.amount_cents ?? 0;
    checksByRep.set(k, slot);
  }
  let topRep: {
    user_id: string;
    email: string | null;
    check_count: number;
    total_cents: number;
  } | null = null;
  for (const [uid, slot] of checksByRep.entries()) {
    if (!topRep || slot.cents > topRep.total_cents) {
      topRep = {
        user_id: uid,
        email:
          teamLookup.members.find((m) => m.id === uid)?.email ?? null,
        check_count: slot.count,
        total_cents: slot.cents,
      };
    }
  }

  // Most recent check
  const recentCheck = checks[0]
    ? {
        claim_id: checks[0].claim_id,
        amount_cents: checks[0].amount_cents,
        payor: checks[0].payor,
        received_at: checks[0].received_at,
      }
    : null;

  // Biggest recent win
  const wins = winsResp.data || [];
  const biggestWin = wins[0]
    ? {
        claim_id: wins[0].id,
        address: wins[0].address,
        contractor_rcv: Number(wins[0].contractor_rcv ?? 0),
        rep_email:
          teamLookup.members.find(
            (m) => m.id === (wins[0].assigned_user_id || wins[0].user_id)
          )?.email ?? null,
      }
    : null;

  // Oldest stalled
  const stalled = claimsResp.data || [];
  const oldestStalled = stalled[0]
    ? {
        claim_id: stalled[0].id,
        address: stalled[0].address,
        carrier:
          (stalled[0] as { carrier?: string | null }).carrier ?? null,
        last_touched_at: stalled[0].last_touched_at,
        days_stale: stalled[0].last_touched_at
          ? Math.floor(
              (now - new Date(stalled[0].last_touched_at).getTime()) / day
            )
          : null,
        rep_email:
          teamLookup.members.find(
            (m) => m.id === (stalled[0].assigned_user_id || stalled[0].user_id)
          )?.email ?? null,
      }
    : null;

  return NextResponse.json({
    top_rep: topRep,
    recent_check: recentCheck,
    biggest_win: biggestWin,
    oldest_stalled: oldestStalled,
  });
}

function emptyResponse() {
  return {
    top_rep: null,
    recent_check: null,
    biggest_win: null,
    oldest_stalled: null,
  };
}
