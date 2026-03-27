import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AdminSidebar } from "./admin-sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Verify user has is_admin=true on company_profiles
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .limit(1);

  const isAdmin = profileRows?.[0]?.is_admin === true;

  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex">
      <AdminSidebar userEmail={user.email || ""} />
      <main className="flex-1 lg:ml-[240px] min-h-screen">{children}</main>
    </div>
  );
}
