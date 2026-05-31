import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { GlobalRichard } from "@/components/global-richard";

/**
 * Authenticated app layout. Wraps every /dashboard/* route (claim detail,
 * settings, new-claim, quick-report, the nested /dashboard/admin tree, …) and
 * mounts the floating Richard launcher so Richard is reachable from ANY page,
 * not just the dashboard home. Resolving the user server-side avoids a
 * client-side auth flash before the FAB appears.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      {children}
      {user && <GlobalRichard userId={user.id} />}
    </>
  );
}
