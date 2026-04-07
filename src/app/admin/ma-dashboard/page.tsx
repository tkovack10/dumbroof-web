import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MADashboardContent } from "./ma-dashboard-content";

export default async function MADashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Check if user is admin
  const { data: admin } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  if (!admin) redirect("/dashboard");

  // Fetch dynamic metrics in parallel.
  // Use count_platform_users() RPC for auth.users count — supabase.auth.admin.listUsers
  // returns 500s on this project, so we route through a SECURITY DEFINER function instead.
  const [claimsRes, winsRes, inspectorsRes, userCountRes] = await Promise.all([
    supabase.from("claims").select("id", { count: "exact", head: true }),
    supabase.from("claims").select("id", { count: "exact", head: true }).eq("claim_outcome", "won"),
    supabase.from("inspector_applications").select("id", { count: "exact", head: true }),
    supabaseAdmin.rpc("count_platform_users"),
  ]);

  const totalUsers = Number(userCountRes.data ?? 0);

  return (
    <MADashboardContent
      webClaims={claimsRes.count ?? 0}
      wins={winsRes.count ?? 0}
      saasUsers={totalUsers}
      inspectorApps={inspectorsRes.count ?? 0}
    />
  );
}
