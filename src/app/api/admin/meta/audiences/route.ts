import { NextRequest, NextResponse } from "next/server";
import { metaAdminGuard, handleMetaError } from "@/lib/api-meta-admin";
import { getMetaAdsClient } from "@/lib/meta-ads";

/**
 * GET  /api/admin/meta/audiences          — list all custom audiences
 * POST /api/admin/meta/audiences          — create custom audience from emails
 *                                            OR a lookalike from existing source
 *
 * POST body shapes:
 *   { kind: "custom", name, description?, emails: string[] }
 *   { kind: "lookalike", name, sourceAudienceId, country, ratio? }
 *
 * Used by:
 *   - The /admin/meta-ads dashboard "Sync winners" + "Build lookalike" buttons
 *   - The autopilot rules engine (Phase 6.7) for weekly lookalike refresh
 *   - The Claude /meta agent for natural-language audience operations
 */

export async function GET() {
  const guard = await metaAdminGuard();
  if (guard) return guard;
  try {
    const client = getMetaAdsClient();
    const audiences = await client.audiences.list();
    return NextResponse.json({ audiences });
  } catch (err) {
    return handleMetaError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = await metaAdminGuard();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind;

  try {
    const client = getMetaAdsClient();

    if (kind === "custom") {
      const name = body.name as string;
      const emails = body.emails as string[];
      if (!name || !Array.isArray(emails) || emails.length === 0) {
        return NextResponse.json(
          { error: "name and emails[] are required for kind=custom" },
          { status: 400 }
        );
      }
      const audience = await client.audiences.createFromEmails({
        name,
        description: typeof body.description === "string" ? body.description : undefined,
        emails,
      });
      return NextResponse.json({ ok: true, audience });
    }

    if (kind === "lookalike") {
      const name = body.name as string;
      const sourceAudienceId = body.sourceAudienceId as string;
      const country = body.country as string;
      const ratio = typeof body.ratio === "number" ? body.ratio : undefined;
      if (!name || !sourceAudienceId || !country) {
        return NextResponse.json(
          { error: "name, sourceAudienceId, and country are required for kind=lookalike" },
          { status: 400 }
        );
      }
      const audience = await client.audiences.createLookalike({
        name,
        sourceAudienceId,
        country,
        ratio,
      });
      return NextResponse.json({ ok: true, audience });
    }

    return NextResponse.json(
      { error: "kind must be 'custom' or 'lookalike'" },
      { status: 400 }
    );
  } catch (err) {
    return handleMetaError(err);
  }
}
