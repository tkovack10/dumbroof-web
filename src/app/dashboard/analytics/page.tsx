import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AnalyticsContent } from "./analytics-content";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <AnalyticsContent user={user} />;
}
