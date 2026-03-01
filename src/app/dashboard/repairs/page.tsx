import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RepairsDashboard } from "./repairs-dashboard";

export default async function RepairsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <RepairsDashboard user={user} />;
}
