import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

interface ClaimRow {
  id: string;
  carrier: string | null;
  status: string | null;
  claim_outcome: string | null;
  contractor_rcv: number | null;
  original_carrier_rcv: number | null;
  current_carrier_rcv: number | null;
  settlement_amount: number | null;
  scope_comparison: unknown;
  user_id: string;
}

interface CarrierMetrics {
  carrier_name: string;
  total_claims: number;
  wins: number;
  win_rate: number;
  avg_carrier_rcv: number;
  avg_contractor_rcv: number;
  avg_variance: number;
  total_movement: number;
  supplement_count: number;
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
    const { userIds: teamUserIds } = await getTeamUserIds({
      id: user.id,
      email: user.email || profileRows[0].email || null,
    });

    if (teamUserIds.length === 0) {
      return NextResponse.json({ carriers: [] });
    }

    // Fetch all claims for the team
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select(
        "id, carrier, status, claim_outcome, contractor_rcv, original_carrier_rcv, current_carrier_rcv, settlement_amount, scope_comparison, user_id"
      )
      .in("user_id", teamUserIds)
      .order("created_at", { ascending: false });

    const allClaims: ClaimRow[] = (claims || []) as ClaimRow[];

    // Group claims by carrier name (normalized)
    const carrierMap: Record<string, ClaimRow[]> = {};
    for (const c of allClaims) {
      const name = (c.carrier || "Unknown").trim();
      // Normalize: title case the carrier name for grouping
      const key = name.toLowerCase();
      if (!carrierMap[key]) {
        carrierMap[key] = [];
      }
      carrierMap[key].push(c);
    }

    const carriers: CarrierMetrics[] = [];

    for (const [, carrierClaims] of Object.entries(carrierMap)) {
      // Use the first claim's carrier name as the display name
      const carrierName = (carrierClaims[0].carrier || "Unknown").trim();

      const totalClaims = carrierClaims.length;
      const wins = carrierClaims.filter((c) => c.claim_outcome === "won").length;

      // Win rate: wins / total claims for this carrier
      const winRate = totalClaims > 0 ? Math.round((wins / totalClaims) * 100) : 0;

      // Average carrier RCV (original)
      const carrierRcvValues = carrierClaims
        .map((c) => Number(c.original_carrier_rcv) || 0)
        .filter((v) => v > 0);
      const avgCarrierRcv =
        carrierRcvValues.length > 0
          ? Math.round(carrierRcvValues.reduce((a, b) => a + b, 0) / carrierRcvValues.length)
          : 0;

      // Average contractor RCV
      const contractorRcvValues = carrierClaims
        .map((c) => Number(c.contractor_rcv) || 0)
        .filter((v) => v > 0);
      const avgContractorRcv =
        contractorRcvValues.length > 0
          ? Math.round(
              contractorRcvValues.reduce((a, b) => a + b, 0) / contractorRcvValues.length
            )
          : 0;

      // Average variance per claim (contractor - carrier, using paired data)
      const pairedVariances = carrierClaims
        .map((c) => {
          const contractor = Number(c.contractor_rcv) || 0;
          const carrier = Number(c.original_carrier_rcv) || 0;
          return contractor > 0 && carrier > 0 ? contractor - carrier : null;
        })
        .filter((v): v is number => v !== null);
      const avgVariance = pairedVariances.length > 0
        ? Math.round(pairedVariances.reduce((a, b) => a + b, 0) / pairedVariances.length)
        : 0;

      // Total movement (settlement - original for won claims)
      const totalMovement = carrierClaims
        .filter((c) => c.claim_outcome === "won")
        .reduce((sum, c) => {
          const settlement = Number(c.settlement_amount) || 0;
          const original = Number(c.original_carrier_rcv) || 0;
          return sum + Math.max(0, settlement - original);
        }, 0);

      // Supplement count (claims with scope_comparison populated)
      const supplementCount = carrierClaims.filter(
        (c) => c.scope_comparison !== null && c.scope_comparison !== undefined
      ).length;

      carriers.push({
        carrier_name: carrierName,
        total_claims: totalClaims,
        wins,
        win_rate: winRate,
        avg_carrier_rcv: avgCarrierRcv,
        avg_contractor_rcv: avgContractorRcv,
        avg_variance: avgVariance,
        total_movement: Math.round(totalMovement),
        supplement_count: supplementCount,
      });
    }

    // Sort by total_claims descending
    carriers.sort((a, b) => b.total_claims - a.total_claims);

    return NextResponse.json({ carriers });
  } catch (err) {
    console.error("[api/admin/carriers] failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
