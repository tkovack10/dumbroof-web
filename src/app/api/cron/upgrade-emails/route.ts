import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";
import { PLANS, type PlanId } from "@/lib/stripe-config";

const FROM = "Tom Kovack <tom@dumbroof.ai>";
const REPLY_TO = "tom@dumbroof.ai";

type Stage = "near_cap" | "at_cap" | "monthly_cap" | "renewal_in_3d";

interface SubRow {
  user_id: string;
  plan_id: string;
  status: string;
  claims_used_this_period: number;
  lifetime_claims_used: number;
  current_period_end: string | null;
}

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
  };

  // Pull active subscriptions in one shot (small table — < 10K rows expected
  // for the foreseeable future)
  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, plan_id, status, claims_used_this_period, lifetime_claims_used, current_period_end")
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

  console.log("[UPGRADE] run complete:", JSON.stringify(results));
  return NextResponse.json({ ok: true, results });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
