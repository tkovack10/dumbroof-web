import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface ClaimRow {
  id: string;
  address: string | null;
  carrier: string | null;
  status: string | null;
  lifecycle_phase: string | null;
  claim_outcome: string | null;
  contractor_rcv: number | null;
  damage_score: number | null;
  damage_grade: string | null;
  created_at: string;
  user_id: string;
  report_mode: string | null;
  homeowner_name: string | null;
  claim_number: string | null;
  adjuster_email: string | null;
}

interface PipelineCard {
  id: string;
  address: string;
  carrier: string | null;
  rcv: number;
  damage_score: number | null;
  damage_grade: string | null;
  rep_email: string;
  days_in_stage: number;
  created_at: string;
  homeowner_name: string | null;
  claim_number: string | null;
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
    // Get user's email domain for team matching
    const email = user.email || profileRows[0].email || "";
    const domain = email.split("@")[1];

    if (!domain) {
      return NextResponse.json({ error: "Cannot determine email domain" }, { status: 400 });
    }

    // Get all user IDs with the same email domain
    const { data: domainUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 500 });
    const teamUsers = (domainUsers?.users || []).filter(
      (u) => u.email && u.email.endsWith(`@${domain}`)
    );
    const teamUserIds = teamUsers.map((u) => u.id);

    if (teamUserIds.length === 0) {
      return NextResponse.json({ stages: emptyStages(), totals: emptyCounts() });
    }

    // Fetch all claims for the team
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select(
        "id, address, carrier, status, lifecycle_phase, claim_outcome, contractor_rcv, damage_score, damage_grade, created_at, user_id, report_mode, homeowner_name, claim_number, adjuster_email"
      )
      .in("user_id", teamUserIds)
      .order("created_at", { ascending: false });

    const allClaims: ClaimRow[] = (claims || []) as ClaimRow[];

    // Build rep email lookup from team users
    const repEmailMap: Record<string, string> = {};
    for (const u of teamUsers) {
      if (u.id && u.email) {
        repEmailMap[u.id] = u.email;
      }
    }

    const now = Date.now();

    function toCard(c: ClaimRow): PipelineCard {
      const daysInStage = Math.max(
        0,
        Math.floor((now - new Date(c.created_at).getTime()) / 86400000)
      );
      return {
        id: c.id,
        address: c.address || "Unknown",
        carrier: c.carrier || null,
        rcv: Number(c.contractor_rcv) || 0,
        damage_score: c.damage_score,
        damage_grade: c.damage_grade || null,
        rep_email: repEmailMap[c.user_id] || "unknown",
        days_in_stage: daysInStage,
        created_at: c.created_at,
        homeowner_name: c.homeowner_name || null,
        claim_number: c.claim_number || null,
      };
    }

    // Group claims into pipeline stages
    const stages: Record<string, PipelineCard[]> = {
      new_leads: [],
      processing: [],
      ready: [],
      won: [],
      installation: [],
      completed: [],
      invoiced: [],
      paid: [],
      needs_improvement: [],
      error: [],
    };

    for (const c of allClaims) {
      if (c.status === "error") {
        stages.error.push(toCard(c));
      } else if (c.status === "needs_improvement") {
        stages.needs_improvement.push(toCard(c));
      } else if (c.claim_outcome === "won") {
        const lp = c.lifecycle_phase;
        if (lp === "installation") stages.installation.push(toCard(c));
        else if (lp === "completed") stages.completed.push(toCard(c));
        else if (lp === "invoiced") stages.invoiced.push(toCard(c));
        else if (lp === "paid") stages.paid.push(toCard(c));
        else stages.won.push(toCard(c));
      } else if (c.status === "uploaded") {
        stages.new_leads.push(toCard(c));
      } else if (c.status === "processing") {
        stages.processing.push(toCard(c));
      } else if (c.status === "ready") {
        if (!c.lifecycle_phase || c.lifecycle_phase === "claim") {
          stages.ready.push(toCard(c));
        } else {
          stages.ready.push(toCard(c));
        }
      }
    }

    const totals: Record<string, number> = {};
    for (const [key, cards] of Object.entries(stages)) {
      totals[key] = cards.length;
    }

    return NextResponse.json({ stages, totals });
  } catch (err) {
    console.error("[api/admin/pipeline] failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function emptyStages() {
  return {
    new_leads: [],
    processing: [],
    ready: [],
    won: [],
    installation: [],
    completed: [],
    invoiced: [],
    paid: [],
    needs_improvement: [],
    error: [],
  };
}

function emptyCounts() {
  return {
    new_leads: 0,
    processing: 0,
    ready: 0,
    won: 0,
    installation: 0,
    completed: 0,
    invoiced: 0,
    paid: 0,
    needs_improvement: 0,
    error: 0,
  };
}
