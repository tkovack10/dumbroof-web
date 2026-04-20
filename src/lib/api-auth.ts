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
    .limit(1);
  return !!(data && data.length > 0);
}

/**
 * Verify user owns the claim, is assigned as the rep, shares the same
 * company_id (team access), shares the email domain (legacy pre-invite teams),
 * or is a platform admin. Returns true if authorized.
 */
export async function canAccessClaim(userId: string, claimId: string): Promise<boolean> {
  // Check the claim's scope fields (owner, assigned rep, company)
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select("user_id, assigned_user_id, company_id")
    .eq("id", claimId)
    .limit(1);

  const claim = claimRows?.[0] || null;
  if (!claim) return false;

  if (claim.user_id === userId) return true;
  if (claim.assigned_user_id === userId) return true;

  // Team access — explicit company_id link (populated by invite flow + migration backfill)
  if (claim.company_id) {
    const { data: profileRows } = await supabaseAdmin
      .from("company_profiles")
      .select("company_id")
      .eq("user_id", userId)
      .limit(1);
    const myCompanyId = profileRows?.[0]?.company_id;
    if (myCompanyId && myCompanyId === claim.company_id) return true;
  }

  // Legacy: same email domain as claim owner (pre-invite teams still rely on this)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email && claim.user_id) {
    const { data: owner } = await supabaseAdmin.auth.admin.getUserById(claim.user_id);
    if (owner?.user?.email) {
      const userDomain = user.email.split("@")[1];
      const ownerDomain = owner.user.email.split("@")[1];
      if (userDomain === ownerDomain) return true;
    }
  }

  // Fall back to platform admin
  return isAdmin(userId);
}

/**
 * Verify user owns the repair OR is an admin. Returns true if authorized.
 */
export async function canAccessRepair(userId: string, repairId: string): Promise<boolean> {
  const { data: repairRows } = await supabaseAdmin
    .from("repairs")
    .select("user_id")
    .eq("id", repairId)
    .limit(1);

  const repair = repairRows?.[0] || null;
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
  try {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const userEmail = authUser?.user?.email;
    if (userEmail && userEmail.includes("@")) {
      const domain = userEmail.split("@")[1];
      const { data: adminProfiles } = await supabaseAdmin
        .from("company_profiles")
        .select("*")
        .eq("is_admin", true)
        .limit(100);

      if (adminProfiles) {
        for (const profile of adminProfiles) {
          if (profile.email?.endsWith(`@${domain}`)) {
            return { ...profile, user_id: userId };
          }
        }
      }
    }
  } catch {
    // Auth service failure — graceful fallback
  }

  // 3. Fallback — return user's own profile
  return userProfile;
}
