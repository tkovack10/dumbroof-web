import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

// GET: Generate Stripe Connect OAuth link for the current user
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = req.headers.get("origin") || "https://www.dumbroof.ai";

  // Create a Stripe Connect account link (Standard Connect)
  try {
    // Check if user already has a connected account (use .limit(1), NOT .single() — E099)
    const { data: profileRows } = await supabaseAdmin
      .from("company_profiles")
      .select("stripe_connect_account_id")
      .eq("user_id", user.id)
      .limit(1);
    const profile = profileRows?.[0] || null;

    let accountId = profile?.stripe_connect_account_id;

    if (!accountId) {
      // Create a new Standard Connect account
      const account = await getStripe().accounts.create({
        type: "standard",
        email: user.email,
        metadata: { user_id: user.id },
      });
      accountId = account.id;

      // Save to company_profiles (upsert in case profile doesn't exist yet)
      await supabaseAdmin.from("company_profiles").upsert(
        {
          user_id: user.id,
          stripe_connect_account_id: accountId,
          stripe_connect_status: "pending",
        },
        { onConflict: "user_id" }
      );
    }

    // Generate the account link for onboarding/OAuth
    const accountLink = await getStripe().accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/dashboard/settings?stripe_connect=refresh`,
      return_url: `${origin}/dashboard/settings?stripe_connect=success`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create Connect link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Check connect account status / disconnect
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action } = await req.json();

  if (action === "status") {
    // Check the status of the connected account
    const { data: profileRows2 } = await supabaseAdmin
      .from("company_profiles")
      .select("stripe_connect_account_id, stripe_connect_status")
      .eq("user_id", user.id)
      .limit(1);
    const profile2 = profileRows2?.[0] || null;

    if (!profile2?.stripe_connect_account_id) {
      return NextResponse.json({ connected: false, status: "disconnected" });
    }

    try {
      const account = await getStripe().accounts.retrieve(profile2.stripe_connect_account_id);
      const isReady = account.charges_enabled && account.payouts_enabled;
      const status = isReady ? "active" : "pending";

      // Update status in DB if changed
      if (status !== profile2.stripe_connect_status) {
        await supabaseAdmin
          .from("company_profiles")
          .update({ stripe_connect_status: status })
          .eq("user_id", user.id);
      }

      return NextResponse.json({
        connected: true,
        status,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        businessName: account.business_profile?.name || account.email,
      });
    } catch {
      return NextResponse.json({ connected: false, status: "error" });
    }
  }

  if (action === "disconnect") {
    await supabaseAdmin
      .from("company_profiles")
      .update({
        stripe_connect_account_id: null,
        stripe_connect_status: "disconnected",
      })
      .eq("user_id", user.id);

    return NextResponse.json({ disconnected: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
