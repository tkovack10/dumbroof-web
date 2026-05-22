import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Resolve the company_id for a given auth user, by reading their
 * company_profiles row. Returns null if the user has no company profile
 * (which means they shouldn't be able to access any company-scoped
 * resources — caller should treat that as a 403).
 *
 * Used by company-scoped API routes (company-docs and future shared-
 * company features) to avoid duplicating the company_profile lookup.
 */
export async function getCallerCompanyId(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("company_profiles")
    .select("company_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.company_id as string) || null;
}
