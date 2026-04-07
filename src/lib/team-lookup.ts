import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Public email domains — users with these domains are treated as solo,
 * not as members of a "company" (so e.g. two unrelated gmail.com users
 * never see each other's claims).
 */
export const PUBLIC_DOMAINS: Set<string> = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "mail.com", "protonmail.com", "zoho.com", "yandex.com",
  "live.com", "msn.com", "comcast.net", "verizon.net", "att.net",
]);

export interface TeamMember {
  id: string;
  email: string | null;
}

export interface TeamLookupResult {
  /** All user_ids that belong to this user's team. Always includes the requester. */
  userIds: string[];
  /** Same set as userIds, but with emails attached for display/lookup. */
  members: TeamMember[];
  /** True if more than one team member was found. */
  isTeam: boolean;
  /** company_id if the user has one set on their company_profiles row, else null. */
  companyId: string | null;
}

/**
 * Resolve all user_ids that belong to the same team as the requesting user.
 *
 * Resolution order (mirrors getCompanyProfile() in api-auth.ts):
 *   1. company_id on the user's company_profiles row → all profiles with same company_id
 *   2. Non-public email domain → all company_profiles where email ends with @<domain>
 *   3. Fallback → just [user.id]
 *
 * Replaces the broken `supabaseAdmin.auth.admin.listUsers() + filter` pattern
 * that was used in 7+ admin/team routes. The Supabase auth admin endpoint
 * has been returning 500s on this project, which silently collapsed teams
 * to a single user.
 */
export async function getTeamUserIds(
  user: { id: string; email?: string | null }
): Promise<TeamLookupResult> {
  // 1. Look up the requester's company_profiles row
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("company_id")
    .eq("user_id", user.id)
    .limit(1);

  const companyId: string | null = profileRows?.[0]?.company_id ?? null;

  // 2. company_id path — authoritative
  if (companyId) {
    const { data: teamProfiles } = await supabaseAdmin
      .from("company_profiles")
      .select("user_id, email")
      .eq("company_id", companyId);

    const members: TeamMember[] = (teamProfiles || [])
      .filter((p) => !!p.user_id)
      .map((p) => ({
        id: p.user_id as string,
        email: (p.email as string | null) ?? null,
      }));

    if (members.length > 0) {
      // Make sure the requester is always included even if their own row got
      // out of sync somehow.
      if (!members.some((m) => m.id === user.id)) {
        members.push({ id: user.id, email: user.email ?? null });
      }
      const userIds = members.map((m) => m.id);
      return { userIds, members, isTeam: userIds.length > 1, companyId };
    }
  }

  // 3. Domain path — for users whose profile lacks a company_id
  const email = user.email || "";
  const domain = email.includes("@") ? email.split("@")[1].toLowerCase() : "";

  if (domain && !PUBLIC_DOMAINS.has(domain)) {
    const { data: domainProfiles } = await supabaseAdmin
      .from("company_profiles")
      .select("user_id, email")
      .ilike("email", `%@${domain}`);

    const members: TeamMember[] = (domainProfiles || [])
      .filter((p) => {
        const e = (p.email as string | null) || "";
        return !!p.user_id && e.toLowerCase().endsWith(`@${domain}`);
      })
      .map((p) => ({
        id: p.user_id as string,
        email: (p.email as string | null) ?? null,
      }));

    if (members.length > 0) {
      if (!members.some((m) => m.id === user.id)) {
        members.push({ id: user.id, email: user.email ?? null });
      }
      const userIds = members.map((m) => m.id);
      return { userIds, members, isTeam: userIds.length > 1, companyId };
    }
  }

  // 4. Fallback — solo user
  const soloMember: TeamMember = { id: user.id, email: user.email ?? null };
  return { userIds: [user.id], members: [soloMember], isTeam: false, companyId };
}
