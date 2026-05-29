import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingChat } from "@/components/onboarding-chat";

export const metadata = {
  title: "Welcome — build your first claim with Richard",
};

// /welcome — the post-signup landing for brand-new users. Richard creates their
// first claim conversationally (activation is the bottleneck — 86% of signups
// never make a claim today). Deliberately OUTSIDE the /dashboard profile-gate
// middleware so a new user can act before completing their company profile;
// the backend renders an anonymous report and prompts for the logo afterward.
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signup?next=/welcome");
  }

  // Best-effort first name for a warm greeting — never blocks the page.
  let firstName: string | undefined;
  try {
    const { data: profile } = await supabase
      .from("company_profiles")
      .select("contact_name")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const contact = (profile?.contact_name || "").trim();
    if (contact) firstName = contact.split(/\s+/)[0];
  } catch {
    /* no profile yet — that's the whole point of onboarding */
  }
  if (!firstName) {
    const metaName = (user.user_metadata?.full_name || user.user_metadata?.name || "").toString().trim();
    if (metaName) firstName = metaName.split(/\s+/)[0];
  }

  return <OnboardingChat userId={user.id} firstName={firstName} />;
}
