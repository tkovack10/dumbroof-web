import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { RecommendationsQueue } from "./recommendations-queue";

export const dynamic = "force-dynamic";

export default async function AgentRecommendationsPage() {
  const userSb = await createClient();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) redirect("/login");

  const { data: admin } = await userSb
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!admin || admin.length === 0) redirect("/dashboard");

  const { data: recs } = await supabaseAdmin
    .from("agent_recommendations")
    .select("*")
    .in("status", ["pending", "deferred"])
    .order("created_at", { ascending: false })
    .limit(100);

  return <RecommendationsQueue initialRecs={recs || []} />;
}
