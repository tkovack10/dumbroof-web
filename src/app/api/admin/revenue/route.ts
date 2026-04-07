import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

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
      return NextResponse.json(emptyResponse());
    }

    // Fetch all claims for the team
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select(
        "id, address, carrier, status, claim_outcome, contractor_rcv, settlement_amount, original_carrier_rcv, current_carrier_rcv, created_at, user_id, lifecycle_phase, slug"
      )
      .in("user_id", teamUserIds)
      .order("created_at", { ascending: false });

    const allClaims = claims || [];

    // Fetch all invoices for team user claims
    const claimIds = allClaims.map((c) => c.id);
    let allInvoices: Record<string, unknown>[] = [];
    if (claimIds.length > 0) {
      const { data: invoices } = await supabaseAdmin
        .from("invoices")
        .select("*")
        .in("claim_id", claimIds)
        .order("created_at", { ascending: false });
      allInvoices = invoices || [];
    }

    // Build claim address lookup for invoice display
    const claimLookup: Record<string, { address: string; carrier: string | null }> = {};
    for (const c of allClaims) {
      claimLookup[c.id] = {
        address: c.address || "Unknown",
        carrier: c.carrier || null,
      };
    }

    // --- A/R Aging Buckets ---
    const now = Date.now();
    const aging = {
      current: { count: 0, total: 0 },
      days_30: { count: 0, total: 0 },
      days_60: { count: 0, total: 0 },
      days_90: { count: 0, total: 0 },
    };

    const outstandingInvoices: Record<string, unknown>[] = [];

    for (const inv of allInvoices) {
      const status = String(inv.status || "");
      // Outstanding = sent but not paid
      if (status === "sent" || status === "pending" || status === "overdue") {
        const sentDate = inv.sent_at || inv.created_at;
        if (!sentDate) continue;
        const parsedDate = new Date(String(sentDate)).getTime();
        if (isNaN(parsedDate)) continue;
        const daysSinceSent = Math.floor((now - parsedDate) / 86400000);
        const amount = Number(inv.amount_due) || 0;

        if (daysSinceSent <= 30) {
          aging.current.count++;
          aging.current.total += amount;
        } else if (daysSinceSent <= 60) {
          aging.days_30.count++;
          aging.days_30.total += amount;
        } else if (daysSinceSent <= 90) {
          aging.days_60.count++;
          aging.days_60.total += amount;
        } else {
          aging.days_90.count++;
          aging.days_90.total += amount;
        }

        const claimInfo = claimLookup[String(inv.claim_id)] || { address: "Unknown", carrier: null };
        outstandingInvoices.push({
          id: inv.id,
          invoice_number: inv.invoice_number,
          claim_id: inv.claim_id,
          address: claimInfo.address,
          carrier: claimInfo.carrier,
          amount_due: amount,
          days_outstanding: daysSinceSent,
          status: status,
          sent_at: inv.sent_at,
          created_at: inv.created_at,
          due_date: inv.due_date,
          recipient_name: inv.recipient_name,
          recipient_email: inv.recipient_email,
        });
      }
    }

    // Round aging totals
    aging.current.total = Math.round(aging.current.total * 100) / 100;
    aging.days_30.total = Math.round(aging.days_30.total * 100) / 100;
    aging.days_60.total = Math.round(aging.days_60.total * 100) / 100;
    aging.days_90.total = Math.round(aging.days_90.total * 100) / 100;

    // --- Monthly Revenue Aggregation ---
    // Group claims by month of created_at
    const monthlyMap: Record<
      string,
      { revenue: number; collected: number; claims_won: number; total_claims: number }
    > = {};

    for (const c of allClaims) {
      const month = c.created_at?.slice(0, 7); // "2026-03"
      if (!month) continue;

      if (!monthlyMap[month]) {
        monthlyMap[month] = { revenue: 0, collected: 0, claims_won: 0, total_claims: 0 };
      }
      monthlyMap[month].total_claims++;
      monthlyMap[month].revenue += Number(c.contractor_rcv) || 0;

      if (c.claim_outcome === "won") {
        monthlyMap[month].claims_won++;
        monthlyMap[month].collected += Number(c.settlement_amount) || 0;
      }
    }

    // Sort by month descending, take last 12
    const monthly = Object.entries(monthlyMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 12)
      .map(([month, data]) => ({
        month,
        revenue: Math.round(data.revenue * 100) / 100,
        collected: Math.round(data.collected * 100) / 100,
        claims_won: data.claims_won,
        total_claims: data.total_claims,
      }));

    // --- Totals ---
    const totalInvoiced = allInvoices.reduce(
      (sum, inv) => sum + (Number(inv.amount_due) || 0),
      0
    );
    const totalCollected = allInvoices
      .filter((inv) => inv.status === "paid")
      .reduce((sum, inv) => sum + (Number(inv.amount_due) || 0), 0);
    const totalOutstanding =
      aging.current.total + aging.days_30.total + aging.days_60.total + aging.days_90.total;
    const collectionRate =
      totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 1000) / 10 : 0;

    return NextResponse.json({
      invoices: outstandingInvoices,
      aging,
      monthly,
      totals: {
        total_invoiced: Math.round(totalInvoiced * 100) / 100,
        total_collected: Math.round(totalCollected * 100) / 100,
        total_outstanding: Math.round(totalOutstanding * 100) / 100,
        collection_rate: collectionRate,
      },
    });
  } catch (err) {
    console.error("[api/admin/revenue] failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function emptyResponse() {
  return {
    invoices: [],
    aging: {
      current: { count: 0, total: 0 },
      days_30: { count: 0, total: 0 },
      days_60: { count: 0, total: 0 },
      days_90: { count: 0, total: 0 },
    },
    monthly: [],
    totals: {
      total_invoiced: 0,
      total_collected: 0,
      total_outstanding: 0,
      collection_rate: 0,
    },
  };
}
