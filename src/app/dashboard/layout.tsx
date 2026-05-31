import type { ReactNode } from "react";

/**
 * Authenticated /dashboard/* layout — pass-through.
 *
 * ROLLED BACK (Tom, 2026-05-31): the "Richard everywhere" GlobalRichard launcher
 * mounted here rendered a broken/transparent panel overlapping the dashboard on
 * desktop ("richard chat screen impossible to see"). The dashboard's own Richard
 * FAB is restored in dashboard-content, and the per-claim "Ask Richard" stays;
 * #113's session-auth (stale-token 401) fix is kept untouched.
 */
export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
