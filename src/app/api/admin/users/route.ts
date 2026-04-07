import { NextResponse } from "next/server";
import { requireAuth, isAuthError, isAdmin } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/admin/users
 *
 * Returns id+email for every platform user. Used by the legacy /admin
 * dashboard to fill in display names for users without company_profiles.
 *
 * Uses the list_platform_users() RPC (SECURITY DEFINER) instead of
 * supabase.auth.admin.listUsers() because that endpoint has been
 * returning 500s on this Supabase project.
 */
export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult.response;
  const { user } = authResult;

  if (!(await isAdmin(user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin.rpc("list_platform_users");
  if (error) {
    console.error("[api/admin/users] list_platform_users RPC failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type RpcRow = { id: string; email: string | null };
  const users = ((data as RpcRow[] | null) || []).map((u) => ({
    id: u.id,
    email: u.email || "",
  }));

  return NextResponse.json(users);
}
