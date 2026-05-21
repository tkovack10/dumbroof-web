import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PrintView } from "./print-view";

export default async function RetailEstimatePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [estimateRes, profileRes] = await Promise.all([
    supabaseAdmin
      .from("retail_estimates")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabaseAdmin
      .from("company_profiles")
      .select(
        "company_name, contact_name, phone, email, address, city_state_zip, website, logo_path",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (estimateRes.error || !estimateRes.data) {
    return (
      <div className="p-8 text-sm">
        Estimate not found. <a href="/dashboard/retail-estimate" className="underline">Back to estimator</a>
      </div>
    );
  }

  let logoUrl: string | null = null;
  const logoPath = profileRes.data?.logo_path as string | undefined;
  if (logoPath) {
    const { data } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUrl(logoPath, 60 * 60);
    logoUrl = data?.signedUrl || null;
  }

  return (
    <PrintView
      estimate={estimateRes.data}
      profile={profileRes.data || {}}
      logoUrl={logoUrl}
    />
  );
}
