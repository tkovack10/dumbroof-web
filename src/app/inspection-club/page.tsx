import { createClient } from "@/lib/supabase/server";
import { InspectionClubContent } from "./inspection-club-content";

export default async function InspectionClubPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Query active inspector states for coverage map
  const { data: inspectors } = await supabase
    .from("inspector_applications")
    .select("state")
    .in("status", ["approved", "active", "pending"]);

  const dbStates = (inspectors || []).map((i) => i.state?.toUpperCase()).filter(Boolean);
  // Seed states where we have confirmed inspector interest
  const seedStates = ["TX", "FL", "PA", "NJ", "NY", "MD", "IL", "MI", "OH"];
  const activeStates = [...new Set([...dbStates, ...seedStates])];

  return <InspectionClubContent activeStates={activeStates} isLoggedIn={!!user} />;
}
