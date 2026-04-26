import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only owners/admins can manage billing — protects against a rogue rep
  // cancelling the team's plan.
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("role, is_admin")
    .eq("user_id", user.id)
    .limit(1);
  const profile = profileRows?.[0];
  const role = profile?.role || (profile?.is_admin ? "owner" : "member");
  if (!["owner", "admin"].includes(role)) {
    return NextResponse.json(
      { error: "Only company owners and admins can manage billing." },
      { status: 403 }
    );
  }

  // Resolve the effective subscription — picks up team-pooled plans where
  // only the owner has the stripe_customer_id row.
  const { data: sub, error: subErr } = await supabaseAdmin.rpc(
    "resolve_user_subscription",
    { p_user_id: user.id }
  );

  if (subErr) {
    console.error("[create-portal] resolve_user_subscription failed", subErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  const customerId = sub?.stripe_customer_id;
  if (!customerId || customerId.startsWith("pending_")) {
    return NextResponse.json(
      { error: "No billing account found" },
      { status: 404 }
    );
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: "https://www.dumbroof.ai/dashboard/settings",
  });

  return NextResponse.json({ url: session.url });
}
