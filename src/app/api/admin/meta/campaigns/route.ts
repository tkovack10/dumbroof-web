import { NextResponse } from "next/server";
import { metaAdminGuard, handleMetaError } from "@/lib/api-meta-admin";
import { getMetaAdsClient } from "@/lib/meta-ads";
import type { DatePreset } from "@/lib/meta-ads";

/**
 * GET /api/admin/meta/campaigns?datePreset=last_7d
 *
 * Lists all campaigns in the dumbroof.ai ad account with insights merged in
 * (spend, clicks, conversions, CPA) for the requested date preset. Powers
 * the /admin/meta-ads dashboard table.
 */
export async function GET(req: Request) {
  const guard = await metaAdminGuard();
  if (guard) return guard;

  const url = new URL(req.url);
  const datePreset = (url.searchParams.get("datePreset") || "last_7d") as DatePreset;

  try {
    const client = getMetaAdsClient();
    const [campaigns, insights] = await Promise.all([
      client.campaigns.list(),
      client.insights.get({ level: "campaign", datePreset }),
    ]);

    // Merge insights into the campaign list by campaign_id
    const insightsByCampaign = new Map<string, (typeof insights)[number]>();
    for (const i of insights) {
      if (i.campaign_id) insightsByCampaign.set(i.campaign_id, i);
    }

    const enriched = campaigns.map((c) => {
      const ins = insightsByCampaign.get(c.id);
      const spendDollars = ins ? Number(ins.spend || 0) : 0;
      const conversions =
        ins?.actions
          ?.filter((a) =>
            [
              "complete_registration",
              "lead",
              "offsite_conversion.fb_pixel_complete_registration",
              "offsite_conversion.fb_pixel_lead",
            ].includes(a.action_type)
          )
          .reduce((s, a) => s + Number(a.value || 0), 0) ?? 0;

      return {
        id: c.id,
        name: c.name,
        objective: c.objective,
        status: c.status,
        effective_status: c.effective_status,
        daily_budget_cents: c.daily_budget ? Number(c.daily_budget) : null,
        spend_cents: Math.round(spendDollars * 100),
        impressions: ins ? Number(ins.impressions || 0) : 0,
        clicks: ins ? Number(ins.clicks || 0) : 0,
        ctr: ins?.ctr ? Number(ins.ctr) : 0,
        cpc_cents: ins?.cpc ? Math.round(Number(ins.cpc) * 100) : 0,
        cpm_cents: ins?.cpm ? Math.round(Number(ins.cpm) * 100) : 0,
        conversions,
        cost_per_conversion_cents:
          conversions > 0 ? Math.round((spendDollars * 100) / conversions) : null,
      };
    });

    return NextResponse.json({ datePreset, campaigns: enriched });
  } catch (err) {
    return handleMetaError(err);
  }
}
