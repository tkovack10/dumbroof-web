import { NextResponse } from "next/server";
import { SAMPLE_SCOPE_COMPARISON } from "@/lib/sample-claim-data";

/**
 * GET /api/sample/scope-comparison
 *
 * Public, unauthenticated. Serves the hardcoded 14-square hail claim
 * data for the demo dashboard at /sample/dashboard. The real auth'd
 * route is at /api/scope-comparison — this one exists so the sample
 * dashboard can work without a login.
 *
 * Anchor: ~/.claude/plans/snazzy-jingling-petal.md Phase 6 + Tom's
 * "CAN WE DO A SAMPLE DASHBOARD" directive 2026-04-06.
 */
export async function GET() {
  return NextResponse.json(SAMPLE_SCOPE_COMPARISON, {
    headers: {
      // Cache for 1 hour — the data is static, no point hitting the route every time
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
