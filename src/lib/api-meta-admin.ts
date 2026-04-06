import { NextResponse } from "next/server";
import { requireAuth, isAuthError, isAdmin } from "@/lib/api-auth";
import { MetaApiError } from "@/lib/meta-ads";

/**
 * Shared admin guard + error handler for /api/admin/meta/* routes.
 *
 * Every route handler under /api/admin/meta/ should:
 *   1. await metaAdminGuard() — returns NextResponse on failure
 *   2. wrap the actual Meta API call in try/catch
 *   3. return handleMetaError(err) on failure
 *
 * This keeps the route files small and consistent.
 */

export async function metaAdminGuard(): Promise<NextResponse | null> {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult.response;
  if (!(await isAdmin(authResult.user.id))) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return null; // Authorized
}

export function handleMetaError(err: unknown): NextResponse {
  if (err instanceof MetaApiError) {
    return NextResponse.json(
      { error: err.message, meta_status: err.status, path: err.path },
      { status: err.status }
    );
  }
  if (err instanceof Error) {
    if (err.message.includes("META_ACCESS_TOKEN") || err.message.includes("META_AD_ACCOUNT_ID")) {
      return NextResponse.json(
        { error: "Meta credentials not configured. Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in Vercel env vars." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  return NextResponse.json({ error: "Unknown error" }, { status: 500 });
}
