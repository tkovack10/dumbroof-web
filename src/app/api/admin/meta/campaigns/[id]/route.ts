import { NextRequest, NextResponse } from "next/server";
import { metaAdminGuard, handleMetaError } from "@/lib/api-meta-admin";
import { getMetaAdsClient } from "@/lib/meta-ads";
import type { CampaignStatus } from "@/lib/meta-ads";

/**
 * POST /api/admin/meta/campaigns/{id}
 *
 * Update a single campaign — pause, resume, archive, rename, or set daily
 * budget. Body shape: `{ status?, name?, daily_budget_cents? }`. Each field
 * is optional; pass only what you want to change. Returns Meta's success ack.
 *
 * Powers the one-click pause/resume/budget buttons in /admin/meta-ads.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await metaAdminGuard();
  if (guard) return guard;

  const { id } = await ctx.params;
  let body: { status?: CampaignStatus; name?: string; daily_budget_cents?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const client = getMetaAdsClient();
    const result = await client.campaigns.update(id, body);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return handleMetaError(err);
  }
}
