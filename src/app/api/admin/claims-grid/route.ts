import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/admin/claims-grid
 *
 * Phase 5 Slice A: company-wide claim list with checkpoint aggregation,
 * scoped to the caller's company, optionally filtered by rep + checkpoint
 * state. Powers Overview, Pipeline, and Reps page redesigns.
 *
 * Query params:
 *   filter   = all | all_lit | needs_forensic | needs_supplement |
 *              needs_coc | needs_engagement | needs_check | awaiting_production
 *   rep      = uuid (filters claims to user_id=<rep> OR assigned_user_id=<rep>)
 *   scope    = active | all  (active drops won/lost/closed/paid)
 *   limit    = N (default 200)
 *
 * Returns:
 *   {
 *     claims: [...],
 *     counts: { all, all_lit, needs_forensic, needs_supplement, needs_coc,
 *               needs_engagement, needs_check, awaiting_production },
 *     reps: [{ user_id, email, name, claim_count, checks_collected }]
 *   }
 */

type Filter =
  | "all"
  | "all_lit"
  | "needs_forensic"
  | "needs_supplement"
  | "needs_coc"
  | "needs_engagement"
  | "needs_check"
  | "awaiting_production";

interface ClaimRow {
  id: string;
  address: string | null;
  homeowner_name: string | null;
  carrier_name: string | null;
  status: string | null;
  user_id: string;
  assigned_user_id: string | null;
  last_touched_at: string | null;
  created_at: string | null;
  financials: { total?: number } | null;
}

interface EventRow {
  claim_id: string;
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
}

interface CheckpointSlot {
  done: boolean;
  at: string | null;
}

interface Checkpoints {
  forensic: CheckpointSlot;
  supplement: CheckpointSlot;
  coc: CheckpointSlot;
  engagement: CheckpointSlot;
  check_received: CheckpointSlot & { amount_cents?: number | null };
}

interface EnrichedClaim {
  id: string;
  address: string | null;
  homeowner_name: string | null;
  carrier_name: string | null;
  status: string | null;
  rep_user_id: string;
  rep_email: string | null;
  last_touched_at: string | null;
  financials: { total?: number } | null;
  checkpoints: Checkpoints;
  is_scheduled: boolean;
  all_lit: boolean;
}

const TERMINAL_STATUSES = new Set(["lost", "closed", "paid", "completed"]);

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows, error: profileErr } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    console.log(`[cg-dbg] uid=${user.id} rows=${profileRows?.length ?? 0} err=${profileErr?.message ?? "none"} admin=${profileRows?.[0]?.is_admin} cid=${profileRows?.[0]?.company_id} -> 403`);
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;
  if (!companyId) {
    console.log(`[cg-dbg] uid=${user.id} admin=true cid=NULL -> early-exit-empty`);
    return NextResponse.json({ claims: [], counts: emptyCounts(), reps: [] });
  }

  const url = new URL(req.url);
  const filter = (url.searchParams.get("filter") || "all") as Filter;
  const repFilter = url.searchParams.get("rep");
  const scope = url.searchParams.get("scope") || "active";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200"), 500);

  // 1. Pull team members so we can hydrate rep names + render the rep selector
  const { data: teamProfiles } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id, email")
    .eq("company_id", companyId);

  const repMap = new Map<string, string>();
  for (const p of teamProfiles || []) {
    if (p.user_id && p.email) repMap.set(p.user_id as string, p.email as string);
  }
  const teamUserIds = Array.from(repMap.keys());

  // 2. Pull claims for the whole team (or just one rep if filter set)
  let claimsQuery = supabaseAdmin
    .from("claims")
    .select(
      "id, address, homeowner_name, carrier_name, status, user_id, assigned_user_id, last_touched_at, created_at, financials"
    )
    .eq("company_id", companyId)
    .order("last_touched_at", { ascending: false })
    .limit(limit);

  if (repFilter) {
    claimsQuery = claimsQuery.or(
      `user_id.eq.${repFilter},assigned_user_id.eq.${repFilter}`
    );
  } else if (teamUserIds.length > 0) {
    // Defense-in-depth: also constrain to team users (company_id should already do it)
    claimsQuery = claimsQuery.in("user_id", teamUserIds);
  }

  const { data: claimRows, error: claimsErr } = await claimsQuery;
  const claims = (claimRows || []) as ClaimRow[];
  console.log(`[cg-dbg] cid=${companyId} team=${teamUserIds.length} rep=${repFilter ?? "-"} rows=${claims.length} err=${claimsErr?.message ?? "none"}`);

  if (claims.length === 0) {
    return NextResponse.json({
      claims: [],
      counts: emptyCounts(),
      reps: buildRepRollup(repMap, []),
    });
  }

  const claimIds = claims.map((c) => c.id);

  // 3. Pull all checkpoint events in one shot.
  // Accept BOTH the names Phase 1 invented AND the legacy names that the
  // actual emitters use (backend/main.py:2253-2255 maps tool→event_type).
  // QA Phase 5 Slice A found that w/o legacy names, every USARM claim
  // shows "needs supplement / needs COC / needs engagement" on day 1.
  const { data: eventRows } = await supabaseAdmin
    .from("claim_events")
    .select("claim_id, event_type, occurred_at, metadata")
    .in("claim_id", claimIds)
    .in("event_type", [
      // forensic
      "forensic_sent_to_carrier",
      "forensic_sent_to_homeowner",
      // supplement (legacy: supplement_sent, install_supplement_sent; new: …_to_carrier)
      "supplement_sent_to_carrier",
      "supplement_sent",
      "install_supplement_sent",
      // coc (legacy: coc_sent; new: …_to_homeowner)
      "coc_sent_to_homeowner",
      "coc_sent",
      // homeowner engagement (legacy: homeowner_email_sent, sequence_started; new: …_sent)
      "homeowner_engagement_sent",
      "homeowner_email_sent",
      "sequence_started",
      // money
      "check_received",
    ]);

  // 4. Aggregate checkpoints per claim
  const checkpointsByClaim = new Map<string, Checkpoints>();
  for (const id of claimIds) {
    checkpointsByClaim.set(id, emptyCheckpoints());
  }
  for (const e of (eventRows || []) as EventRow[]) {
    const bucket = checkpointsByClaim.get(e.claim_id);
    if (!bucket) continue;
    const key = mapEventToCheckpoint(e.event_type);
    if (!key) continue;
    const slot = bucket[key];
    if (!slot.done || (slot.at && e.occurred_at > slot.at)) {
      bucket[key] = { done: true, at: e.occurred_at };
      if (key === "check_received" && e.metadata?.amount_cents) {
        (bucket.check_received as CheckpointSlot & { amount_cents?: number }).amount_cents =
          e.metadata.amount_cents as number;
      }
    }
  }

  // 5. Pull production-ready signal (for "awaiting_production" filter)
  // A claim is "awaiting production" if status is 'won' or 'ready' AND no
  // production_schedules row exists. Schedules table is Phase 2.
  const { data: scheduleRows } = await supabaseAdmin
    .from("production_schedules")
    .select("claim_id, status")
    .in("claim_id", claimIds)
    .in("status", ["scheduled", "in_progress", "completed"]);
  const scheduledClaimIds = new Set(
    (scheduleRows || []).map((s) => s.claim_id as string)
  );

  // 6. Build enriched + filtered rows
  const enriched: EnrichedClaim[] = claims.map((c) => {
    const checkpoints = checkpointsByClaim.get(c.id)!;
    const repId = c.assigned_user_id || c.user_id;
    return {
      id: c.id,
      address: c.address,
      homeowner_name: c.homeowner_name,
      carrier_name: c.carrier_name,
      status: c.status,
      rep_user_id: repId,
      rep_email: repMap.get(repId) ?? null,
      last_touched_at: c.last_touched_at,
      financials: c.financials,
      checkpoints,
      is_scheduled: scheduledClaimIds.has(c.id),
      all_lit: isAllLit(checkpoints),
    };
  });

  // Scope filter (active = drop terminal statuses)
  const scoped =
    scope === "all"
      ? enriched
      : enriched.filter(
          (c) => !c.status || !TERMINAL_STATUSES.has(c.status.toLowerCase())
        );

  // Counts BEFORE filter (so filter chips can show totals across all)
  const counts = computeCounts(scoped);

  // Apply the requested filter
  const filtered = applyFilter(scoped, filter);

  return NextResponse.json({
    claims: filtered,
    counts,
    reps: buildRepRollup(repMap, scoped),
  });
}

// Maps every event_type variant (new + legacy) to the canonical checkpoint slot.
function mapEventToCheckpoint(
  eventType: string
): keyof Checkpoints | null {
  switch (eventType) {
    case "forensic_sent_to_carrier":
    case "forensic_sent_to_homeowner":
      return "forensic";
    case "supplement_sent_to_carrier":
    case "supplement_sent":
    case "install_supplement_sent":
      return "supplement";
    case "coc_sent_to_homeowner":
    case "coc_sent":
      return "coc";
    case "homeowner_engagement_sent":
    case "homeowner_email_sent":
    case "sequence_started":
      return "engagement";
    case "check_received":
      return "check_received";
    default:
      return null;
  }
}

function emptyCheckpoints(): Checkpoints {
  return {
    forensic: { done: false, at: null },
    supplement: { done: false, at: null },
    coc: { done: false, at: null },
    engagement: { done: false, at: null },
    check_received: { done: false, at: null },
  };
}

function emptyCounts() {
  return {
    all: 0,
    all_lit: 0,
    needs_forensic: 0,
    needs_supplement: 0,
    needs_coc: 0,
    needs_engagement: 0,
    needs_check: 0,
    awaiting_production: 0,
  };
}

function isAllLit(cp: Checkpoints): boolean {
  return (
    cp.forensic.done &&
    cp.supplement.done &&
    cp.coc.done &&
    cp.engagement.done &&
    cp.check_received.done
  );
}

function computeCounts(claims: EnrichedClaim[]) {
  const c = emptyCounts();
  c.all = claims.length;
  for (const claim of claims) {
    if (claim.all_lit) c.all_lit++;
    if (!claim.checkpoints.forensic.done) c.needs_forensic++;
    if (!claim.checkpoints.supplement.done) c.needs_supplement++;
    if (!claim.checkpoints.coc.done) c.needs_coc++;
    if (!claim.checkpoints.engagement.done) c.needs_engagement++;
    if (!claim.checkpoints.check_received.done) c.needs_check++;
    const s = (claim.status ?? "").toLowerCase();
    if ((s === "won" || s === "ready") && !claim.is_scheduled) {
      c.awaiting_production++;
    }
  }
  return c;
}

function applyFilter(claims: EnrichedClaim[], filter: Filter): EnrichedClaim[] {
  switch (filter) {
    case "all":
      return claims;
    case "all_lit":
      return claims.filter((c) => c.all_lit);
    case "needs_forensic":
      return claims.filter((c) => !c.checkpoints.forensic.done);
    case "needs_supplement":
      return claims.filter((c) => !c.checkpoints.supplement.done);
    case "needs_coc":
      return claims.filter((c) => !c.checkpoints.coc.done);
    case "needs_engagement":
      return claims.filter((c) => !c.checkpoints.engagement.done);
    case "needs_check":
      return claims.filter((c) => !c.checkpoints.check_received.done);
    case "awaiting_production":
      return claims.filter((c) => {
        const s = (c.status ?? "").toLowerCase();
        return (s === "won" || s === "ready") && !c.is_scheduled;
      });
    default:
      return claims;
  }
}

function buildRepRollup(repMap: Map<string, string>, claims: EnrichedClaim[]) {
  const byRep = new Map<
    string,
    { claim_count: number; checks_collected: number; all_lit: number }
  >();
  for (const c of claims) {
    if (!c.rep_user_id) continue;
    const bucket = byRep.get(c.rep_user_id) ?? {
      claim_count: 0,
      checks_collected: 0,
      all_lit: 0,
    };
    bucket.claim_count++;
    if (c.checkpoints.check_received.done) bucket.checks_collected++;
    if (c.all_lit) bucket.all_lit++;
    byRep.set(c.rep_user_id, bucket);
  }
  return Array.from(byRep.entries()).map(([user_id, stats]) => ({
    user_id,
    email: repMap.get(user_id) ?? null,
    ...stats,
  }));
}
