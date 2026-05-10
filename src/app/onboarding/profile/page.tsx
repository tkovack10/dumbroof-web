import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingProfileClient } from "./onboarding-client";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    next?: string;
  }>;
}

// Required-profile gate. Any authenticated user without a populated
// company_profiles row gets bounced here from middleware. They can't escape
// to the dashboard or any claim flow until company name + contact name +
// phone + logo are filled. The middleware redirect carries the original
// `next` path forward so we land them where they were going (e.g.
// /instant/continue → claim creation kicks off post-profile).
//
// Why this flow instead of a signup-page form: the funnel UX choice
// (Tom-confirmed 2026-05-10) is files-first. Sunk cost on uploading carries
// the user through the profile prompt; gating at signup loses people who
// see "logo upload required" before they've invested anything.
export default async function OnboardingProfilePage({ searchParams }: PageProps) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/dashboard";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/onboarding/profile?next=${safeNext}`)}`);
  }

  return (
    <OnboardingProfileClient
      userId={user.id}
      userEmail={user.email || ""}
      next={safeNext}
    />
  );
}
