import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SignClient } from "./sign-client";

/**
 * Public signing page. No auth — the URL-embedded sign_token is the
 * only credential. Customer reviews the estimate (rendered via the
 * same template_snapshot the contractor saved) and signs by typing
 * their name + checking the consent box.
 */
export default async function SignEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: est } = await supabaseAdmin
    .from("retail_estimates")
    .select("*")
    .eq("sign_token", token)
    .maybeSingle();
  if (!est) notFound();

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select(
      "company_name, contact_name, phone, email, address, city_state_zip, website, logo_path",
    )
    .eq("user_id", est.user_id)
    .maybeSingle();

  let logoUrl: string | null = null;
  if (profile?.logo_path) {
    const { data } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUrl(profile.logo_path as string, 60 * 60);
    logoUrl = data?.signedUrl || null;
  }

  return <SignClient token={token} estimate={est} profile={profile || {}} logoUrl={logoUrl} />;
}
