import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface ReferralLandingProps {
  params: Promise<{ code: string }>;
}

/**
 * Referral landing — `/r/{code}`.
 *
 * Validates the code and forwards to `/signup?ref={code}`. The signup page
 * itself handles cookie-setting + banner rendering — this page is just a
 * short vanity URL redirect.
 *
 * Invalid codes silently redirect to `/` (don't reveal whether a code is
 * valid — prevents enumeration).
 *
 * Note: cookie-setting happens in `/signup/page.tsx` (Server Component
 * rendering path), not here. Setting cookies in a Server Component page
 * that then calls `redirect()` is unreliable in Next.js 15 because the
 * NEXT_REDIRECT throw short-circuits the response before the Set-Cookie
 * header is attached.
 */
export default async function ReferralLandingPage({ params }: ReferralLandingProps) {
  const { code } = await params;
  const normalized = (code || "").trim().toUpperCase();

  if (!normalized) redirect("/");

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id")
    .eq("referral_code", normalized)
    .limit(1);

  const profile = profileRows?.[0];

  if (!profile) {
    redirect("/");
  }

  redirect(`/signup?ref=${encodeURIComponent(normalized)}`);
}
