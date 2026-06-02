/**
 * Daily AccuLynx calendar sync (cron). For every AccuLynx-connected company,
 * pulls the company-calendar install events into DumbRoof Production (see
 * src/lib/acculynx/calendar-sync.ts). Idempotent — safe to run repeatedly.
 *
 * Auth: CRON_SECRET bearer, or the vercel-cron user-agent (same pattern as the
 * other crons, e.g. storm-alerts).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { syncCompanyCalendar, getAccuLynxCompanies } from "@/lib/acculynx/calendar-sync";

export const maxDuration = 300;

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  let companies: Array<{ company_id: string; api_key: string }> = [];
  try {
    companies = await getAccuLynxCompanies(supabaseAdmin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordHeartbeat("acculynx-calendar-sync", 1440, "error", `companies: ${msg}`, Date.now() - startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const results = [];
  let totalMatched = 0;
  let totalSchedules = 0;
  let totalErrors = 0;
  for (const c of companies) {
    try {
      const r = await syncCompanyCalendar(supabaseAdmin, c.company_id, c.api_key);
      results.push(r);
      totalMatched += r.matched;
      totalSchedules += r.schedules_upserted;
      totalErrors += r.errors.length;
    } catch (e) {
      totalErrors++;
      results.push({ company_id: c.company_id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  await recordHeartbeat(
    "acculynx-calendar-sync",
    1440,
    totalErrors > 0 && totalSchedules === 0 ? "error" : "ok",
    `companies=${companies.length} matched=${totalMatched} schedules=${totalSchedules} errors=${totalErrors}`,
    elapsedMs
  );

  return NextResponse.json({
    ok: true,
    elapsed_ms: elapsedMs,
    companies: companies.length,
    matched: totalMatched,
    schedules_upserted: totalSchedules,
    errors: totalErrors,
    results,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
