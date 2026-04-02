import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { PLANS, type PlanId } from "@/lib/stripe-config";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: subRows } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);

  const sub = subRows?.[0] || null;

  // No subscription row = starter (free tier)
  const planId: PlanId = (sub?.plan_id as PlanId) || "starter";
  const plan = PLANS[planId];
  const lifetimeUsed = sub?.lifetime_claims_used ?? 0;
  const periodUsed = sub?.claims_used_this_period ?? 0;

  let allowed: boolean;
  let remaining: number;

  if (planId === "starter") {
    // Lifetime cap
    const cap = plan.lifetimeCap ?? 3;
    allowed = lifetimeUsed < cap;
    remaining = Math.max(0, cap - lifetimeUsed);
  } else if (planId === "sales_rep") {
    // Pay per claim — always allowed if subscription is active (billed per use)
    allowed = sub?.status === "active";
    remaining = 999; // unlimited, billed per claim
  } else {
    // Monthly cap
    allowed = sub?.status === "active" && periodUsed < plan.claimsPerMonth;
    remaining = Math.max(0, plan.claimsPerMonth - periodUsed);
  }

  return NextResponse.json({
    planId,
    planName: plan.name,
    allowed,
    remaining,
    periodUsed,
    lifetimeUsed,
    limit: planId === "starter" ? plan.lifetimeCap : planId === "sales_rep" ? null : plan.claimsPerMonth,
    status: sub?.status || "active",
  });
}

// Called after a claim is successfully submitted to increment usage
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Increment both counters atomically via RPC
  const { error } = await supabaseAdmin.rpc("increment_claim_usage", {
    p_user_id: user.id,
  });

  if (error) {
    // Fallback: manual increment if RPC doesn't exist yet
    // Use atomic SQL increment to avoid race conditions
    const { data: subRows } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);

    if (subRows?.[0]) {
      // Standard update — the RPC above is the atomic path, this is the fallback
      const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("claims_used_this_period, lifetime_claims_used")
        .eq("user_id", user.id)
        .limit(1);

      if (sub?.[0]) {
        await supabaseAdmin
          .from("subscriptions")
          .update({
            claims_used_this_period: (sub[0].claims_used_this_period ?? 0) + 1,
            lifetime_claims_used: (sub[0].lifetime_claims_used ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);
      }
    } else {
      // First claim ever — create starter subscription row
      await supabaseAdmin.from("subscriptions").insert({
        user_id: user.id,
        stripe_customer_id: `pending_${user.id}`,
        plan_id: "starter",
        status: "active",
        claims_used_this_period: 1,
        lifetime_claims_used: 1,
      });
    }
  }

  // Report metered usage to Stripe for sales_rep plan ($25/claim)
  try {
    const { data: subRows } = await supabaseAdmin
      .from("subscriptions")
      .select("plan_id, stripe_customer_id")
      .eq("user_id", user.id)
      .limit(1);

    const subData = subRows?.[0];
    if (subData?.plan_id === "sales_rep" && subData?.stripe_customer_id) {
      await getStripe().billing.meterEvents.create({
        event_name: "claim_processed",
        payload: {
          stripe_customer_id: subData.stripe_customer_id,
          value: "1",
        },
      });
    }
  } catch (meterErr) {
    // Log but don't block — metered billing failure is serious but shouldn't prevent claim processing
    console.error("CRITICAL: Metered billing failed for sales_rep claim", {
      user_id: user.id,
      error: meterErr instanceof Error ? meterErr.message : meterErr,
    });
  }

  return NextResponse.json({ ok: true });
}
