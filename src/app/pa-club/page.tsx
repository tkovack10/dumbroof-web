import { createClient } from "@/lib/supabase/server";
import { PAClubContent } from "./pa-club-content";

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
