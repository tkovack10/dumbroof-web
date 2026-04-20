import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface ReferralLandingProps {
  params: Promise<{ code: string }>;
}

/**
 * Referral landing — `/r/{code}`.
 * - Validates the code exists on some company_profile.
 * - Drops a cookie (`dr_ref`) so the signup flow can attach the referrer.
 * - Redirects to /signup.
 * - Invalid codes just redirect to / (don't reveal whether a code is valid).
 */
export default async function ReferralLandingPage({ params }: ReferralLandingProps) {
  const { code } = await params;
  const normalized = (code || "").trim().toUpperCase();

  if (!normalized) redirect("/");

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id, referral_code, company_name")
    .eq("referral_code", normalized)
    .limit(1);

  const profile = profileRows?.[0];

  if (!profile) {
    // Unknown code — just send them to the homepage
    redirect("/");
  }

  // Stash referral in a cookie so auth/callback can credit the referrer.
  // 24h is long enough for email-confirm + OAuth flows but short enough to
  // limit cross-user contamination on shared browsers (the main risk vector).
  const cookieStore = await cookies();
  cookieStore.set("dr_ref", normalized, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24,
    path: "/",
  });

  redirect(`/signup?ref=${encodeURIComponent(normalized)}`);
}
