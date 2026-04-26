import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Find email addresses for OWNERS of the sender's company, excluding the
 * sender themselves. Used to BCC the team owner on every outbound claim
 * email so they have full visibility into what their team sends out.
 *
 * Returns [] when:
 *   - Sender has no company_id (solo account — no owner to copy)
 *   - Sender IS the owner (already on the From line)
 *   - No other owner exists in the company
 *
 * Defensive — never throws; returns [] on any lookup failure.
 *
 * Mirrors backend/claim_brain_email.py company_owner_emails() — keep in sync.
 */
export async function companyOwnerEmails(senderUserId: string): Promise<string[]> {
  try {
    const { data: profileRows } = await supabaseAdmin
      .from("company_profiles")
      .select("company_id")
      .eq("user_id", senderUserId)
      .limit(1);
    const companyId = profileRows?.[0]?.company_id;
    if (!companyId) return [];

    const { data: ownerRows } = await supabaseAdmin
      .from("company_profiles")
      .select("email,user_id,role,is_admin")
      .eq("company_id", companyId)
      .neq("user_id", senderUserId);

    const owners: string[] = [];
    for (const row of ownerRows || []) {
      const role = (row.role || "").toLowerCase();
      const isAdmin = !!row.is_admin;
      const email = (row.email || "").trim();
      // "Owner" = explicit role OR is_admin without a role set (backward compat
      // with profiles created before the role column was populated).
      if (email && (role === "owner" || (!role && isAdmin))) {
        owners.push(email);
      }
    }
    return owners;
  } catch (e) {
    console.error("[team-bcc] companyOwnerEmails lookup failed", { senderUserId, error: e });
    return [];
  }
}

/**
 * Merge `extra` BCC addresses into a list, skipping duplicates (case-insensitive)
 * and any address that matches `excludeRecipient` (so the To: doesn't accidentally
 * double-up via BCC).
 */
export function mergeBcc(
  base: string[] | undefined,
  extra: string[],
  excludeRecipient?: string
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const skipKey = (excludeRecipient || "").trim().toLowerCase();
  for (const addr of [...(base || []), ...extra]) {
    if (!addr) continue;
    const key = addr.trim().toLowerCase();
    if (!key || key === skipKey || seen.has(key)) continue;
    seen.add(key);
    out.push(addr.trim());
  }
  return out;
}
