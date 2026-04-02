import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { PLANS, type PlanId } from "@/lib/stripe-config";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { planId, coupon } = (await req.json()) as { planId: PlanId; coupon?: string };
    const plan = PLANS[planId];
    if (!plan || !plan.stripePriceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const stripe = getStripe();

    // Check if user already has a Stripe customer ID (use .limit(1), NOT .single() — E099)
    const { data: subRows } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .limit(1);

    let customerId = subRows?.[0]?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;

      // Ensure subscription row exists
      await supabaseAdmin.from("subscriptions").upsert(
        {
          user_id: user.id,
          stripe_customer_id: customerId,
          plan_id: "starter",
          status: "active",
        },
        { onConflict: "user_id" }
      );
    }

    const origin = req.headers.get("origin") || "https://www.dumbroof.ai";

    // Build line items — sales_rep includes both base price + metered per-claim price
    const lineItems: Array<{ price: string; quantity?: number }> = [
      { price: plan.stripePriceId!, quantity: 1 },
    ];
    if (planId === "sales_rep") {
      const meteredPriceId = process.env.STRIPE_SALES_REP_METERED_PRICE_ID;
      if (meteredPriceId) {
        lineItems.push({ price: meteredPriceId });
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: lineItems,
      ...(coupon ? { discounts: [{ coupon }] } : {}),
      success_url: `${origin}/dashboard/settings?billing=success`,
      cancel_url: `${origin}/pricing`,
      metadata: { user_id: user.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    console.error("Stripe checkout error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
