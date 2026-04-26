import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PLANS, type PlanId } from "@/lib/stripe-config";

/**
 * Syncs the Stripe subscription's extra_seat quantity to match the actual
 * number of team members. Called whenever team membership changes (accept,
 * remove). Returns the new extra-seat quantity, or null if no sync was needed.
 *
 * The helper is defensive: a missing price ID, a non-paid plan, or an absent
 * subscription all result in a silent skip — never breaks the calling flow.
 *
 * Designed to be idempotent: safe to call repeatedly with the same team size.
 */
export async function syncTeamSeats(companyId: string): Promise<{
  synced: boolean;
  extraSeats: number;
  reason?: string;
}> {
  const extraSeatPriceId = (
    process.env.STRIPE_EXTRA_SEAT_PRICE_ID || ""
  ).trim();
  if (!extraSeatPriceId) {
    console.warn("[sync-team-seats] STRIPE_EXTRA_SEAT_PRICE_ID not configured — skipping");
    return { synced: false, extraSeats: 0, reason: "no_price_id" };
  }

  // Count active team members for this company
  const { count, error: countErr } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if (countErr || count === null) {
    console.error("[sync-team-seats] member count failed", countErr);
    return { synced: false, extraSeats: 0, reason: "count_failed" };
  }

  // Find the company's subscription. Pull a non-starter row owned by any
  // member of this company.
  const { data: subRows } = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, plan_id, stripe_subscription_id, company_id")
    .or(`company_id.eq.${companyId},user_id.in.(${await listCompanyUserIds(companyId)})`)
    .neq("plan_id", "starter")
    .eq("status", "active")
    .limit(1);

  const sub = subRows?.[0];
  if (!sub?.stripe_subscription_id) {
    return { synced: false, extraSeats: 0, reason: "no_paid_subscription" };
  }

  const plan = PLANS[sub.plan_id as PlanId];
  if (!plan?.includedUsers || !plan.extraUserPrice) {
    return { synced: false, extraSeats: 0, reason: "plan_has_no_seat_concept" };
  }

  const extraSeats = Math.max(0, count - plan.includedUsers);

  // Inspect Stripe subscription items to find the existing extra_seat line
  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  const existingItem = stripeSub.items.data.find(
    (item: { price: { id: string } }) => item.price.id === extraSeatPriceId
  );

  if (extraSeats === 0 && existingItem) {
    // Remove the extra-seat item entirely (back to base plan)
    await stripe.subscriptionItems.del(existingItem.id, {
      proration_behavior: "create_prorations",
    });
    return { synced: true, extraSeats: 0 };
  }

  if (extraSeats === 0) {
    return { synced: false, extraSeats: 0, reason: "no_extras_needed" };
  }

  if (existingItem) {
    if (existingItem.quantity === extraSeats) {
      return { synced: false, extraSeats, reason: "already_in_sync" };
    }
    await stripe.subscriptionItems.update(existingItem.id, {
      quantity: extraSeats,
      proration_behavior: "create_prorations",
    });
    return { synced: true, extraSeats };
  }

  // No existing extra-seat item — create one
  await stripe.subscriptionItems.create({
    subscription: sub.stripe_subscription_id,
    price: extraSeatPriceId,
    quantity: extraSeats,
    proration_behavior: "create_prorations",
  });
  return { synced: true, extraSeats };
}

async function listCompanyUserIds(companyId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id")
    .eq("company_id", companyId);
  const ids = (data || []).map((r) => r.user_id).filter(Boolean);
  return ids.length > 0 ? ids.join(",") : "00000000-0000-0000-0000-000000000000";
}
