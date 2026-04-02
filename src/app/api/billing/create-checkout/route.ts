import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PLANS, ADD_ONS, type PlanId } from "@/lib/stripe-config";
import { supabaseAdmin } from "@/lib/supabase/admin";

const STRIPE_API = "https://api.stripe.com/v1";

/** Direct fetch to Stripe API — bypasses SDK connection issues on Vercel */
async function stripePost(path: string, body: Record<string, string>) {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
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

/** Get or create Stripe customer for user */
async function getOrCreateCustomer(userId: string, email: string): Promise<string> {
  const { data: subRows } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .limit(1);

  let customerId = subRows?.[0]?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripePost("/customers", {
      email,
      "metadata[user_id]": userId,
    });
    customerId = customer.id;

    await supabaseAdmin.from("subscriptions").upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        plan_id: "starter",
        status: "active",
      },
      { onConflict: "user_id" }
    );
  }

  return customerId!;
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
    const body = await req.json();
    const { planId, addOnId, coupon } = body as {
      planId?: PlanId;
      addOnId?: string;
      coupon?: string;
    };

    const origin = req.headers.get("origin") || "https://www.dumbroof.ai";
    const customerId = await getOrCreateCustomer(user.id, user.email || "");

    // ---- One-time add-on purchase ----
    if (addOnId) {
      const addOn = ADD_ONS.find((a) => a.id === addOnId);
      if (!addOn) {
        return NextResponse.json({ error: "Invalid add-on" }, { status: 400 });
      }

      const params: Record<string, string> = {
        customer: customerId,
        mode: "payment",
        "line_items[0][price]": addOn.stripePriceId,
        "line_items[0][quantity]": "1",
        success_url: `${origin}/dashboard?purchase=inspection`,
        cancel_url: `${origin}/pricing`,
        "metadata[user_id]": user.id,
        "metadata[add_on_id]": addOn.id,
      };

      if (coupon) {
        params["discounts[0][coupon]"] = coupon;
      }

      const session = await stripePost("/checkout/sessions", params);
      return NextResponse.json({ url: session.url });
    }

    // ---- Subscription plan purchase ----
    if (!planId) {
      return NextResponse.json({ error: "planId or addOnId required" }, { status: 400 });
    }

    const plan = PLANS[planId];
    if (!plan || !plan.stripePriceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const params: Record<string, string> = {
      customer: customerId,
      mode: "subscription",
      "line_items[0][price]": plan.stripePriceId!,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/dashboard/settings?billing=success`,
      cancel_url: `${origin}/pricing`,
      "metadata[user_id]": user.id,
    };

    if (planId === "sales_rep") {
      const meteredPriceId = process.env.STRIPE_SALES_REP_METERED_PRICE_ID;
      if (meteredPriceId) {
        params["line_items[1][price]"] = meteredPriceId;
      }
    }

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
