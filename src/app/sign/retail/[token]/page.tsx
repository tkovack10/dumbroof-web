import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SignForm } from "./sign-form";

export const dynamic = "force-dynamic";

/**
 * Public sign page. Server-side fetches the estimate by sign_token using
 * the service-role client (bypasses RLS). The token IS the secret — no
 * auth required, no session needed. Customer just clicks the link.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const { data: est } = await supabaseAdmin
    .from("retail_estimates")
    .select(
      "id, customer_name, customer_email, customer_address, template_id, template_snapshot, base_amount, addons_amount, subtotal_amount, markup_pct, markup_amount, total_amount, signed_at, signed_by_name, addon_qtys, measurements",
    )
    .eq("sign_token", token)
    .maybeSingle();

  if (!est) notFound();

  // Pull contractor display name from company_profiles so the customer sees
  // who they're signing with, not a generic "Dumb Roof" brand.
  const { data: estOwner } = await supabaseAdmin
    .from("retail_estimates")
    .select("user_id")
    .eq("id", est.id)
    .maybeSingle();
  const { data: profile } = estOwner
    ? await supabaseAdmin
        .from("company_profiles")
        .select("company_name, phone")
        .eq("user_id", estOwner.user_id)
        .maybeSingle()
    : { data: null };

  return (
    <SignForm
      token={token}
      estimate={est as Parameters<typeof SignForm>[0]["estimate"]}
      companyName={profile?.company_name || "Your Roofer"}
      companyPhone={profile?.phone || null}
    />
  );
}
