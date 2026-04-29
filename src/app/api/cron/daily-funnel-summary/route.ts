import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";

/**
 * Daily Funnel Summary — Vercel Cron at 12:00 UTC (8am ET).
 *
 * Why this exists separate from the twice-daily funnel-monitor:
 *   - Tom needs a single number first thing every morning: actual signups
 *     and the real cost-per-signup blended across all paid traffic. CAPI
 *     under-reports Meta leads by ~30% (2026-04-29 audit), so we trust
 *     Supabase auth.users as ground truth and divide Meta spend by THAT.
 *   - The existing /api/cron/funnel-monitor is a twice-daily 5-source
 *     deep dive — too much noise for the "did the machine work yesterday"
 *     glance. This one is the morning gut-check.
 *
 * Auth: matches Bearer ${CRON_SECRET}, identical to funnel-monitor.
 *
 * Manual run:
 *   curl -X POST https://www.dumbroof.ai/api/cron/daily-funnel-summary \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */

const RECIPIENTS = [
  "tom@dumbroof.ai",
  "tkovack@usaroofmasters.com",
];

const META_API_VERSION = "v21.0";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Window = { hours: number; label: string };
const WINDOWS: Window[] = [
  { hours: 24, label: "24h" },
  { hours: 24 * 7, label: "7d" },
  { hours: 24 * 30, label: "30d" },
];

type WindowMetrics = {
  label: string;
  signups: number;
  claims_created: number;
  spend_dollars: number;
  cost_per_signup: number | null;
};

// Cached after first call within a single cron run — windows are nested so
// we only need to enumerate auth.users once and bucket by recency.
let _authUsersCache: Array<{ created_at: string }> | null = null;

/**
 * Drain auth.users via the admin API. Can't query `auth.users` directly via
 * PostgREST (only `public` + `graphql_public` are exposed — see E171 +
 * /lib/funnel-monitor/sources/supabase.ts). At ~125 users today this is one
 * RPC call per page × ~3 pages = ~600ms, well under the maxDuration.
 */
async function listAllAuthUserCreatedAt(): Promise<Array<{ created_at: string }>> {
  if (_authUsersCache) return _authUsersCache;
  const all: Array<{ created_at: string }> = [];
  let page = 1;
  const perPage = 50; // >50 returns 500 "Database error finding users" on this account
  let consecutiveEmpty = 0;
  for (let i = 0; i < 60; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 3) break;
      page += 1;
      continue;
    }
    const users = data?.users || [];
    if (users.length === 0) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 3) break;
      page += 1;
      continue;
    }
    consecutiveEmpty = 0;
    for (const u of users) all.push({ created_at: u.created_at });
    if (users.length < perPage) break;
    page += 1;
  }
  _authUsersCache = all;
  return all;
}

async function gatherSignupsAndClaims(hoursAgo: number): Promise<{
  signups: number;
  claims_created: number;
}> {
  const sinceMs = Date.now() - hoursAgo * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();

  const [users, { count: claims_created }] = await Promise.all([
    listAllAuthUserCreatedAt(),
    supabaseAdmin
      .from("claims")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso),
  ]);

  const signups = users.filter((u) => new Date(u.created_at).getTime() >= sinceMs).length;
  return { signups, claims_created: claims_created ?? 0 };
}

async function gatherMetaSpend(hoursAgo: number): Promise<number> {
  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !accountId) return 0;

  const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  const url = new URL(
    `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/insights`
  );
  url.searchParams.set("fields", "spend");
  url.searchParams.set("level", "account");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("access_token", token);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return 0;
    const body = (await res.json()) as { data?: Array<{ spend?: string }> };
    const spendStr = body.data?.[0]?.spend ?? "0";
    return parseFloat(spendStr) || 0;
  } catch {
    return 0;
  }
}

async function buildReport(): Promise<WindowMetrics[]> {
  const results = await Promise.all(
    WINDOWS.map(async (w) => {
      const [counts, spend] = await Promise.all([
        gatherSignupsAndClaims(w.hours),
        gatherMetaSpend(w.hours),
      ]);
      return {
        label: w.label,
        signups: counts.signups,
        claims_created: counts.claims_created,
        spend_dollars: spend,
        cost_per_signup: counts.signups > 0 ? spend / counts.signups : null,
      };
    })
  );
  return results;
}

function fmtMoney(dollars: number): string {
  return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtCps(cps: number | null): string {
  if (cps === null) return "—";
  return fmtMoney(cps);
}

function renderHtml(rows: WindowMetrics[]): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const yesterday = rows.find((r) => r.label === "24h");
  const week = rows.find((r) => r.label === "7d");
  const headlineSignups = yesterday?.signups ?? 0;
  const headlineCps = yesterday?.cost_per_signup ?? null;
  const tableRows = rows
    .map(
      (r) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #1a1d2e;font-weight:600;">${r.label}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #1a1d2e;text-align:right;">${r.signups}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #1a1d2e;text-align:right;">${r.claims_created}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #1a1d2e;text-align:right;">${fmtMoney(r.spend_dollars)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #1a1d2e;text-align:right;font-weight:700;color:#22c55e;">${fmtCps(r.cost_per_signup)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0d18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e7eb;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <p style="font-size:12px;color:#6b7280;letter-spacing:0.18em;text-transform:uppercase;margin:0 0 4px;">Daily Funnel Summary</p>
    <h1 style="font-size:18px;font-weight:600;color:#fff;margin:0 0 18px;">${today}</h1>

    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border:1px solid #1e293b;border-radius:14px;padding:20px;margin-bottom:18px;">
      <p style="font-size:12px;color:#9ca3af;margin:0 0 6px;letter-spacing:0.1em;text-transform:uppercase;">Yesterday</p>
      <p style="font-size:38px;font-weight:800;color:#fff;margin:0;line-height:1;">${headlineSignups} <span style="font-size:14px;font-weight:500;color:#9ca3af;">signups</span></p>
      <p style="font-size:14px;color:#22c55e;margin:8px 0 0;font-weight:600;">${fmtCps(headlineCps)} per signup</p>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#0f172a;border:1px solid #1e293b;border-radius:14px;overflow:hidden;">
      <thead>
        <tr style="background:#1e293b;">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#9ca3af;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Window</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;color:#9ca3af;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Signups</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;color:#9ca3af;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Claims</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;color:#9ca3af;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Meta spend</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;color:#9ca3af;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">CPS</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <p style="font-size:11px;color:#6b7280;margin:14px 0 0;line-height:1.5;">
      Source of truth: <code style="background:#1e293b;padding:1px 4px;border-radius:3px;">auth.users</code> (Supabase) and Meta Marketing API account-level insights.
      CPS = Meta spend ÷ Supabase signups. CAPI under-reports Meta leads ~30%, so this number is what's actually happening; trust this over what Events Manager shows.
    </p>
    <p style="font-size:11px;color:#4b5563;margin:8px 0 0;">
      7d: ${week?.signups ?? 0} signups · ${fmtMoney(week?.spend_dollars ?? 0)} spend · ${fmtCps(week?.cost_per_signup ?? null)} CPS
    </p>
  </div>
</body></html>`;
}

function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  return req.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await buildReport();
    const yesterday = rows.find((r) => r.label === "24h");
    const html = renderHtml(rows);
    const subject = `Daily: ${yesterday?.signups ?? 0} signups · ${fmtCps(yesterday?.cost_per_signup ?? null)} CPS`;

    await getResend().emails.send({
      from: EMAIL_FROM,
      to: RECIPIENTS,
      replyTo: EMAIL_REPLY_TO,
      subject,
      html,
    });

    return NextResponse.json({
      ok: true,
      windows: rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("daily-funnel-summary failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
