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

  // Fetch dynamic metrics in parallel
  // Use admin client for auth.users count (RLS blocks direct user table access)
  const [claimsRes, winsRes, inspectorsRes, authUsersRes] = await Promise.all([
    supabase.from("claims").select("id", { count: "exact", head: true }),
    supabase.from("claims").select("id", { count: "exact", head: true }).eq("claim_outcome", "won"),
    supabase.from("inspector_applications").select("id", { count: "exact", head: true }),
    supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const totalUsers = authUsersRes.data?.users?.length ?? 0;

  return (
    <MADashboardContent
      webClaims={claimsRes.count ?? 0}
      wins={winsRes.count ?? 0}
      saasUsers={totalUsers}
      inspectorApps={inspectorsRes.count ?? 0}
    />
  );
}
