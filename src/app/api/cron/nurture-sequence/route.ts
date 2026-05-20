import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import {
  TOUCH_SPECS,
  deriveFirstName,
  type NurtureTouchKey,
} from "@/lib/nurture/templates";

export const maxDuration = 300;

const FROM = "Tom Kovack <tom@dumbroof.ai>";
const REPLY_TO = "tom@dumbroof.ai";
const INTERNAL_DIGEST_RECIPIENT = "tom@dumbroof.ai";

/** Required fields for a "completed" company_profile. Mirrors enrich-incomplete-profiles. */
const REQUIRED_PROFILE_FIELDS = [
  "company_name",
  "contact_name",
  "address",
  "city_state_zip",
  "phone",
] as const;

interface NurtureSettings {
  nurture_sent_at?: Partial<Record<NurtureTouchKey, string>>;
  /** Set to true once user replies to any nurture email — exits sequence. */
  nurture_opted_out?: boolean;
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  company_name: string | null;
  contact_name: string | null;
  address: string | null;
  city_state_zip: string | null;
  phone: string | null;
  website: string | null;
  logo_path: string | null;
  settings: NurtureSettings | null;
}

interface PlatformUserRow {
  id: string;
  email: string | null;
  created_at: string | null;
}

interface PerTouchResult {
  touch: NurtureTouchKey;
  count_sent: number;
  count_skipped: number;
  errors: Array<{ email: string; error: string }>;
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Pull every platform user via the SECURITY DEFINER RPC (auth.admin.listUsers is unreliable). */
async function listPlatformUsers(): Promise<PlatformUserRow[]> {
  const { data, error } = await supabaseAdmin.rpc("list_platform_users");
  if (error) {
    console.error("[nurture-cron] list_platform_users RPC failed:", error.message);
    return [];
  }
  return (data as PlatformUserRow[] | null) || [];
}

/** Returns the set of user_ids that have at least one claim. */
async function getUsersWithClaims(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  // Page through in chunks of 1000 to stay under PostgREST array limits.
  const have = new Set<string>();
  const CHUNK = 1000;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("claims")
      .select("user_id")
      .in("user_id", chunk);
    if (error) {
      console.error("[nurture-cron] claims lookup failed:", error.message);
      continue;
    }
    for (const r of (data || []) as Array<{ user_id: string }>) {
      have.add(r.user_id);
    }
  }
  return have;
}

/** Pull company_profiles rows for these user_ids. */
async function getProfiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  const out = new Map<string, ProfileRow>();
  if (userIds.length === 0) return out;
  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("company_profiles")
      .select(
        "user_id, email, company_name, contact_name, address, city_state_zip, phone, website, logo_path, settings"
      )
      .in("user_id", chunk);
    if (error) {
      console.error("[nurture-cron] company_profiles lookup failed:", error.message);
      continue;
    }
    for (const r of (data || []) as ProfileRow[]) {
      out.set(r.user_id, r);
    }
  }
  return out;
}

/** A profile is "activated" when every required field is filled AND user has a claim. */
function isActivated(p: ProfileRow | undefined, hasClaim: boolean): boolean {
  if (!hasClaim) return false;
  if (!p) return false;
  for (const f of REQUIRED_PROFILE_FIELDS) {
    if (!p[f]) return false;
  }
  return true;
}

/** Persist nurture_sent_at[touch] = nowIso on company_profiles.settings. Upserts the row if missing. */
async function recordSent(userId: string, touch: NurtureTouchKey, existing: ProfileRow | undefined): Promise<void> {
  const prevSettings = (existing?.settings as NurtureSettings | null) || {};
  const prevMap = prevSettings.nurture_sent_at || {};
  const newSettings: NurtureSettings = {
    ...prevSettings,
    nurture_sent_at: { ...prevMap, [touch]: new Date().toISOString() },
  };

  if (existing) {
    const { error } = await supabaseAdmin
      .from("company_profiles")
      .update({ settings: newSettings })
      .eq("user_id", userId);
    if (error) console.error(`[nurture-cron] settings update failed for ${userId}:`, error.message);
  } else {
    // Rowless user — insert a stub so we can dedupe future touches.
    const { error } = await supabaseAdmin
      .from("company_profiles")
      .insert({ user_id: userId, settings: newSettings });
    if (error) console.error(`[nurture-cron] settings insert failed for ${userId}:`, error.message);
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const resend = getResend();
  const now = Date.now();

  // ---------------------------------------------------------------------------
  // 1) Pull universe of platform users (capped lookback — anyone older than the
  //    last-touch window can never qualify again).
  // ---------------------------------------------------------------------------
  const MAX_LOOKBACK_HOURS = TOUCH_SPECS[TOUCH_SPECS.length - 1].windowEndHours;
  const earliestSignup = now - MAX_LOOKBACK_HOURS * 3600 * 1000;

  const allUsers = await listPlatformUsers();
  const candidates = allUsers.filter((u) => {
    if (!u.email || !u.created_at) return false;
    const created = Date.parse(u.created_at);
    if (!Number.isFinite(created)) return false;
    return created >= earliestSignup;
  });

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, touches: [], summary: "no candidates in window" });
  }

  const candidateIds = candidates.map((c) => c.id);

  // ---------------------------------------------------------------------------
  // 2) Determine who has a claim (instant exit) and who has a profile row.
  // ---------------------------------------------------------------------------
  const [usersWithClaims, profileMap] = await Promise.all([
    getUsersWithClaims(candidateIds),
    getProfiles(candidateIds),
  ]);

  // ---------------------------------------------------------------------------
  // 3) Walk each touch in order. For each touch, pick the candidates whose
  //    signup age is in the window AND who haven't received this touch AND who
  //    aren't activated AND haven't opted out.
  // ---------------------------------------------------------------------------
  const results: PerTouchResult[] = [];
  const sentSummary: Array<{ touch: NurtureTouchKey; email: string; company: string }> = [];

  for (const spec of TOUCH_SPECS) {
    const r: PerTouchResult = {
      touch: spec.key,
      count_sent: 0,
      count_skipped: 0,
      errors: [],
    };

    for (const u of candidates) {
      const created = Date.parse(u.created_at as string);
      const ageHours = (now - created) / 3_600_000;
      if (ageHours < spec.windowStartHours || ageHours >= spec.windowEndHours) {
        continue;
      }

      const profile = profileMap.get(u.id);
      const hasClaim = usersWithClaims.has(u.id);

      // Exit conditions: created a claim, activated, or opted out.
      if (hasClaim) {
        r.count_skipped++;
        continue;
      }
      if (isActivated(profile, hasClaim)) {
        r.count_skipped++;
        continue;
      }
      const settings = (profile?.settings as NurtureSettings | null) || {};
      if (settings.nurture_opted_out) {
        r.count_skipped++;
        continue;
      }
      if (settings.nurture_sent_at?.[spec.key]) {
        r.count_skipped++;
        continue;
      }

      const recipientEmail = u.email || profile?.email || null;
      if (!recipientEmail) {
        r.count_skipped++;
        continue;
      }

      const firstName = deriveFirstName({
        contact_name: profile?.contact_name,
        email: recipientEmail,
      });
      const companyName = (profile?.company_name || "").trim();
      const { subject, html } = spec.build({
        first_name: firstName,
        company_name: companyName,
        email: recipientEmail,
      });

      try {
        const { error: sendErr } = await resend.emails.send({
          from: FROM,
          to: [recipientEmail],
          replyTo: REPLY_TO,
          subject,
          html,
          tags: [
            { name: "type", value: "nurture" },
            { name: "touch", value: spec.key },
          ],
        });
        if (sendErr) {
          r.errors.push({ email: recipientEmail, error: sendErr.message });
          continue;
        }
        await recordSent(u.id, spec.key, profile);
        r.count_sent++;
        sentSummary.push({
          touch: spec.key,
          email: recipientEmail,
          company: companyName || "(no company on file)",
        });
      } catch (err) {
        r.errors.push({ email: recipientEmail, error: String(err) });
      }
    }

    results.push(r);
  }

  // ---------------------------------------------------------------------------
  // 4) Internal digest to Tom — only if something fired or something errored.
  // ---------------------------------------------------------------------------
  const totalSent = results.reduce((acc, r) => acc + r.count_sent, 0);
  const totalErrors = results.reduce((acc, r) => acc + r.errors.length, 0);

  if (totalSent > 0 || totalErrors > 0) {
    try {
      const rows = results
        .map(
          (r) =>
            `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${r.touch}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.count_sent}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.count_skipped}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:${r.errors.length ? "#dc2626" : "#6b7280"};">${r.errors.length}</td></tr>`
        )
        .join("");

      const sentList = sentSummary
        .slice(0, 50)
        .map((s) => `<li><strong>${s.touch}</strong> → ${s.email} <span style="color:#6b7280;">(${s.company})</span></li>`)
        .join("");

      const errorList = results
        .flatMap((r) => r.errors.map((e) => `<li><strong>${r.touch}</strong> → ${e.email}: <code>${e.error}</code></li>`))
        .join("");

      const elapsedMs = Date.now() - startedAt;
      const digestHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;color:#1a1a2e;line-height:1.5;">
  <h2 style="margin:0 0 12px;">Nurture sequence — daily digest</h2>
  <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">Run completed in ${elapsedMs}ms · ${totalSent} sent · ${totalErrors} errors</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <thead><tr style="background:#f3f4f6;text-align:left;">
      <th style="padding:8px 12px;">Touch</th>
      <th style="padding:8px 12px;text-align:right;">Sent</th>
      <th style="padding:8px 12px;text-align:right;">Skipped</th>
      <th style="padding:8px 12px;text-align:right;">Errors</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${sentList ? `<h3 style="margin:24px 0 8px;font-size:14px;">Sent today</h3><ul style="margin:0;padding-left:20px;font-size:13px;">${sentList}</ul>` : ""}
  ${errorList ? `<h3 style="margin:24px 0 8px;font-size:14px;color:#dc2626;">Errors</h3><ul style="margin:0;padding-left:20px;font-size:13px;">${errorList}</ul>` : ""}
</div>`;

      await resend.emails.send({
        from: FROM,
        to: [INTERNAL_DIGEST_RECIPIENT],
        replyTo: REPLY_TO,
        subject: `[nurture] ${totalSent} sent, ${totalErrors} errors`,
        html: digestHtml,
        tags: [
          { name: "type", value: "internal-digest" },
          { name: "cron", value: "nurture-sequence" },
        ],
      });
    } catch (digestErr) {
      console.error("[nurture-cron] internal digest send failed:", digestErr);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  await recordHeartbeat(
    "nurture-sequence",
    1440, // daily
    totalErrors > 0 && totalSent === 0 ? "error" : "ok",
    `sent=${totalSent}, errors=${totalErrors}, candidates=${candidates.length}`,
    elapsedMs,
  );

  return NextResponse.json({
    ok: true,
    elapsed_ms: elapsedMs,
    total_sent: totalSent,
    total_errors: totalErrors,
    touches: results,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
