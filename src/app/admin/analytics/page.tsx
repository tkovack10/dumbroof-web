import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LiveAnalyticsContent } from "./analytics-content";

export default async function PlatformAnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Platform admin check — admins table, NOT company_profiles.is_admin
  const { data: admin } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  if (!admin) redirect("/dashboard");

  return <LiveAnalyticsContent />;
}
