import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";
import type { ScopeComparisonRow, CarrierLineItem, ScopeComparisonResponse } from "@/types/scope-comparison";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");

  if (!claimId) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized for this claim" }, { status: 403 });
  }

  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("claims")
    .select("scope_comparison, previous_carrier_data, contractor_rcv, original_carrier_rcv, current_carrier_rcv, o_and_p_enabled, tax_rate, trade_count")
    .eq("id", claimId)
    .single();

  if (claimErr || !claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const comparisonRows: ScopeComparisonRow[] = (claim.scope_comparison as ScopeComparisonRow[]) || [];
  if (comparisonRows.length === 0) {
    return NextResponse.json({ error: "No scope comparison data available" }, { status: 404 });
  }

  // Extract carrier line items from previous_carrier_data
  const prevData = claim.previous_carrier_data as Record<string, unknown> | null;
  const carrierLineItems: CarrierLineItem[] = ((prevData?.carrier_line_items as CarrierLineItem[]) || []);
  const carrierRcv = (prevData?.carrier_rcv as number) || claim.current_carrier_rcv || claim.original_carrier_rcv || 0;

  // Compute summary
  let missingCount = 0;
  let underCount = 0;
  let matchCount = 0;
  let carrierOnlyCount = 0;
  let supplementOpportunity = 0;
  const tricksDetected: string[] = [];

  for (const row of comparisonRows) {
    const status = row.status || "";
    if (status === "missing") {
      missingCount++;
      supplementOpportunity += row.usarm_amount || row.ev_qty * (row.xact_unit_price || 0);
    } else if (status === "under") {
      underCount++;
      const carrierAmt = row.carrier_amount || 0;
      const usarmAmt = row.usarm_amount || row.ev_qty * (row.xact_unit_price || 0);
      if (usarmAmt > carrierAmt) {
        supplementOpportunity += usarmAmt - carrierAmt;
      }
    } else if (status === "match" || status === "over") {
      matchCount++;
    } else if (status === "carrier_only") {
      carrierOnlyCount++;
    }
    if (row.carrier_trick && !tricksDetected.includes(row.carrier_trick)) {
      tricksDetected.push(row.carrier_trick);
    }
  }

  // Compute financials
  const contractorRcv = claim.contractor_rcv || 0;
  const taxRate = claim.tax_rate || 0.08;
  const oAndPEnabled = claim.o_and_p_enabled || false;

  // Compute O&P from line items (10% + 11% = 21%)
  const lineTotal = comparisonRows
    .filter((r) => r.status !== "carrier_only")
    .reduce((s, r) => s + (r.usarm_amount || 0), 0);
  const oAndP = oAndPEnabled ? Math.round(lineTotal * 0.21 * 100) / 100 : 0;

  const response: ScopeComparisonResponse = {
    comparison_rows: comparisonRows,
    carrier_line_items: carrierLineItems,
    financials: {
      carrier_rcv: carrierRcv,
      contractor_rcv: contractorRcv,
      variance: contractorRcv - carrierRcv,
      deductible: 0, // TODO: read from config if stored
      tax_rate: taxRate,
      o_and_p: oAndP,
      o_and_p_enabled: oAndPEnabled,
      supplement_opportunity: Math.round(supplementOpportunity * 100) / 100,
    },
    summary: {
      total_items: comparisonRows.length,
      missing_count: missingCount,
      under_count: underCount,
      match_count: matchCount,
      carrier_only_count: carrierOnlyCount,
      tricks_detected: tricksDetected,
    },
  };

  return NextResponse.json(response);
}
