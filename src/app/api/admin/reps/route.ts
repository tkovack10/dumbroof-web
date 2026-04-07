import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

interface ClaimRow {
  id: string;
  status: string | null;
  claim_outcome: string | null;
  contractor_rcv: number | null;
  damage_score: number | null;
  created_at: string;
  user_id: string;
  scope_comparison: unknown;
}

interface RepMetrics {
  user_id: string;
  email: string;
  claims_submitted: number;
  claims_this_month: number;
  wins: number;
  win_rate: number;
  total_rcv: number;
  avg_rcv: number;
  avg_damage_score: number | null;
  last_activity: string | null;
  needs_improvement_count: number;
}

interface Alert {
  email: string;
  type: "inactive" | "low_quality";
  message: string;
}

export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult.response;
  const { user } = authResult;

  // Admin check via company_profiles
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, email")
    .eq("user_id", user.id)
    .limit(1);

  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const { userIds: teamUserIds, members: teamUsers } = await getTeamUserIds({
      id: user.id,
      email: user.email || profileRows[0].email || null,
    });

    if (teamUserIds.length === 0) {
      return NextResponse.json({ reps: [], alerts: [] });
    }

    // Fetch all claims for the team
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select(
        "id, status, claim_outcome, contractor_rcv, damage_score, created_at, user_id, scope_comparison"
      )
      .in("user_id", teamUserIds)
      .order("created_at", { ascending: false });

    const allClaims: ClaimRow[] = (claims || []) as ClaimRow[];

    // Build rep email lookup
    const repEmailMap: Record<string, string> = {};
    for (const u of teamUsers) {
      if (u.id && u.email) {
        repEmailMap[u.id] = u.email;
      }
    }

    // Current month boundaries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Group claims by user_id
    const claimsByUser: Record<string, ClaimRow[]> = {};
    for (const uid of teamUserIds) {
      claimsByUser[uid] = [];
    }
    for (const c of allClaims) {
      if (claimsByUser[c.user_id]) {
        claimsByUser[c.user_id].push(c);
      }
    }

    const reps: RepMetrics[] = [];
    const alerts: Alert[] = [];

    for (const uid of teamUserIds) {
      const repEmail = repEmailMap[uid] || "unknown";
      const repClaims = claimsByUser[uid] || [];

      const claimsSubmitted = repClaims.length;
      const claimsThisMonth = repClaims.filter(
        (c) => c.created_at >= monthStart
      ).length;

      const wins = repClaims.filter((c) => c.claim_outcome === "won").length;

      // Win rate: wins / (claims that have been processed)
      const terminalClaims = repClaims.filter(
        (c) => c.status === "ready" || c.status === "needs_improvement" || c.claim_outcome === "won"
      ).length;
      const winRate = terminalClaims > 0 ? Math.round((wins / terminalClaims) * 100) : 0;

      const rcvValues = repClaims
        .map((c) => Number(c.contractor_rcv) || 0)
        .filter((v) => v > 0);
      const totalRcv = rcvValues.reduce((a, b) => a + b, 0);
      const avgRcv = rcvValues.length > 0 ? Math.round(totalRcv / rcvValues.length) : 0;

      const damageScores = repClaims
        .map((c) => c.damage_score)
        .filter((s): s is number => s !== null && s !== undefined);
      const avgDamageScore =
        damageScores.length > 0
          ? Math.round(damageScores.reduce((a, b) => a + b, 0) / damageScores.length)
          : null;

      const lastActivity =
        repClaims.length > 0 ? repClaims[0].created_at : null;

      const needsImprovementCount = repClaims.filter(
        (c) => c.status === "needs_improvement"
      ).length;

      reps.push({
        user_id: uid,
        email: repEmail,
        claims_submitted: claimsSubmitted,
        claims_this_month: claimsThisMonth,
        wins,
        win_rate: winRate,
        total_rcv: Math.round(totalRcv),
        avg_rcv: avgRcv,
        avg_damage_score: avgDamageScore,
        last_activity: lastActivity,
        needs_improvement_count: needsImprovementCount,
      });

      // Generate alerts
      if (lastActivity) {
        const daysSinceLast = Math.floor(
          (Date.now() - new Date(lastActivity).getTime()) / 86400000
        );
        if (daysSinceLast >= 7) {
          alerts.push({
            email: repEmail,
            type: "inactive",
            message: `No submissions in ${daysSinceLast} days`,
          });
        }
      }

      if (needsImprovementCount >= 3) {
        alerts.push({
          email: repEmail,
          type: "low_quality",
          message: `${needsImprovementCount} claims need improvement`,
        });
      }
    }

    // Sort by total_rcv descending (leaderboard order)
    reps.sort((a, b) => b.total_rcv - a.total_rcv);

    return NextResponse.json({ reps, alerts });
  } catch (err) {
    console.error("[api/admin/reps] failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
