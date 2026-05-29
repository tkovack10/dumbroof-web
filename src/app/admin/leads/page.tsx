import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { LeadsClient } from "./leads-client";

export const dynamic = "force-dynamic";

export default async function AdminLeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .single();
  if (!me?.is_admin) redirect("/dashboard");

  return <LeadsClient />;
}
