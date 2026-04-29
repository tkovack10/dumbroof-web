import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";
import { PLANS, type PlanId } from "@/lib/stripe-config";

const FROM = "Tom Kovack <tom@dumbroof.ai>";
const REPLY_TO = "tom@dumbroof.ai";

type Stage =
  | "near_cap"
  | "at_cap"
  | "monthly_cap"
  | "renewal_in_3d"
  | "overage_first"
  | "overage_milestone_5"
  | "overage_milestone_10"
  | "overage_milestone_25"
  | "overage_daily_digest";

interface SubRow {
  user_id: string;
  plan_id: string;
  status: string;
  claims_used_this_period: number;
  lifetime_claims_used: number;
  current_period_end: string | null;
  overage_this_period: number | null;
}

const INTERNAL_DIGEST_RECIPIENT = "tom@dumbroof.ai";

function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  return req.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function getUserEmail(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email || null;
}

function wrap(heading: string, body: string): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e;">
  <div style="background:linear-gradient(135deg,#0d2137 0%,#1a3a5c 100%);padding:32px;border-radius:12px 12px 0 0;">
    <h1 style="color:#fff;font-size:22px;margin:0;">${heading}</h1>
  </div>
  <div style="padding:32px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;font-size:15px;line-height:1.6;color:#374151;">
    ${body}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
    <p style="font-size:13px;color:#6b7280;margin:0 0 6px;">— Tom Kovack, Founder · DumbRoof.ai</p>
    <p style="font-size:12px;color:#9ca3af;margin:0;">Reply to this email and it lands in my inbox. <a href="https://www.dumbroof.ai/unsubscribe" style="color:#9ca3af;text-decoration:underline;">unsubscribe</a></p>
  </div>
</div>`;
}

function nearCapHtml(): string {
  return wrap(
    "One free claim left",
    `<p>Heads up — you have <strong>1 free claim remaining</strong> on your DumbRoof account.</p>
     <p>If your team is building real claims with this, the Company plan ($499/mo, 8 claims) usually pays for itself on the first supplement that gets approved. Most folks see 30–60% movement on carrier scopes on top of every documented supplement.</p>
     <p style="text-align:center;margin:28px 0;">
       <a href="https://www.dumbroof.ai/pricing" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">See plans →</a>
     </p>
     <p>Questions? Reply and I'll answer personally.</p>`
  );
}

function atCapHtml(): string {
  return wrap(
    "You're at your free claim limit",
    `<p>You've used all 3 free claims — nice. Means you're actually getting work done with this thing.</p>
     <p>To keep submitting, you'll need a paid plan. Most teams start on Company ($499/mo, 8 claims, 2 users included). If you're processing 15+ claims/month, Growth ($999/mo, 20 claims) is the better math.</p>
     <p style="text-align:center;margin:28px 0;">
       <a href="https://www.dumbroof.ai/pricing" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">Pick a plan →</a>
     </p>
     <p>If you want me to run your numbers and recommend the right tier, just reply with: how many claims/month, how many users, and what your average ticket is. I'll come back with the math.</p>`
  );
}

function monthlyCapHtml(planName: string, limit: number): string {
  return wrap(
    `Approaching your ${planName} monthly cap`,
    `<p>You've used 90% of your <strong>${limit} monthly claims</strong> on the ${planName} plan.</p>
     <p>If you regularly hit cap, the next tier up is usually cheaper than the time spent rationing claims. Want me to look at your last 30 days and recommend a plan that fits?</p>
     <p style="text-align:center;margin:28px 0;">
       <a href="https://www.dumbroof.ai/dashboard/settings" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">Upgrade plan →</a>
     </p>`
  );
}

function overageFirstHtml(planName: string, monthlyCap: number, renewalDate: string): string {
  return wrap(
    `Heads up — your first $75 overage claim`,
    `<p>You just submitted a claim past your <strong>${planName}</strong> plan's ${monthlyCap}-claim monthly cap.</p>
     <p>That claim — and any others until your <strong>${renewalDate}</strong> renewal — is billed at <strong>$75 each</strong> on top of your subscription. The next invoice will roll it all up.</p>
     <p>If you keep going past cap regularly, the next-tier plan is usually cheaper than the per-claim math.</p>
     <p style="text-align:center;margin:28px 0;">
       <a href="https://www.dumbroof.ai/dashboard/settings" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">See plans →</a>
     </p>
     <p>Reply if you want me to run the math for your last 30 days and recommend a plan.</p>`
  );
}

function overageMilestoneHtml(
  planName: string,
  overageCount: number,
  nextTier: { name: string; price: number; cap: number } | null
): string {
  const overageBilled = overageCount * 75;
  return wrap(
    `You're at +${overageCount} overage claims this cycle`,
    `<p>You've submitted <strong>${overageCount} claim${overageCount === 1 ? "" : "s"}</strong> past your ${planName} cap — about <strong>$${overageBilled.toLocaleString()} in overage</strong> on your next invoice.</p>
     ${
       nextTier
         ? `<p>The math: ${nextTier.name} is <strong>$${nextTier.price}/mo</strong> with <strong>${nextTier.cap} included claims</strong>. At your current pace you'd save money switching this cycle.</p>
            <p style="text-align:center;margin:28px 0;">
              <a href="https://www.dumbroof.ai/dashboard/settings" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">Upgrade to ${nextTier.name} →</a>
            </p>`
         : `<p>If you're consistently running this volume, want to chat about a custom plan? Reply and I'll send a Calendly link.</p>`
     }`
  );
}

function dailyDigestHtml(rows: Array<{
  user_email: string;
  plan_name: string;
  overage_count: number;
  overage_dollars: number;
  meter_status_breakdown: string;
}>): string {
  const total = rows.reduce((s, r) => s + r.overage_count, 0);
  const dollars = rows.reduce((s, r) => s + r.overage_dollars, 0);
  const tableRows = rows
    .map(
      (r) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${r.user_email}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${r.plan_name}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.overage_count}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">$${r.overage_dollars.toLocaleString()}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;">${r.meter_status_breakdown}</td></tr>`
    )
    .join("");
  return wrap(
    `Overage digest — last 24h`,
    `<p>${total} overage claim${total === 1 ? "" : "s"} fired in the last 24 hours · <strong>$${dollars.toLocaleString()}</strong> queued for next invoice.</p>
     <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
       <thead><tr style="background:#f3f4f6;"><th style="padding:8px 12px;text-align:left;">User</th><th style="padding:8px 12px;text-align:left;">Plan</th><th style="padding:8px 12px;text-align:right;">Overage</th><th style="padding:8px 12px;text-align:right;">Billed</th><th style="padding:8px 12px;text-align:left;">Meter Status</th></tr></thead>
       <tbody>${tableRows}</tbody>
     </table>
     <p style="font-size:13px;color:#6b7280;">Failed meter events are auto-retried by /api/cron/reconcile-overage at 16:30 UTC daily.</p>`
  );
}

function renewalIn3dHtml(planName: string, price: number, renewalDate: string): string {
  return wrap(
    "Your DumbRoof renewal is in 3 days",
    `<p>Quick heads up — your <strong>${planName}</strong> subscription renews on <strong>${renewalDate}</strong> for $${price.toLocaleString()}.</p>
     <p>You don't need to do anything if you're staying on. Card on file will be charged automatically.</p>
     <p>Want to change plan, update card, or cancel? <a href="https://www.dumbroof.ai/dashboard/settings" style="color:#2563eb;font-weight:600;">Manage your subscription →</a></p>
     <p style="font-size:13px;color:#6b7280;">Reply if anything looks off — I'll get on it.</p>`
  );
}

async function alreadySent(userId: string, stage: Stage, periodKey: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("upgrade_email_sends")
    .select("id")
    .eq("user_id", userId)
    .eq("stage", stage)
    .eq("period_key", periodKey)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function send(
  userId: string,
  stage: Stage,
  periodKey: string,
  subject: string,
  html: string,
  results: Record<Stage, { sent: number; skipped: number; failed: number }>
): Promise<void> {
  if (await alreadySent(userId, stage, periodKey)) {
    results[stage].skipped++;
    return;
  }
  const email = await getUserEmail(userId);
  if (!email) {
    results[stage].failed++;
    return;
  }
  try {
    const { data: sent, error: sendErr } = await getResend().emails.send({
      from: FROM,
      to: [email],
      replyTo: REPLY_TO,
      subject,
      html,
      tags: [
        { name: "type", value: "upgrade" },
        { name: "stage", value: stage },
      ],
    });
    if (sendErr) {
      console.error(`[UPGRADE] send failed ${stage} ${email}:`, sendErr.message);
      results[stage].failed++;
      return;
    }
    const { error: recErr } = await supabaseAdmin.from("upgrade_email_sends").insert({
      user_id: userId,
      stage,
      period_key: periodKey,
      email_id: sent?.id,
    });
    if (recErr?.code === "23505") {
      results[stage].skipped++;
    } else if (recErr) {
      console.error(`[UPGRADE] record failed ${stage} ${email}:`, recErr.message);
      results[stage].failed++;
    } else {
      results[stage].sent++;
    }
  } catch (e) {
    console.error(`[UPGRADE] exception ${stage} ${email}:`, e);
    results[stage].failed++;
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<Stage, { sent: number; skipped: number; failed: number }> = {
    near_cap: { sent: 0, skipped: 0, failed: 0 },
    at_cap: { sent: 0, skipped: 0, failed: 0 },
    monthly_cap: { sent: 0, skipped: 0, failed: 0 },
    renewal_in_3d: { sent: 0, skipped: 0, failed: 0 },
    overage_first: { sent: 0, skipped: 0, failed: 0 },
    overage_milestone_5: { sent: 0, skipped: 0, failed: 0 },
    overage_milestone_10: { sent: 0, skipped: 0, failed: 0 },
    overage_milestone_25: { sent: 0, skipped: 0, failed: 0 },
    overage_daily_digest: { sent: 0, skipped: 0, failed: 0 },
  };

  // Pull active subscriptions in one shot (small table — < 10K rows expected
  // for the foreseeable future)
  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, plan_id, status, claims_used_this_period, lifetime_claims_used, current_period_end, overage_this_period")
    .eq("status", "active")
    .returns<SubRow[]>();

  if (error || !subs) {
    console.error("[UPGRADE] subscriptions query failed", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const now = Date.now();
  const periodLifetime = "lifetime";
  const periodMonthly = new Date().toISOString().slice(0, 7); // 2026-04 — one stage send per cycle

  for (const sub of subs) {
    const planId = sub.plan_id as PlanId;
    const plan = PLANS[planId];

    if (planId === "starter") {
      const cap = plan?.lifetimeCap ?? 3;
      const remaining = Math.max(0, cap - sub.lifetime_claims_used);
      if (remaining === 1) {
        await send(sub.user_id, "near_cap", periodLifetime, "1 free claim left on DumbRoof", nearCapHtml(), results);
      } else if (remaining === 0) {
        await send(sub.user_id, "at_cap", periodLifetime, "You're out of free claims — what's next", atCapHtml(), results);
      }
      continue;
    }

    if (planId === "sales_rep") {
      // Pay-per-claim — no cap email logic
      continue;
    }

    // Pro / Growth / Enterprise — monthly cap + renewal warning
    const monthlyCap = plan?.claimsPerMonth ?? 0;
    if (monthlyCap > 0 && sub.claims_used_this_period >= Math.floor(monthlyCap * 0.9)) {
      await send(
        sub.user_id,
        "monthly_cap",
        periodMonthly,
        `You're at 90% of your ${plan.name} monthly cap`,
        monthlyCapHtml(plan.name, monthlyCap),
        results
      );
    }

    // Overage milestone emails (paid plans only)
    const overage = sub.overage_this_period ?? 0;
    if (monthlyCap > 0 && overage > 0) {
      const renewalDateStr = sub.current_period_end
        ? new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric" })
        : "your next renewal";

      // First overage of the cycle (period_key tied to renewal date so it
      // doesn't refire on subsequent overage claims in the same cycle)
      const overagePeriodKey = sub.current_period_end?.slice(0, 10) ?? periodMonthly;
      if (overage >= 1) {
        await send(
          sub.user_id,
          "overage_first",
          overagePeriodKey,
          `Heads up — first $75 overage claim on DumbRoof`,
          overageFirstHtml(plan.name, monthlyCap, renewalDateStr),
          results
        );
      }

      const milestones: Array<[number, Stage]> = [
        [5, "overage_milestone_5"],
        [10, "overage_milestone_10"],
        [25, "overage_milestone_25"],
      ];
      for (const [threshold, stage] of milestones) {
        if (overage >= threshold) {
          // Pull the next-tier upsell math for the email body.
          const nextTier =
            planId === "pro"
              ? { name: "Growth", price: 999, cap: 20 }
              : planId === "growth"
              ? { name: "Max", price: 2999, cap: 100 }
              : null;
          await send(
            sub.user_id,
            stage,
            overagePeriodKey,
            `+${overage} overage claims on your ${plan.name} plan`,
            overageMilestoneHtml(plan.name, overage, nextTier),
            results
          );
        }
      }
    }

    if (sub.current_period_end) {
      const endMs = new Date(sub.current_period_end).getTime();
      const daysToEnd = (endMs - now) / 86_400_000;
      if (daysToEnd > 0 && daysToEnd <= 3) {
        const renewalDate = new Date(endMs).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
        });
        // period_key uses the renewal date so we send once per cycle
        const periodRenewal = sub.current_period_end.slice(0, 10);
        await send(
          sub.user_id,
          "renewal_in_3d",
          periodRenewal,
          `Your DumbRoof renewal is in 3 days`,
          renewalIn3dHtml(plan.name, plan.price, renewalDate),
          results
        );
      }
    }
  }

  // Daily digest to tom@dumbroof.ai — 24h overage activity summary.
  // period_key = YYYY-MM-DD ensures one digest per UTC day.
  await sendDailyDigest(results);

  console.log("[UPGRADE] run complete:", JSON.stringify(results));
  return NextResponse.json({ ok: true, results });
}

async function sendDailyDigest(
  results: Record<Stage, { sent: number; skipped: number; failed: number }>
): Promise<void> {
  const todayKey = new Date().toISOString().slice(0, 10);

  // Look up the synthetic recipient row in auth.users for tom@dumbroof.ai.
  // We need a real user_id for the upgrade_email_sends FK + dedupe.
  const { data: tomUser } = await supabaseAdmin.auth.admin
    .listUsers({ page: 1, perPage: 100 });
  const tomRecord = tomUser?.users?.find((u) => u.email === INTERNAL_DIGEST_RECIPIENT);
  if (!tomRecord) {
    console.warn("[UPGRADE] daily digest: no auth.users row for", INTERNAL_DIGEST_RECIPIENT);
    return;
  }

  // Already-sent guard
  const { data: existing } = await supabaseAdmin
    .from("upgrade_email_sends")
    .select("id")
    .eq("user_id", tomRecord.id)
    .eq("stage", "overage_daily_digest")
    .eq("period_key", todayKey)
    .limit(1);
  if ((existing?.length ?? 0) > 0) {
    results.overage_daily_digest.skipped++;
    return;
  }

  // Pull last-24h overage events with user email + plan
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: events } = await supabaseAdmin
    .from("overage_events")
    .select("user_id, plan_id, unit_price_cents, meter_event_status")
    .gte("created_at", since);

  if (!events || events.length === 0) {
    results.overage_daily_digest.skipped++;
    return;
  }

  // Aggregate by user
  type UserAgg = {
    user_email: string;
    plan_name: string;
    overage_count: number;
    overage_dollars: number;
    sent: number;
    pending: number;
    failed: number;
  };
  const byUser = new Map<string, UserAgg>();
  for (const ev of events) {
    let agg = byUser.get(ev.user_id);
    if (!agg) {
      const { data: userRow } = await supabaseAdmin.auth.admin.getUserById(ev.user_id);
      const email = userRow?.user?.email ?? "(unknown)";
      const planName = PLANS[ev.plan_id as PlanId]?.name ?? ev.plan_id;
      agg = {
        user_email: email,
        plan_name: planName,
        overage_count: 0,
        overage_dollars: 0,
        sent: 0,
        pending: 0,
        failed: 0,
      };
      byUser.set(ev.user_id, agg);
    }
    agg.overage_count++;
    agg.overage_dollars += ev.unit_price_cents / 100;
    if (ev.meter_event_status === "sent") agg.sent++;
    else if (ev.meter_event_status === "failed") agg.failed++;
    else agg.pending++;
  }

  const rows = Array.from(byUser.values()).map((agg) => ({
    user_email: agg.user_email,
    plan_name: agg.plan_name,
    overage_count: agg.overage_count,
    overage_dollars: agg.overage_dollars,
    meter_status_breakdown: `${agg.sent} sent · ${agg.pending} pending · ${agg.failed} failed`,
  }));

  try {
    const { data: sent, error: sendErr } = await getResend().emails.send({
      from: FROM,
      to: [INTERNAL_DIGEST_RECIPIENT],
      replyTo: REPLY_TO,
      subject: `[DumbRoof] Overage digest — ${rows.length} user${rows.length === 1 ? "" : "s"}, $${Math.round(rows.reduce((s, r) => s + r.overage_dollars, 0)).toLocaleString()}`,
      html: dailyDigestHtml(rows),
      tags: [
        { name: "type", value: "overage_digest" },
        { name: "stage", value: "overage_daily_digest" },
      ],
    });
    if (sendErr) {
      results.overage_daily_digest.failed++;
      return;
    }
    await supabaseAdmin.from("upgrade_email_sends").insert({
      user_id: tomRecord.id,
      stage: "overage_daily_digest",
      period_key: todayKey,
      email_id: sent?.id,
      recipient_class: "internal",
    });
    results.overage_daily_digest.sent++;
  } catch (e) {
    console.error("[UPGRADE] daily digest exception:", e);
    results.overage_daily_digest.failed++;
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
