import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface AuthResult {
  user: { id: string; email?: string };
}

interface AuthError {
  response: NextResponse;
}

/**
 * Require authenticated user. Returns user or 401 response.
 */
export async function requireAuth(): Promise<AuthResult | AuthError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { user: { id: user.id, email: user.email } };
}

/**
 * Check if the authenticated user is an admin.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .single();
  return !!data;
}

/**
 * Verify user owns the claim OR is an admin. Returns true if authorized.
 */
export async function canAccessClaim(userId: string, claimId: string): Promise<boolean> {
  // Check ownership first (cheaper)
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("user_id")
    .eq("id", claimId)
    .single();

  if (claim?.user_id === userId) return true;

  // Fall back to admin check
  return isAdmin(userId);
}

/**
 * Verify user owns the repair OR is an admin. Returns true if authorized.
 */
export async function canAccessRepair(userId: string, repairId: string): Promise<boolean> {
  const { data: repair } = await supabaseAdmin
    .from("repairs")
    .select("user_id")
    .eq("id", repairId)
    .single();

  if (repair?.user_id === userId) return true;

  return isAdmin(userId);
}

/** Type guard: is this an auth error? */
export function isAuthError(result: AuthResult | AuthError): result is AuthError {
  return "response" in result;
}
