import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/stripe-config";
import { supabaseAdmin } from "@/lib/supabase/admin";

const STRIPE_API = "https://api.stripe.com/v1";

/** Direct fetch to Stripe API — bypasses SDK connection issues on Vercel */
async function stripePost(path: string, body: Record<string, string>) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Stripe API error: ${res.status}`);
  }
  return data;
}

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

    // Check if user already has a Stripe customer ID
    const { data: subRows } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .limit(1);

    let customerId = subRows?.[0]?.stripe_customer_id;

    if (!customerId) {
      // Create customer via direct API
      const customer = await stripePost("/customers", {
        email: user.email || "",
        "metadata[user_id]": user.id,
      });
      customerId = customer.id;

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

    // Build checkout session params
    const params: Record<string, string> = {
      customer: customerId!,
      mode: "subscription",
      "line_items[0][price]": plan.stripePriceId!,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/dashboard/settings?billing=success`,
      cancel_url: `${origin}/pricing`,
      "metadata[user_id]": user.id,
    };

    // Sales rep: add metered price as second line item
    if (planId === "sales_rep") {
      const meteredPriceId = process.env.STRIPE_SALES_REP_METERED_PRICE_ID;
      if (meteredPriceId) {
        params["line_items[1][price]"] = meteredPriceId;
      }
    }

    // Add coupon if provided
    if (coupon) {
      params["discounts[0][coupon]"] = coupon;
    }

    const session = await stripePost("/checkout/sessions", params);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    console.error("Stripe checkout error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
