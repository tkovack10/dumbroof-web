import { NextResponse } from "next/server";
import { metaAdminGuard, handleMetaError } from "@/lib/api-meta-admin";
import { getMetaAdsClient } from "@/lib/meta-ads";
import type { DatePreset } from "@/lib/meta-ads";

/**
 * GET /api/admin/meta/insights?datePreset=last_7d&level=campaign
 *
 * Returns aggregated insights for the entire ad account at the requested
 * level (account/campaign/adset/ad). Used by the dashboard's headline
 * spend / conversions widget and the funnel monitor's manual-trigger UI.
 */
export async function GET(req: Request) {
  const guard = await metaAdminGuard();
  if (guard) return guard;

  const url = new URL(req.url);
  const datePreset = (url.searchParams.get("datePreset") || "last_7d") as DatePreset;

  try {
    const client = getMetaAdsClient();
    const summary = await client.insights.summary(datePreset);
    return NextResponse.json({ datePreset, summary });
  } catch (err) {
    return handleMetaError(err);
  }
}
