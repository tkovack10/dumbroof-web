import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  const [claimsRes, winsRes, usersRes, inspectorsRes] = await Promise.all([
    supabase.from("claims").select("id", { count: "exact", head: true }),
    supabase.from("claims").select("id", { count: "exact", head: true }).eq("status", "ready"),
    supabase.from("company_profiles").select("id", { count: "exact", head: true }),
    supabase.from("inspector_applications").select("id", { count: "exact", head: true }),
  ]);

  return (
    <MADashboardContent
      webClaims={claimsRes.count ?? 0}
      wins={winsRes.count ?? 0}
      saasUsers={usersRes.count ?? 0}
      inspectorApps={inspectorsRes.count ?? 0}
    />
  );
}
