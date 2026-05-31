import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/seo/site";
import { InspectionClubContent } from "./inspection-club-content";

export const metadata: Metadata = {
  title: "Inspection Club — DumbRoof",
  description:
    "DumbRoof's network of roof inspectors. See where inspectors are active and join the club to document storm damage claims.",
  alternates: { canonical: absoluteUrl("/inspection-club") },
};

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
