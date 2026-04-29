import { NextResponse } from "next/server";
import { requireAuth, isAuthError, isAdmin } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/admin/directory
 *
 * Single source of truth for the admin dashboard's Signups + Companies +
 * Claims-table-user-cell. Bypasses RLS via service role so we see EVERY
 * platform user and EVERY company, not just the admin's own company.
 *
 * Returns:
 *   {
 *     users: [{
 *       id, email, name, contact_name, company_name, phone,
 *       claim_count, last_sign_in_at, created_at, is_admin, role,
 *       company_id  // null for solo / orphan
 *     }, ...],
 *     companies: [{
 *       key,                       // company_id, or admin user_id when company_id IS NULL
 *       company_name,
 *       has_logo,
 *       members: [{ user_id, name, email, is_admin, claim_count }],
 *       phone,
 *       claims_count,              // sum across all members
 *       plan_id, plan_status
 *     }, ...]
 *   }
 *
 * Pulled in parallel: auth.users via list_platform_users RPC,
 * company_profiles, claims (just user_id for counts), subscriptions.
 * Total payload for ~150 users / ~30 companies is ~30KB.
 */
export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult.response;
  const { user } = authResult;
  if (!(await isAdmin(user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const [usersRes, profilesRes, claimsRes, subsRes] = await Promise.all([
    supabaseAdmin.rpc("list_platform_users"),
    supabaseAdmin
      .from("company_profiles")
      .select(
        "user_id, company_id, company_name, contact_name, email, phone, logo_path, is_admin, role"
      ),
    supabaseAdmin.from("claims").select("user_id"),
    supabaseAdmin.from("subscriptions").select("user_id, company_id, plan_id, status"),
  ]);

  type AuthUser = {
    id: string;
    email: string | null;
    last_sign_in_at: string | null;
    created_at: string | null;
  };
  type Profile = {
    user_id: string;
    company_id: string | null;
    company_name: string | null;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    logo_path: string | null;
    is_admin: boolean | null;
    role: string | null;
  };
  type ClaimRow = { user_id: string };
  type Subscription = {
    user_id: string;
    company_id: string | null;
    plan_id: string | null;
    status: string | null;
  };

  const authUsers = (usersRes.data as AuthUser[] | null) || [];
  const profiles = (profilesRes.data as Profile[] | null) || [];
  const claimsRows = (claimsRes.data as ClaimRow[] | null) || [];
  const subs = (subsRes.data as Subscription[] | null) || [];

  // user_id → { count }
  const userClaimCount = new Map<string, number>();
  for (const c of claimsRows) {
    userClaimCount.set(c.user_id, (userClaimCount.get(c.user_id) || 0) + 1);
  }

  // user_id → profile
  const profileById = new Map<string, Profile>();
  for (const p of profiles) profileById.set(p.user_id, p);

  // Pretty-name fallback when contact_name is missing — use auth.users's
  // email local-part with light Title-Case so the dashboard never displays
  // a raw lowercased email handle for known users.
  const fallbackName = (email: string | null | undefined): string => {
    if (!email) return "Unknown";
    return email
      .split("@")[0]
      .replace(/[._+]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // === USERS list ===
  // Every auth.users row, augmented with profile when available. This is
  // what the Signups tab + Claims-table user-cell consume.
  const users = authUsers.map((u) => {
    const p = profileById.get(u.id);
    const contact = p?.contact_name?.trim() || "";
    const companyName = p?.company_name?.trim() || "";
    const display = contact || fallbackName(u.email);
    return {
      id: u.id,
      email: u.email || "",
      name: display,
      contact_name: contact || null,
      company_name: companyName || null,
      phone: p?.phone || "",
      claim_count: userClaimCount.get(u.id) || 0,
      last_sign_in_at: u.last_sign_in_at,
      created_at: u.created_at,
      is_admin: !!p?.is_admin,
      role: p?.role || null,
      company_id: p?.company_id || null,
    };
  });

  // === COMPANIES list ===
  // Group profiles by company_id (or solo admin user_id when company_id IS NULL).
  // Profiles with NULL company_id AND is_admin=false are orphans → fold each
  // into its own one-person pseudo-company so they still surface.
  const groups = new Map<string, Profile[]>();
  for (const p of profiles) {
    const key = p.company_id || p.user_id;
    const arr = groups.get(key) || [];
    arr.push(p);
    groups.set(key, arr);
  }

  const planFor = (members: Profile[]) => {
    const memberIds = new Set(members.map((m) => m.user_id));
    const companyIds = new Set(
      members.map((m) => m.company_id).filter((cid): cid is string => Boolean(cid))
    );
    const candidates = subs.filter(
      (s) =>
        (s.company_id && companyIds.has(s.company_id)) || memberIds.has(s.user_id)
    );
    const active =
      candidates.find((s) => s.status === "active" || s.status === "trialing") ||
      candidates.find((s) => s.status === "past_due") ||
      candidates[0];
    return active
      ? { plan_id: active.plan_id, plan_status: active.status }
      : { plan_id: null, plan_status: null };
  };

  const companies = Array.from(groups.entries()).map(([key, members]) => {
    const admin = members.find((m) => m.is_admin) || members[0];
    const total = members.reduce(
      (sum, m) => sum + (userClaimCount.get(m.user_id) || 0),
      0
    );
    const { plan_id, plan_status } = planFor(members);
    return {
      key,
      company_name: admin.company_name?.trim() || "(no company name)",
      has_logo: Boolean(admin.logo_path),
      members: members.map((m) => ({
        user_id: m.user_id,
        name: m.contact_name?.trim() || fallbackName(m.email),
        email: m.email || "",
        is_admin: !!m.is_admin,
        claim_count: userClaimCount.get(m.user_id) || 0,
      })),
      phone: admin.phone || "",
      claims_count: total,
      plan_id,
      plan_status,
    };
  });

  companies.sort(
    (a, b) =>
      b.claims_count - a.claims_count ||
      a.company_name.localeCompare(b.company_name)
  );

  return NextResponse.json({ users, companies });
}
