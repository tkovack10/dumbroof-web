import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AnalyticsContent } from "./analytics-content";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .limit(1);

  if (profileRows?.[0]?.is_admin !== true) {
    redirect("/dashboard");
  }

  return <AnalyticsContent user={user} />;
}
