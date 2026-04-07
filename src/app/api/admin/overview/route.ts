import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

export async function GET() {
  // Auth check
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
      return NextResponse.json(emptyResponse(0));
    }

    // Fetch all claims for the team
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select("*")
      .in("user_id", teamUserIds)
      .order("created_at", { ascending: false });

    const allClaims = claims || [];

    // --- KPIs ---
    const totalClaims = allClaims.length;
    const wonClaims = allClaims.filter((c) => c.claim_outcome === "won");
    const winCount = wonClaims.length;
    const winRate = totalClaims > 0 ? Math.round((winCount / totalClaims) * 1000) / 10 : 0;

    const totalRevenue = allClaims.reduce(
      (sum: number, c: Record<string, unknown>) => sum + (Number(c.contractor_rcv) || 0),
      0
    );

    const carrierMovement = wonClaims.reduce((sum: number, c: Record<string, unknown>) => {
      const movement =
        (Number(c.settlement_amount) || 0) - (Number(c.original_carrier_rcv) || 0);
      return sum + (movement > 0 ? movement : 0);
    }, 0);

    const avgClaimValue = totalClaims > 0 ? Math.round(totalRevenue / totalClaims) : 0;

    // Count unique reps (user_ids that have submitted claims)
    const uniqueReps = new Set(allClaims.map((c: Record<string, unknown>) => c.user_id));
    const activeReps = uniqueReps.size;

    // --- Pipeline ---
    const pipeline: Record<string, number> = {
      uploaded: 0,
      processing: 0,
      ready: 0,
      won: 0,
      installation: 0,
      completed: 0,
      invoiced: 0,
      paid: 0,
    };

    for (const c of allClaims) {
      // Won status
      if (c.claim_outcome === "won") {
        // Check lifecycle_phase for post-win stages
        const lp = c.lifecycle_phase;
        if (lp === "installation") pipeline.installation++;
        else if (lp === "completed") pipeline.completed++;
        else if (lp === "invoiced") pipeline.invoiced++;
        else if (lp === "paid") pipeline.paid++;
        else pipeline.won++;
      } else if (c.status === "uploaded") {
        pipeline.uploaded++;
      } else if (c.status === "processing") {
        pipeline.processing++;
      } else if (c.status === "ready" || c.status === "needs_improvement") {
        pipeline.ready++;
      }
      // errors and other statuses fall through (not shown in pipeline)
    }

    // --- Alerts ---
    const alerts: { type: string; count: number; message: string }[] = [];

    // Check for overdue invoices (>30 days)
    const { data: invoices } = await supabaseAdmin
      .from("invoices")
      .select("id, status, created_at, claim_id")
      .in("status", ["sent", "pending", "overdue"]);

    if (invoices && invoices.length > 0) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const overdueCount = invoices.filter(
        (inv: Record<string, unknown>) =>
          new Date(String(inv.created_at)) < thirtyDaysAgo
      ).length;
      if (overdueCount > 0) {
        alerts.push({
          type: "overdue_invoice",
          count: overdueCount,
          message: `${overdueCount} invoice${overdueCount > 1 ? "s" : ""} overdue (>30 days)`,
        });
      }
    }

    // Check for stale processing (>24h)
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    const staleProcessing = allClaims.filter(
      (c) =>
        c.status === "processing" &&
        new Date(c.created_at) < twentyFourHoursAgo
    ).length;

    if (staleProcessing > 0) {
      alerts.push({
        type: "stale_processing",
        count: staleProcessing,
        message: `${staleProcessing} claim${staleProcessing > 1 ? "s" : ""} stuck in processing >24h`,
      });
    }

    // Check for claims needing attention (errors)
    const errorClaims = allClaims.filter((c) => c.status === "error").length;
    if (errorClaims > 0) {
      alerts.push({
        type: "error_claims",
        count: errorClaims,
        message: `${errorClaims} claim${errorClaims > 1 ? "s" : ""} with errors`,
      });
    }

    // --- Recent Activity ---
    const recentClaims = allClaims.slice(0, 20);
    const recentActivity = recentClaims.map((c) => {
      let action = "claim_submitted";
      if (c.claim_outcome === "won") action = "claim_won";
      else if (c.status === "ready") action = "claim_ready";
      else if (c.status === "processing") action = "claim_processing";
      else if (c.status === "error") action = "claim_error";

      // Find the rep email for this claim
      const repUser = teamUsers.find((u) => u.id === c.user_id);

      return {
        action,
        address: c.address || "Unknown",
        rep: repUser?.email || "unknown",
        timestamp: c.created_at,
        claimId: c.id,
        carrier: c.carrier || null,
      };
    });

    return NextResponse.json({
      kpis: {
        totalClaims,
        totalRevenue,
        winRate,
        winCount,
        carrierMovement,
        avgClaimValue,
        activeReps,
      },
      pipeline,
      alerts,
      recentActivity,
    });
  } catch (err) {
    console.error("[api/admin/overview] failed", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function emptyResponse(activeReps: number) {
  return {
    kpis: {
      totalClaims: 0,
      totalRevenue: 0,
      winRate: 0,
      winCount: 0,
      carrierMovement: 0,
      avgClaimValue: 0,
      activeReps,
    },
    pipeline: {
      uploaded: 0,
      processing: 0,
      ready: 0,
      won: 0,
      installation: 0,
      completed: 0,
      invoiced: 0,
      paid: 0,
    },
    alerts: [],
    recentActivity: [],
  };
}
