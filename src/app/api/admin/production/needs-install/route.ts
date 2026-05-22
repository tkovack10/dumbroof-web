import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/admin/production/needs-install
 *
 * Returns claims that have at least one check_uploads row (payment received)
 * but NO active production_schedules row (status in scheduled/in_progress/completed).
 *
 * Renders in the Unscheduled tab on /dashboard/production.
 * Per Tom 2026-05-22: "jobs with a payment received = $ icon lit up in the claims
 * dashboard, and that also means - needs to be on the production list of installs
 * (either already installed date on the calendar, or in the bucket of jobs that
 * need installs)".
 *
 * Ordering: oldest first payment date first (most overdue at top).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_admin || !profile.company_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profile.company_id;

  // Step 1: all check_uploads for this company, grouped by claim.
  // We want: per-claim min(received_at) as first_payment_at, sum(amount_cents) as total_paid_cents.
  // Supabase JS doesn't expose group-by sugar — use the REST RPC pattern via service-role
  // and aggregate client-side. Bound at 10k checks per company (anything beyond means we
  // need a materialized view; not a v1 concern).
  const { data: checks, error: checksErr } = await supabaseAdmin
    .from("check_uploads")
    .select("claim_id, amount_cents, received_at, payor, source")
    .eq("company_id", companyId)
    .order("received_at", { ascending: true })
    .limit(10000);
  if (checksErr) {
    return NextResponse.json({ error: checksErr.message }, { status: 500 });
  }
  if (!checks || checks.length === 0) {
    return NextResponse.json({ claims: [] });
  }

  const byClaim = new Map<
    string,
    { total_cents: number; first_at: string; check_count: number; last_payor: string | null }
  >();
  for (const c of checks) {
    const cid = c.claim_id as string;
    const existing = byClaim.get(cid);
    if (!existing) {
      byClaim.set(cid, {
        total_cents: c.amount_cents || 0,
        first_at: c.received_at as string,
        check_count: 1,
        last_payor: (c.payor as string | null) || null,
      });
    } else {
      existing.total_cents += c.amount_cents || 0;
      existing.check_count += 1;
      // first_at is already min because we ordered ASC and only set on first sighting.
      // last_payor: keep the latest in iteration order (= chronological last).
      existing.last_payor = (c.payor as string | null) || existing.last_payor;
    }
  }

  const paidClaimIds = Array.from(byClaim.keys());

  // Step 2: which of those have an active production_schedules row?
  const { data: scheds } = await supabaseAdmin
    .from("production_schedules")
    .select("claim_id, status, scheduled_at")
    .eq("company_id", companyId)
    .in("claim_id", paidClaimIds)
    .in("status", ["scheduled", "in_progress", "completed"]);
  const scheduledClaimIds = new Set((scheds || []).map(s => s.claim_id as string));

  const needsInstallIds = paidClaimIds.filter(id => !scheduledClaimIds.has(id));
  if (needsInstallIds.length === 0) {
    return NextResponse.json({ claims: [] });
  }

  // Step 3: hydrate with claim details. The .eq("company_id", companyId) is
  // defense-in-depth — needsInstallIds was derived via check_uploads filtered
  // by companyId, so claim_id mismatches should not exist, but if a check_upload
  // ever pointed at a cross-tenant claim (import bug, manual data migration),
  // we want to drop that row from the response rather than leak it.
  const { data: claims, error: claimsErr } = await supabaseAdmin
    .from("claims")
    .select("id, address, homeowner_name, homeowner_email, homeowner_phone, carrier, status, phase")
    .in("id", needsInstallIds)
    .eq("company_id", companyId);
  if (claimsErr) {
    return NextResponse.json({ error: claimsErr.message }, { status: 500 });
  }

  // Merge payment summary + claim details, sort by first payment date asc (oldest first).
  const merged = (claims || [])
    .map(c => {
      const pay = byClaim.get(c.id as string)!;
      return {
        claim_id: c.id,
        address: c.address,
        homeowner_name: c.homeowner_name,
        homeowner_email: c.homeowner_email,
        homeowner_phone: c.homeowner_phone,
        carrier: c.carrier,
        status: c.status,
        phase: c.phase,
        total_paid_cents: pay.total_cents,
        first_payment_at: pay.first_at,
        check_count: pay.check_count,
        last_payor: pay.last_payor,
      };
    })
    .sort((a, b) => a.first_payment_at.localeCompare(b.first_payment_at));

  return NextResponse.json({ claims: merged });
}
