import { NextRequest, NextResponse } from "next/server";
import { metaAdminGuard, handleMetaError } from "@/lib/api-meta-admin";
import { getMetaAdsClient } from "@/lib/meta-ads";

/**
 * POST /api/admin/meta/ads/{id}/url
 *
 * Update an ad's destination URL. Body: `{ url: string }`.
 *
 * Meta won't let us mutate the URL on an existing creative — the wrapper
 * builds a new creative with the new URL and reattaches it to the ad.
 *
 * This is the route Phase 5 uses to one-click reroute a Meta ad from the
 * generic homepage to a specific /lp/* landing page.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await metaAdminGuard();
  if (guard) return guard;

  const { id } = await ctx.params;
  let body: { url: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  try {
    new URL(body.url);
  } catch {
    return NextResponse.json({ error: "url must be a valid absolute URL" }, { status: 400 });
  }

  try {
    const client = getMetaAdsClient();
    const result = await client.ads.updateDestinationUrl(id, body.url);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleMetaError(err);
  }
}
