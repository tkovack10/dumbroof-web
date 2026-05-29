import { PathsMonitor } from "./paths-monitor";

export const metadata = { title: "Live Funnel — DumbRoof" };

// /admin/paths — live funnel monitor (GA4 visitor paths + DB activation funnel).
// Admin access is enforced by the /api/admin/paths route (403 for non-admins),
// which the client renders gracefully.
export default function PathsPage() {
  return <PathsMonitor />;
}
