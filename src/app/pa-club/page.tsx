import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/seo/site";
import { PAClubContent } from "./pa-club-content";

export const metadata: Metadata = {
  title: "PA Club — DumbRoof",
  description:
    "DumbRoof's network of public adjusters. See where PAs cover claims and join the club to handle storm damage supplements.",
  alternates: { canonical: absoluteUrl("/pa-club") },
};

export default async function PAClubPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Query active PA states for coverage map
  const { data: pas } = await supabase
    .from("pa_applications")
    .select("states_covered")
    .in("status", ["approved", "active", "pending"]);

  const activeStates = [...new Set(
    (pas || [])
      .flatMap((p) => p.states_covered || [])
      .map((s: string) => s.toUpperCase())
      .filter(Boolean)
  )];

  return <PAClubContent activeStates={activeStates} isLoggedIn={!!user} />;
}
