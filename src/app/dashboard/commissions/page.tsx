import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CommissionsContent } from "./commissions-content";

/**
 * Rep-facing Commissions hub on the REGULAR dashboard (distinct from the
 * owner-only /dashboard/admin/commissions approve+pay view). Lets reps upload
 * their checks for 10% and submit signed AOBs for $100, and track their pay.
 */
export default async function RepCommissionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <CommissionsContent />;
}
