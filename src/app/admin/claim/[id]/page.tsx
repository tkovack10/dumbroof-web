import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminClaimDetail } from "./admin-claim-detail";

export default async function AdminClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Check if user is admin
  const { data: admin } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  if (!admin) redirect("/dashboard");

  // Fetch claim without user_id filter (admin can see all)
  const { data: claim } = await supabase
    .from("claims")
    .select("*")
    .eq("id", id)
    .single();

  if (!claim) redirect("/admin");

  // Fetch user info for display
  const { data: profile } = await supabase
    .from("company_profiles")
    .select("company_name, email")
    .eq("user_id", claim.user_id)
    .single();

  return (
    <AdminClaimDetail
      claim={claim}
      userInfo={profile ?? undefined}
    />
  );
}
