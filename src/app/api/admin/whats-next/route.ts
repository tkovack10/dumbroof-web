import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/whats-next
 *
 * Phase 6 Slice 2 — Morning Briefing hero data source.
 *
 * Surfaces the top 3 actions for an owner to do right now, ranked by:
 *   money_at_stake × time_decay (older = more urgent) × action_weight
 *
 * Action weights (subjective but tuned to roofing-claim economics):
 *   - Needs forensic (claim sitting in 'ready' status >24h with no
 *     forensic_sent_to_carrier event): weight 1.0 — first dollar
 *   - Carrier silent (forensic sent + no scope_received in >10 days):
 *     weight 0.85 — money is on the table
 *   - Needs supplement (carrier scope received but no supplement
 *     sent in >3 days): weight 0.8 — recovery window closing
 *   - Awaiting check (supplement approved but no check_received in
 *     >14 days): weight 0.75 — collections
 *   - Needs COC (install complete but no coc_sent in >7 days):
 *     weight 0.55 — final-bill blocker
 *
 * Returns the SAME shape regardless of company size; the rendered
 * card handles empty state ("all clear") gracefully.
 */

type ActionKind =
  | "needs_forensic"
  | "carrier_silent"
  | "needs_supplement"
  | "awaiting_check"
  | "needs_coc";

const ACTION_META: Record<
  ActionKind,
  { label: string; reason: string; chipColor: string; action: string; weight: number }
> = {
  needs_forensic: {
    label: "Send forensic",
    reason: "Needs forensic",
    chipColor: "#22D8FF", // cyan
    action: "?action=send_forensic",
    weight: 1.0,
  },
  carrier_silent: {
    label: "Chase carrier",
    reason: "Carrier silent",
    chipColor: "#FACC15", // yellow
    action: "?action=chase_carrier",
    weight: 0.85,
  },
  needs_supplement: {
    label: "Send supplement",
    reason: "Needs supplement",
    chipColor: "#F97316", // orange (also misc trade color)
    action: "?action=send_supplement",
    weight: 0.8,
  },
  awaiting_check: {
    label: "Collect check",
    reason: "Awaiting check",
    chipColor: "#22C55E", // green
    action: "?action=record_check",
    weight: 0.75,
  },
  needs_coc: {
    label: "Send COC",
    reason: "Needs COC",
    chipColor: "#3B82F6", // blue
    action: "?action=send_coc",
    weight: 0.55,
  },
};

interface ClaimRow {
  id: string;
  address: string | null;
  carrier: string | null;
  status: string | null;
  user_id: string;
  assigned_user_id: string | null;
  last_touched_at: string | null;
  contractor_rcv: number | null;
  current_carrier_rcv: number | null;
  original_carrier_rcv: number | null;
}

interface EventRow {
  claim_id: string;
  event_type: string;
  occurred_at: string;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // No admin gate: the query below is team-scoped via getTeamUserIds, so any
  // authenticated user (including a fresh solo signup who is almost never
  // is_admin) gets their OWN money-ranked next actions — never another
  // company's. We only read the profile row for the email fallback that
  // getTeamUserIds needs to resolve domain-based teams.
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("email")
    .eq("user_id", user.id)
    .limit(1);

  const teamLookup = await getTeamUserIds({
    id: user.id,
    email: user.email || profileRows?.[0]?.email || null,
  });
  const teamUserIds = teamLookup.userIds;
  const repMap = new Map<string, string>();
  for (const m of teamLookup.members) {
    if (m.id && m.email) repMap.set(m.id, m.email);
  }
  if (teamUserIds.length === 0) {
    return NextResponse.json(emptyResponse());
  }

  // Active claims for the team — drop terminal statuses
  const TERMINAL = ["lost", "closed", "paid", "completed"];
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select(
      "id, address, carrier:carrier, status, user_id, assigned_user_id, last_touched_at, contractor_rcv, current_carrier_rcv, original_carrier_rcv"
    )
    .in("user_id", teamUserIds)
    .order("last_touched_at", { ascending: false })
    .limit(500);

  const claims = ((claimRows || []) as unknown as ClaimRow[]).filter(
    (c) => !c.status || !TERMINAL.includes(c.status.toLowerCase())
  );

  if (claims.length === 0) {
    return NextResponse.json(emptyResponse());
  }

  // Fetch checkpoint events in one shot (same name list as claims-grid).
  const claimIds = claims.map((c) => c.id);
  const { data: eventRows } = await supabaseAdmin
    .from("claim_events")
    .select("claim_id, event_type, occurred_at")
    .in("claim_id", claimIds)
    .in("event_type", [
      "forensic_sent_to_carrier",
      "forensic_sent_to_homeowner",
      "supplement_sent_to_carrier",
      "supplement_sent",
      "install_supplement_sent",
      "coc_sent_to_homeowner",
      "coc_sent",
      "homeowner_engagement_sent",
      "homeowner_email_sent",
      "sequence_started",
      "check_received",
      "scope_received",
      "install_complete",
    ]);

  type Slot = { done: boolean; at: string | null };
  const checkpoints = new Map<
    string,
    {
      forensic: Slot;
      supplement: Slot;
      coc: Slot;
      engagement: Slot;
      check_received: Slot;
      scope_received: Slot;
      install_complete: Slot;
    }
  >();
  for (const id of claimIds) {
    checkpoints.set(id, {
      forensic: { done: false, at: null },
      supplement: { done: false, at: null },
      coc: { done: false, at: null },
      engagement: { done: false, at: null },
      check_received: { done: false, at: null },
      scope_received: { done: false, at: null },
      install_complete: { done: false, at: null },
    });
  }
  for (const e of (eventRows || []) as EventRow[]) {
    const bucket = checkpoints.get(e.claim_id);
    if (!bucket) continue;
    let key: keyof typeof bucket | null = null;
    if (
      e.event_type === "forensic_sent_to_carrier" ||
      e.event_type === "forensic_sent_to_homeowner"
    )
      key = "forensic";
    else if (
      e.event_type === "supplement_sent_to_carrier" ||
      e.event_type === "supplement_sent" ||
      e.event_type === "install_supplement_sent"
    )
      key = "supplement";
    else if (
      e.event_type === "coc_sent_to_homeowner" ||
      e.event_type === "coc_sent"
    )
      key = "coc";
    else if (
      e.event_type === "homeowner_engagement_sent" ||
      e.event_type === "homeowner_email_sent" ||
      e.event_type === "sequence_started"
    )
      key = "engagement";
    else if (e.event_type === "check_received") key = "check_received";
    else if (e.event_type === "scope_received") key = "scope_received";
    else if (e.event_type === "install_complete") key = "install_complete";
    if (!key) continue;
    const slot = bucket[key];
    if (!slot.done || (slot.at && e.occurred_at > slot.at)) {
      bucket[key] = { done: true, at: e.occurred_at };
    }
  }

  const now = Date.now();
  const day = 86_400_000;

  // For each claim, compute the most-urgent applicable action + its score.
  interface Scored {
    claim: ClaimRow;
    kind: ActionKind;
    money: number;
    daysSince: number;
    score: number;
  }
  const scored: Scored[] = [];

  for (const c of claims) {
    const cp = checkpoints.get(c.id)!;
    const money = inferMoneyAtStake(c);
    // Most-urgent action per claim wins — checked in priority order.

    // 1) Needs forensic — never sent
    if (!cp.forensic.done) {
      const ageDays = c.last_touched_at
        ? Math.max(1, (now - new Date(c.last_touched_at).getTime()) / day)
        : 1;
      scored.push({
        claim: c,
        kind: "needs_forensic",
        money,
        daysSince: ageDays,
        score:
          money * ACTION_META.needs_forensic.weight * Math.min(1 + ageDays / 7, 3),
      });
      continue;
    }
    // 2) Carrier silent — forensic sent, no scope_received in 10+ days
    if (cp.forensic.done && !cp.scope_received.done) {
      const since = cp.forensic.at
        ? (now - new Date(cp.forensic.at).getTime()) / day
        : 0;
      if (since >= 10) {
        scored.push({
          claim: c,
          kind: "carrier_silent",
          money,
          daysSince: since,
          score:
            money * ACTION_META.carrier_silent.weight * Math.min(1 + since / 14, 3),
        });
        continue;
      }
    }
    // 3) Needs supplement — scope_received but no supplement sent in 3+ days
    if (cp.scope_received.done && !cp.supplement.done) {
      const since = cp.scope_received.at
        ? (now - new Date(cp.scope_received.at).getTime()) / day
        : 0;
      if (since >= 3) {
        scored.push({
          claim: c,
          kind: "needs_supplement",
          money,
          daysSince: since,
          score:
            money * ACTION_META.needs_supplement.weight * Math.min(1 + since / 7, 3),
        });
        continue;
      }
    }
    // 4) Awaiting check — supplement sent, no check_received in 14+ days
    if (cp.supplement.done && !cp.check_received.done) {
      const since = cp.supplement.at
        ? (now - new Date(cp.supplement.at).getTime()) / day
        : 0;
      if (since >= 14) {
        scored.push({
          claim: c,
          kind: "awaiting_check",
          money,
          daysSince: since,
          score:
            money * ACTION_META.awaiting_check.weight * Math.min(1 + since / 21, 3),
        });
        continue;
      }
    }
    // 5) Needs COC — install complete, no coc_sent in 7+ days
    if (cp.install_complete.done && !cp.coc.done) {
      const since = cp.install_complete.at
        ? (now - new Date(cp.install_complete.at).getTime()) / day
        : 0;
      if (since >= 7) {
        scored.push({
          claim: c,
          kind: "needs_coc",
          money,
          daysSince: since,
          score:
            money * ACTION_META.needs_coc.weight * Math.min(1 + since / 14, 3),
        });
      }
    }
  }

  // Sort by score desc, take top 3 for the hero cards
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);

  const totalMoney = scored.reduce((s, x) => s + x.money, 0);
  const totalActions = scored.length;

  const primary = top[0];
  const sub = primary
    ? buildSubLine(primary, repMap)
    : "";

  const priority_claims = top.map((s) => ({
    id: s.claim.id,
    address: s.claim.address,
    carrier_name: s.claim.carrier,
    rep_email: repMap.get(s.claim.assigned_user_id || s.claim.user_id) ?? null,
    reason: ACTION_META[s.kind].reason,
    reason_chip_color: ACTION_META[s.kind].chipColor,
    money_at_stake_dollars: Math.round(s.money),
    action_label: ACTION_META[s.kind].label,
    action_url: `/dashboard/claim/${s.claim.id}${ACTION_META[s.kind].action}`,
  }));

  return NextResponse.json({
    headline: `${totalActions} action${totalActions === 1 ? "" : "s"} worth $${Math.round(totalMoney).toLocaleString("en-US")}`,
    sub,
    total_money_at_stake_dollars: Math.round(totalMoney),
    total_actions: totalActions,
    priority_claims,
  });
}

function inferMoneyAtStake(c: ClaimRow): number {
  // For "needs forensic" — what we're TRYING to recover (contractor RCV or
  // delta over carrier). For others — same logic, just keeps the units
  // comparable across actions. Falls back to 0 if no figures yet.
  const ours = Number(c.contractor_rcv ?? 0);
  const carrier = Number(c.current_carrier_rcv ?? c.original_carrier_rcv ?? 0);
  if (ours > 0 && carrier > 0) return Math.max(ours - carrier, 0);
  return ours;
}

function buildSubLine(
  primary: { claim: ClaimRow; kind: ActionKind; money: number; daysSince: number },
  repMap: Map<string, string>
): string {
  const rep = repMap.get(primary.claim.assigned_user_id || primary.claim.user_id);
  const repFirst = rep
    ? rep.split("@")[0].split(/[._-]/)[0].replace(/^./, (c) => c.toUpperCase())
    : null;
  const fast =
    primary.money > 0
      ? `$${Math.round(primary.money).toLocaleString("en-US")} on the table`
      : "Money figure not yet computed";
  switch (primary.kind) {
    case "needs_forensic":
      return `Top of the queue: ${primary.claim.address ?? "your most-recent claim"} — ${fast}. ${repFirst ?? "Whoever owns it"} should ship the forensic today.`;
    case "carrier_silent":
      return `${primary.claim.carrier ?? "Carrier"} has been silent ${Math.round(primary.daysSince)}d on ${primary.claim.address ?? "your top claim"} — escalate or call the adjuster.`;
    case "needs_supplement":
      return `Scope from ${primary.claim.carrier ?? "carrier"} landed ${Math.round(primary.daysSince)}d ago on ${primary.claim.address ?? "—"}. Send the supplement before it stales.`;
    case "awaiting_check":
      return `Supplement approved ${Math.round(primary.daysSince)}d ago on ${primary.claim.address ?? "—"} — check should be in. Time to call.`;
    case "needs_coc":
      return `Install complete ${Math.round(primary.daysSince)}d ago on ${primary.claim.address ?? "—"} — COC is the gate for final bill.`;
  }
}

function emptyResponse() {
  return {
    headline: "All clear",
    sub: "",
    total_money_at_stake_dollars: 0,
    total_actions: 0,
    priority_claims: [],
  };
}
