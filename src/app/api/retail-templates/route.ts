import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import type { RetailTemplate } from "@/lib/retail/templates-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/retail-templates
 *
 * Returns the full set of retail estimate templates. Templates live as JSON
 * files in backend/pricing/retail_templates/ — adding a new template is
 * file-system only (no DB change, no deploy beyond Vercel's build).
 *
 * Auth: any logged-in user can read templates. Pricing is contractor-side
 * data, not customer PII, so platform-admin gate isn't needed.
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const dir = join(process.cwd(), "backend/pricing/retail_templates");
  let templates: RetailTemplate[] = [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    templates = files
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), "utf8")) as RetailTemplate;
        } catch (err) {
          console.warn(`[retail-templates] failed to parse ${f}:`, err);
          return null;
        }
      })
      .filter((t): t is RetailTemplate => t !== null);
  } catch (err) {
    console.error("[retail-templates] readdir failed:", err);
    return NextResponse.json({ error: "Failed to read templates" }, { status: 500 });
  }

  templates.sort((a, b) => {
    const aKey = `${a._meta.manufacturer} ${a._meta.product_line}`;
    const bKey = `${b._meta.manufacturer} ${b._meta.product_line}`;
    return aKey.localeCompare(bKey);
  });

  return NextResponse.json(
    { templates },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } },
  );
}
