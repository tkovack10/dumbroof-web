import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Find the FOUNDING owner of the sender's company — the single oldest
 * company_profiles row with role='owner'. BCC'd on every claim email a
 * team member sends so the founder has full visibility into outbound
 * team comms.
 *
 * Why "oldest only": today company_profiles defaults role='owner' on solo
 * signup, so a 12-person team can show 12 owners. BCCing 12 people on
 * every claim email = spam. The founding signup (oldest created_at) is
 * the actual owner; everyone else is a teammate who happens to have the
 * default role flag. When the team-invite/accept flow is used (proper
 * onboarding), the invitee gets role='member' and this works correctly too.
 *
 * Returns [] when:
 *   - Sender has no company_id (solo account)
 *   - Sender IS the founding owner (already the From: address)
 *   - No other 'owner' record exists in the company
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

    // Founding owner = the OLDEST 'owner' record in the company. This is
    // a fixed property of the company, not "next available" — if the
    // sender IS the founding owner, return [] (don't fall back to the
    // next-oldest, which would BCC the second person every time the
    // founder sends).
    const { data: ownerRows } = await supabaseAdmin
      .from("company_profiles")
      .select("user_id,email,created_at")
      .eq("company_id", companyId)
      .eq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(1);

    const founding = ownerRows?.[0];
    if (!founding) return [];
    if (founding.user_id === senderUserId) return []; // sender IS the founder
    const email = (founding.email || "").trim();
    return email ? [email] : [];
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
