import type { RailwaySection } from "../types";

/**
 * Funnel Monitor — Railway backend health check.
 * Pings the existing /health endpoint on dumbroof-backend-production.up.railway.app.
 * Memory says this endpoint returns CPU/RAM/disk via psutil.
 */
export async function gatherRailwayHealth(): Promise<RailwaySection | null> {
  const healthUrl = "https://dumbroof-backend-production.up.railway.app/health";

  try {
    const res = await fetch(healthUrl, {
      cache: "no-store",
      // Quick timeout — if Railway is down we want to know fast, not hang the cron
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { status: "degraded" };
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      status: "ok",
      cpu_percent: typeof json.cpu_percent === "number" ? json.cpu_percent : undefined,
      ram_mb: typeof json.ram_mb === "number" ? json.ram_mb : undefined,
      process_memory_mb:
        typeof json.process_memory_mb === "number" ? json.process_memory_mb : undefined,
    };
  } catch {
    return { status: "down" };
  }
}
