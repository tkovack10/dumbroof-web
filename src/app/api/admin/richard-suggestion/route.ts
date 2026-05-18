import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/richard-suggestion?surface=<X>&claim_id=<Y>
 *
 * McKinsey/Robinhood "Bet 2" — Richard as inline co-pilot.
 * Returns the highest-impact proactive suggestion for the given surface.
 * Heuristics-only today (no LLM round-trip per page load); copy is
 * Richard-voiced so the agent feels alive without the cost.
 *
 * Surfaces:
 *   - command_center   → company-wide top action
 *   - claim_detail     → per-claim contextual nudge (needs claim_id)
 *   - production       → calendar/scheduling nudge
 *   - job_pnl          → expense variance nudge
 *
 * Response shape:
 *   { suggestion: null }   // nothing to surface
 *   { suggestion: {
 *       id: string,        // stable per (surface, kind, context) so dismissal sticks
 *       kind: string,      // semantic kind for analytics
 *       headline: string,  // bold one-liner Richard says
 *       sub?: string,      // optional supporting line
 *       cta: { label, href } | null,
 *       money_at_stake?: number,
 *     }
 *   }
 */

type Surface = "command_center" | "claim_detail" | "production" | "job_pnl";

interface Suggestion {
  id: string;
  kind: string;
  headline: string;
  sub?: string;
  cta: { label: string; href: string } | null;
  money_at_stake?: number;
}

interface ClaimRowMini {
  id: string;
  address: string | null;
  carrier: string | null;
  status: string | null;
  user_id: string;
  assigned_user_id: string | null;
  last_touched_at: string | null;
  contractor_rcv: number | null;
  current_carrier_rcv: number | null;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, email")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const surface = (url.searchParams.get("surface") || "") as Surface;
  const claimId = url.searchParams.get("claim_id");

  const teamLookup = await getTeamUserIds({
    id: user.id,
    email: user.email || profileRows[0].email || null,
  });
  const teamUserIds = teamLookup.userIds;
  const companyId = teamLookup.companyId;
  if (teamUserIds.length === 0) {
    return NextResponse.json({ suggestion: null });
  }

  let suggestion: Suggestion | null = null;

  switch (surface) {
    case "command_center":
      suggestion = await commandCenterSuggestion(teamUserIds);
      break;
    case "claim_detail":
      if (claimId) suggestion = await claimDetailSuggestion(claimId, teamUserIds);
      break;
    case "production":
      // Production tables are company_id-scoped, not user_id-scoped. Bail
      // safely for domain-fallback teams (no canonical companies row yet)
      // rather than serve a cross-tenant query.
      suggestion = companyId ? await productionSuggestion(companyId) : null;
      break;
    case "job_pnl":
      suggestion = await jobPnlSuggestion(teamUserIds, companyId);
      break;
    default:
      return NextResponse.json({ error: "Invalid surface" }, { status: 400 });
  }

  return NextResponse.json({ suggestion });
}

// ────────────────────────────────────────────────────────────────────────
// Per-surface heuristics
// ────────────────────────────────────────────────────────────────────────

async function commandCenterSuggestion(
  teamUserIds: string[]
): Promise<Suggestion | null> {
  // Pull active claims + last forensic event per claim. Surface the count
  // of claims with no forensic_sent in the next-action queue.
  const TERMINAL = ["lost", "closed", "paid", "completed"];
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select(
      "id, address, carrier, status, user_id, assigned_user_id, last_touched_at, contractor_rcv, current_carrier_rcv"
    )
    .in("user_id", teamUserIds)
    .order("last_touched_at", { ascending: false })
    .limit(500);

  const claims = ((claimRows || []) as unknown as ClaimRowMini[]).filter(
    (c) => !c.status || !TERMINAL.includes(c.status.toLowerCase())
  );
  if (claims.length === 0) return null;

  // Check forensic_sent events
  const ids = claims.map((c) => c.id);
  const { data: events } = await supabaseAdmin
    .from("claim_events")
    .select("claim_id, event_type")
    .in("claim_id", ids)
    .in("event_type", ["forensic_sent_to_carrier", "forensic_sent_to_homeowner"]);
  const sent = new Set<string>();
  for (const e of events || []) sent.add(e.claim_id as string);

  const needsForensic = claims.filter((c) => !sent.has(c.id));
  if (needsForensic.length === 0) {
    // Secondary: nudge to take a breath
    return {
      id: `cc:all-clear:${new Date().toISOString().slice(0, 10)}`,
      kind: "all_clear",
      headline: "Every active claim has a forensic out. Nice.",
      sub: "Use the morning to chase carrier silence on supplements — see the WHAT'S NEXT card above.",
      cta: null,
    };
  }

  const totalMoney = needsForensic.reduce(
    (s, c) => s + inferMoney(c),
    0
  );
  const top = [...needsForensic].sort(
    (a, b) => inferMoney(b) - inferMoney(a)
  )[0];

  return {
    id: `cc:needs-forensic:${needsForensic.length}:${new Date().toISOString().slice(0, 10)}`,
    kind: "command_center_needs_forensic",
    headline: `${needsForensic.length} claim${needsForensic.length === 1 ? "" : "s"} I can move forward right now`,
    sub: `Top of the queue: ${top?.address ?? "your most recent claim"} — ${
      inferMoney(top) > 0
        ? `$${Math.round(inferMoney(top)).toLocaleString("en-US")} on the table.`
        : "let's ship the forensic."
    }`,
    cta: {
      label: "Review the queue →",
      href: "/dashboard/admin?filter=needs_forensic",
    },
    money_at_stake: totalMoney,
  };
}

async function claimDetailSuggestion(
  claimId: string,
  teamUserIds: string[]
): Promise<Suggestion | null> {
  // Load claim + relevant events to pick the most-urgent contextual nudge.
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select(
      "id, address, carrier, status, user_id, assigned_user_id, contractor_rcv, current_carrier_rcv"
    )
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return null;
  // Cross-team check
  if (!teamUserIds.includes((claim as { user_id: string }).user_id)) return null;

  const { data: events } = await supabaseAdmin
    .from("claim_events")
    .select("event_type, occurred_at, metadata")
    .eq("claim_id", claimId)
    .in("event_type", [
      "forensic_sent_to_carrier",
      "scope_received",
      "supplement_sent",
      "supplement_sent_to_carrier",
      "install_supplement_sent",
      "coc_sent",
      "coc_sent_to_homeowner",
      "check_received",
      "install_complete",
    ])
    .order("occurred_at", { ascending: false });

  const lastBy = new Map<string, string>(); // event_type → ISO
  for (const e of events || []) {
    if (!lastBy.has(e.event_type)) lastBy.set(e.event_type, e.occurred_at);
  }

  const now = Date.now();
  const day = 86_400_000;

  // 1) Check received but no commission_request yet (data-driven)
  if (lastBy.has("check_received")) {
    const { data: existing } = await supabaseAdmin
      .from("commission_requests")
      .select("id")
      .eq("claim_id", claimId)
      .limit(1);
    if ((existing?.length ?? 0) === 0) {
      const checkAt = lastBy.get("check_received")!;
      const daysAgo = Math.floor((now - new Date(checkAt).getTime()) / day);
      return {
        // Suffix with the check timestamp so a NEW check after a dismissal
        // surfaces a fresh suggestion (instead of being silently re-suppressed).
        id: `cd:check-no-commission:${claimId}:${checkAt}`,
        kind: "claim_check_no_commission",
        headline: "Check came in. Want me to draft the rep commission?",
        sub: `Check landed ${daysAgo === 0 ? "today" : daysAgo + "d ago"} — 10% is the default. Click to submit.`,
        cta: {
          label: "Open commission flow →",
          href: `/dashboard/claim/${claimId}?action=submit_commission`,
        },
      };
    }
  }

  // 2) Install complete, no COC sent in 7d
  if (
    lastBy.has("install_complete") &&
    !(lastBy.has("coc_sent") || lastBy.has("coc_sent_to_homeowner"))
  ) {
    const since = (now - new Date(lastBy.get("install_complete")!).getTime()) / day;
    if (since >= 7) {
      return {
        id: `cd:install-no-coc:${claimId}:${lastBy.get("install_complete")}`,
        kind: "claim_install_no_coc",
        headline: `Install was ${Math.round(since)}d ago — COC unlocks the final bill.`,
        sub: "Carrier won't release the last payment without it. Want me to draft?",
        cta: {
          label: "Draft COC →",
          href: `/dashboard/claim/${claimId}?action=send_coc`,
        },
      };
    }
  }

  // 3) Carrier silent (forensic out, no scope_received in 10+ days)
  if (lastBy.has("forensic_sent_to_carrier") && !lastBy.has("scope_received")) {
    const since = (now - new Date(lastBy.get("forensic_sent_to_carrier")!).getTime()) / day;
    if (since >= 10) {
      return {
        // Bucket id to the forensic-sent timestamp + week-of so a brand-new
        // forensic gets its own dismiss slot, and stale ids fade weekly.
        id: `cd:carrier-silent:${claimId}:${lastBy.get("forensic_sent_to_carrier")}`,
        kind: "claim_carrier_silent",
        headline: `${claim.carrier ?? "the carrier"} hasn't replied in ${Math.round(since)} days.`,
        sub: "Want me to draft a follow-up to the adjuster?",
        cta: {
          label: "Draft follow-up →",
          href: `/dashboard/claim/${claimId}?action=chase_carrier`,
        },
      };
    }
  }

  // 4) Scope received, no supplement sent in 3d
  if (
    lastBy.has("scope_received") &&
    !(
      lastBy.has("supplement_sent") ||
      lastBy.has("supplement_sent_to_carrier") ||
      lastBy.has("install_supplement_sent")
    )
  ) {
    const since = (now - new Date(lastBy.get("scope_received")!).getTime()) / day;
    if (since >= 3) {
      return {
        id: `cd:scope-no-supplement:${claimId}:${lastBy.get("scope_received")}`,
        kind: "claim_scope_no_supplement",
        headline: `Carrier scope landed ${Math.round(since)}d ago.`,
        sub: "Window's closing — send the supplement before they archive.",
        cta: {
          label: "Send supplement →",
          href: `/dashboard/claim/${claimId}?action=send_supplement`,
        },
      };
    }
  }

  return null;
}

async function productionSuggestion(
  companyId: string
): Promise<Suggestion | null> {
  // 1) Crew double-booked today/tomorrow
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inThreeDays = new Date(today.getTime() + 3 * 86_400_000);

  const { data: schedules } = await supabaseAdmin
    .from("production_schedules")
    .select("scheduled_at, crew_id, status, notify_homeowner, notified_at, claim_id")
    .eq("company_id", companyId)
    .in("status", ["scheduled", "in_progress"])
    .gte("scheduled_at", today.toISOString())
    .lt("scheduled_at", inThreeDays.toISOString());

  // Per-day-per-crew count
  const byDayCrew = new Map<string, number>();
  for (const s of schedules || []) {
    if (!s.crew_id) continue;
    const day = new Date(s.scheduled_at).toISOString().slice(0, 10);
    const k = `${day}|${s.crew_id}`;
    byDayCrew.set(k, (byDayCrew.get(k) ?? 0) + 1);
  }
  let overbooked: { day: string; crew_id: string; count: number } | null = null;
  for (const [k, n] of byDayCrew.entries()) {
    if (n >= 3 && (!overbooked || n > overbooked.count)) {
      const [day, crew_id] = k.split("|");
      overbooked = { day, crew_id, count: n };
    }
  }
  if (overbooked) {
    const { data: crew } = await supabaseAdmin
      .from("crews")
      .select("name")
      .eq("id", overbooked.crew_id)
      .eq("company_id", companyId)
      .maybeSingle();
    const dayLabel = new Date(overbooked.day + "T12:00:00").toLocaleDateString(
      "en-US",
      { weekday: "long" }
    );
    return {
      id: `pr:crew-overbooked:${overbooked.day}:${overbooked.crew_id}`,
      kind: "production_crew_overbooked",
      headline: `${crew?.name ?? "A crew"} has ${overbooked.count} installs on ${dayLabel}.`,
      sub: "That's a stretch — want to slide one of them to later in the week?",
      cta: {
        label: "Open the calendar →",
        href: `/dashboard/admin/production`,
      },
    };
  }

  // 2) Schedules needing homeowner notify
  const needNotify = (schedules || []).filter(
    (s) => s.notify_homeowner && !s.notified_at
  );
  if (needNotify.length >= 1) {
    return {
      id: `pr:notify:${needNotify.length}:${today.toISOString().slice(0, 10)}`,
      kind: "production_needs_notify",
      headline: `${needNotify.length} install${needNotify.length === 1 ? "" : "s"} scheduled this week haven't notified the homeowner yet.`,
      sub: "Quickest dopamine for homeowners — let them know they're on the books.",
      cta: {
        label: "Open the calendar →",
        href: "/dashboard/admin/production",
      },
    };
  }

  // 3) Team isn't using production yet
  const { count: anyCount } = await supabaseAdmin
    .from("production_schedules")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("status", ["scheduled", "in_progress", "completed"])
    .limit(1);
  if ((anyCount ?? 0) === 0) {
    return {
      id: `pr:empty:${today.toISOString().slice(0, 10)}`,
      kind: "production_empty",
      headline: "No installs on the calendar yet.",
      sub: "Click + New install to schedule your first one. Homeowner auto-emails on every schedule change.",
      cta: null,
    };
  }

  return null;
}

async function jobPnlSuggestion(
  teamUserIds: string[],
  companyId: string | null
): Promise<Suggestion | null> {
  // Sum expenses per claim, compare to contractor_rcv. Find biggest variance.
  const { data: claims } = await supabaseAdmin
    .from("claims")
    .select("id, address, contractor_rcv")
    .in("user_id", teamUserIds)
    .not("contractor_rcv", "is", null)
    .gt("contractor_rcv", 0)
    .limit(500);
  if (!claims || claims.length === 0) return null;

  const claimIds = claims.map((c) => c.id as string);
  const expensesQuery = supabaseAdmin
    .from("job_expenses")
    .select("claim_id, amount_cents")
    .in("claim_id", claimIds);
  // Belt-and-suspenders: scope by company_id too when available so a future
  // claim-id reuse / RLS bypass can't leak another team's receipts.
  const { data: expenses } = companyId
    ? await expensesQuery.eq("company_id", companyId)
    : await expensesQuery;

  const sumByClaim = new Map<string, number>();
  for (const e of expenses || []) {
    const k = e.claim_id as string;
    sumByClaim.set(k, (sumByClaim.get(k) ?? 0) + (e.amount_cents ?? 0));
  }

  interface Variance {
    claim_id: string;
    address: string | null;
    overage_cents: number;
    pct_over: number;
  }
  const variances: Variance[] = [];
  for (const c of claims) {
    const spent = sumByClaim.get(c.id as string) ?? 0;
    if (spent === 0) continue;
    // Rough forecast = 60% of RCV (industry average roofing margin ~40%);
    // contractors can override later with the Slice D forecast pricelist.
    const forecastCents = Math.round(
      Number((c as { contractor_rcv?: number | null }).contractor_rcv ?? 0) *
        100 *
        0.6
    );
    if (forecastCents === 0) continue;
    if (spent <= forecastCents) continue;
    const overage = spent - forecastCents;
    const pctOver = Math.round(((spent - forecastCents) / forecastCents) * 100);
    if (pctOver < 10) continue;
    variances.push({
      claim_id: c.id as string,
      address: (c as { address?: string | null }).address ?? null,
      overage_cents: overage,
      pct_over: pctOver,
    });
  }
  if (variances.length === 0) return null;
  variances.sort((a, b) => b.overage_cents - a.overage_cents);
  const worst = variances[0];

  return {
    id: `pnl:variance:${worst.claim_id}:${worst.pct_over}`,
    kind: "job_pnl_variance",
    headline: `${worst.address ?? "One job"} is tracking ${worst.pct_over}% over forecast.`,
    sub:
      worst.pct_over >= 30
        ? "Common cause this big: aged stock pricing or a labor day overrun. Want me to pull the receipts?"
        : "Heads up — review receipts before the job closes out so you can lock in the right margin number.",
    cta: {
      label: "Open the job →",
      href: `/dashboard/claim/${worst.claim_id}`,
    },
    money_at_stake: Math.round(worst.overage_cents / 100),
  };
}

function inferMoney(c: ClaimRowMini): number {
  const ours = Number(c.contractor_rcv ?? 0);
  const carrier = Number(c.current_carrier_rcv ?? 0);
  if (ours > 0 && carrier > 0) return Math.max(ours - carrier, 0);
  return ours;
}
