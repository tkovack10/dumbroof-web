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
  // Check ownership first (cheapest)
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("user_id")
    .eq("id", claimId)
    .single();

  if (claim?.user_id === userId) return true;

  // Check domain sharing (same email domain = same company)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email && claim?.user_id) {
    const { data: owner } = await supabaseAdmin.auth.admin.getUserById(claim.user_id);
    if (owner?.user?.email) {
      const userDomain = user.email.split("@")[1];
      const ownerDomain = owner.user.email.split("@")[1];
      if (userDomain === ownerDomain) return true;
    }
  }

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

/**
 * Get the effective company profile for a user.
 *
 * Company settings are ADMIN-ONLY. Regular users never enter API keys,
 * logos, or company branding. Everything cascades from the company admin.
 *
 * Resolution order:
 * 1. company_id → find admin profile for that company
 * 2. Email domain → find admin profile with matching email domain
 * 3. User's own profile (for admins, or fallback)
 */
export async function getCompanyProfile(userId: string) {
  // Get the user's own profile
  const { data: userRows } = await supabaseAdmin
    .from("company_profiles")
    .select("*")
    .eq("user_id", userId)
    .limit(1);

  const userProfile = userRows?.[0] || null;

  // If user IS the admin, return their profile directly
  if (userProfile?.is_admin) {
    return userProfile;
  }

  // 1. If user has a company_id, get the admin's profile (source of truth)
  if (userProfile?.company_id) {
    const { data: adminRows } = await supabaseAdmin
      .from("company_profiles")
      .select("*")
      .eq("company_id", userProfile.company_id)
      .eq("is_admin", true)
      .limit(1);

    if (adminRows?.[0]) {
      return { ...adminRows[0], user_id: userId };
    }
  }

  // 2. Domain-based lookup — find admin with same email domain
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const userEmail = authUser?.user?.email;
  if (userEmail) {
    const domain = userEmail.split("@")[1];
    const { data: adminProfiles } = await supabaseAdmin
      .from("company_profiles")
      .select("*")
      .eq("is_admin", true);

    if (adminProfiles) {
      for (const profile of adminProfiles) {
        if (profile.email?.endsWith(`@${domain}`)) {
          return { ...profile, user_id: userId };
        }
      }
    }
  }

  // 3. Fallback — return user's own profile
  return userProfile;
}
