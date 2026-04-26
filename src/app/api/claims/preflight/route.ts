import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PLANS, type PlanId } from "@/lib/stripe-config";

interface QuotaResult {
  allowed: boolean;
  plan_id: string;
  status: string;
  period_used: number;
  lifetime_used: number;
  remaining: number;
  limit: number | null;
  reason: string | null;
  subscription_user_id: string | null;
  company_shared: boolean;
}

/**
 * POST /api/claims/preflight
 *
 * Fast-rejection quota check called BEFORE the upload starts. Returns 402
 * with a structured payload if the user is at cap, so the UI can swap in the
 * upgrade modal in ~200ms with zero bytes uploaded. The same RPC also runs
 * server-side at processor.py entry as defense in depth (and to catch
 * non-UI upload paths like AccuLynx imports).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("assert_quota_allowed", {
    p_user_id: user.id,
  });

  if (error) {
    console.error("[preflight] assert_quota_allowed RPC failed", error);
    return NextResponse.json({ error: "Quota check failed" }, { status: 500 });
  }

  const q = data as QuotaResult;
  const planId = (q.plan_id as PlanId) || "starter";
  const plan = PLANS[planId];

  if (!q.allowed) {
    // Telemetry: warm upgrade leads. Service role write — RLS allows.
    await supabaseAdmin.from("quota_block_events").insert({
      user_id: user.id,
      plan_id: planId,
      reason: q.reason,
      source: "preflight",
      metadata: {
        period_used: q.period_used,
        lifetime_used: q.lifetime_used,
        company_shared: q.company_shared,
      },
    });

    return NextResponse.json(
      {
        allowed: false,
        reason: q.reason,
        planId,
        planName: plan.name,
        remaining: q.remaining,
        limit: q.limit,
        upgradeUrl: "/pricing",
      },
      { status: 402 }
    );
  }

  return NextResponse.json({
    allowed: true,
    planId,
    planName: plan.name,
    remaining: q.remaining,
    limit: q.limit,
    companyShared: q.company_shared,
  });
}
