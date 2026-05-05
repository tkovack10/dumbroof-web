import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MADashboardContent } from "./ma-dashboard-content";

export const dynamic = "force-dynamic";

export default async function MADashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: admin } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  if (!admin) redirect("/dashboard");

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    claimsRes,
    winsRes,
    inspectorsRes,
    userCountRes,
    companiesRes,
    companies30dRes,
    claims7dRes,
    claims30dRes,
    winsAggRes,
    rcvAggRes,
  ] = await Promise.all([
    supabase.from("claims").select("id", { count: "exact", head: true }),
    supabase.from("claims").select("id", { count: "exact", head: true }).eq("claim_outcome", "won"),
    supabase.from("inspector_applications").select("id", { count: "exact", head: true }),
    supabaseAdmin.rpc("count_platform_users"),
    supabaseAdmin.from("company_profiles").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("company_profiles").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    supabase.from("claims").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    supabase.from("claims").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    supabaseAdmin.from("claims")
      .select("settlement_amount, original_carrier_rcv")
      .eq("claim_outcome", "won"),
    supabaseAdmin.from("claims")
      .select("contractor_rcv, original_carrier_rcv")
      .not("contractor_rcv", "is", null),
  ]);

  // Cost per claim (last 30 days) — paginated up to 10K logs
  let last30dCost = 0;
  let last30dClaimIds = new Set<string>();
  let costByModel: Record<string, number> = {};
  let costByStep: Record<string, number> = {};
  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data: logs } = await supabaseAdmin.from("processing_logs")
      .select("claim_id, total_cost, model, step_name")
      .gte("created_at", thirtyDaysAgo)
      .range(offset, offset + 999);
    if (!logs || logs.length === 0) break;
    for (const r of logs) {
      const c = Number(r.total_cost ?? 0);
      last30dCost += c;
      if (r.claim_id) last30dClaimIds.add(r.claim_id);
      const m = r.model ?? "unknown";
      const s = r.step_name ?? "unknown";
      costByModel[m] = (costByModel[m] ?? 0) + c;
      costByStep[s] = (costByStep[s] ?? 0) + c;
    }
    if (logs.length < 1000) break;
  }
  const last30dClaimCount = last30dClaimIds.size;
  const avgCostPerClaim30d = last30dClaimCount > 0 ? last30dCost / last30dClaimCount : 0;

  // Win + RCV aggregations
  const winRows = (winsAggRes.data as Array<{ settlement_amount: number | null; original_carrier_rcv: number | null }> | null) ?? [];
  const winSettlementTotal = winRows.reduce((s, r) => s + Number(r.settlement_amount ?? 0), 0);
  const winOriginalTotal = winRows.reduce((s, r) => s + Number(r.original_carrier_rcv ?? 0), 0);
  const winCarrierMovement = winSettlementTotal - winOriginalTotal;

  const rcvRows = (rcvAggRes.data as Array<{ contractor_rcv: number | null; original_carrier_rcv: number | null }> | null) ?? [];
  const totalContractorRCV = rcvRows.reduce((s, r) => s + Number(r.contractor_rcv ?? 0), 0);
  const totalCarrierRCV = rcvRows.reduce((s, r) => s + Number(r.original_carrier_rcv ?? 0), 0);
  const totalVariance = totalContractorRCV - totalCarrierRCV;

  return (
    <MADashboardContent
      // Header counts
      totalClaims={claimsRes.count ?? 0}
      wins={winsRes.count ?? 0}
      saasUsers={Number(userCountRes.data ?? 0)}
      companies={companiesRes.count ?? 0}
      companies30d={companies30dRes.count ?? 0}
      inspectorApps={inspectorsRes.count ?? 0}
      claims7d={claims7dRes.count ?? 0}
      claims30d={claims30dRes.count ?? 0}
      // Cost
      last30dCost={last30dCost}
      last30dClaimCount={last30dClaimCount}
      avgCostPerClaim30d={avgCostPerClaim30d}
      costByModel={costByModel}
      costByStep={costByStep}
      // RCV / wins
      winSettlementTotal={winSettlementTotal}
      winCarrierMovement={winCarrierMovement}
      totalContractorRCV={totalContractorRCV}
      totalCarrierRCV={totalCarrierRCV}
      totalVariance={totalVariance}
    />
  );
}
