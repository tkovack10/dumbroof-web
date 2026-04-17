import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";

const FROM = "DumbRoof <noreply@dumbroof.ai>";

type Stage = "d1_video" | "d3_any_photo" | "d7_white_glove";

interface StageConfig {
  stage: Stage;
  minDays: number;
  maxDays: number;
  subject: string;
  html: (email: string) => string;
}

const STAGES: StageConfig[] = [
  {
    stage: "d1_video",
    minDays: 1,
    maxDays: 2,
    subject: "2-minute video: watch us turn photos into a forensic report",
    html: () => wrap(
      "See it run on a real claim",
      `<p>You signed up yesterday — want to see what you get before you upload your own photos?</p>
       <p>Here's a sample forensic report from a real Ohio claim (Dominic Mantia, XPRO Elite Roofing). Photos in, forensic causation report out. No training, no setup.</p>
       <p style="text-align:center;margin:28px 0;">
         <a href="https://www.dumbroof.ai/sample/dashboard" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">View the sample claim &rarr;</a>
       </p>
       <p>When you're ready, upload your first set of photos here — takes about 5 minutes:</p>
       <p style="text-align:center;margin:20px 0;">
         <a href="https://www.dumbroof.ai/dashboard/new-claim" style="color:#2563eb;font-weight:600;">Start your first claim &rarr;</a>
       </p>`,
    ),
  },
  {
    stage: "d3_any_photo",
    minDays: 3,
    maxDays: 5,
    subject: "Stuck? Upload any roof photo — we'll show you what comes out",
    html: () => wrap(
      "Can't decide which claim to run first?",
      `<p>Don't overthink it. Upload <em>any</em> roof photos you've got — an old job, a recent inspection, even photos of your own house. You'll get a free forensic report back in about 5 minutes.</p>
       <p>The goal here isn't a perfect first claim. It's to see what the tool produces on real photos so you know what to expect when a real claim comes in.</p>
       <p style="text-align:center;margin:28px 0;">
         <a href="https://www.dumbroof.ai/dashboard/new-claim" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">Upload any photos &rarr;</a>
       </p>
       <p style="color:#6b7280;font-size:14px;">Your 3 free claims never expire. Use one on a test case — you'll still have 2 for real jobs.</p>`,
    ),
  },
  {
    stage: "d7_white_glove",
    minDays: 7,
    maxDays: 10,
    subject: "Want us to run your first claim for you?",
    html: (email) => wrap(
      "White-glove onboarding",
      `<p>It's been a week. If you haven't started a claim yet, we get it — new tools take time.</p>
       <p><strong>Here's an offer:</strong> reply to this email with any claim you're working right now (carrier scope, photos, EagleView if you have it) and we'll run the whole thing for you. Forensic report, Xactimate estimate, scope comparison, supplement letter. Usually takes us under an hour.</p>
       <p>You see exactly what the output looks like on a real claim of yours — no fumbling with the UI. Then you decide if it's worth it.</p>
       <p style="text-align:center;margin:28px 0;">
         <a href="mailto:hello@dumbroof.ai?subject=Run%20my%20first%20claim%20for%20me&body=My%20account%20email%3A%20${encodeURIComponent(email)}%0A%0ATell%20us%20about%20the%20claim%3A%0A-%20Property%20address%3A%0A-%20Carrier%3A%0A-%20What%20you%20have%3A%20photos%20%2F%20carrier%20scope%20%2F%20eagleview%20%2F%20other%0A%0A(You%20can%20attach%20files%20to%20this%20reply.)" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">Reply — we'll run it for you &rarr;</a>
       </p>
       <p style="color:#6b7280;font-size:14px;">If you'd rather try it yourself, <a href="https://www.dumbroof.ai/dashboard/new-claim" style="color:#2563eb;">upload photos here</a>. Either way — whatever gets you your first one.</p>`,
    ),
  },
];

function wrap(heading: string, bodyHtml: string): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e;">
  <div style="background:linear-gradient(135deg,#0d2137 0%,#1a3a5c 100%);padding:32px;border-radius:12px 12px 0 0;">
    <h1 style="color:#fff;font-size:22px;margin:0;">${heading}</h1>
  </div>
  <div style="padding:32px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;font-size:15px;line-height:1.6;color:#374151;">
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
    <p style="font-size:13px;color:#9ca3af;margin:0;">&mdash; The DumbRoof Team &middot; <a href="https://www.dumbroof.ai/unsubscribe" style="color:#9ca3af;text-decoration:underline;">unsubscribe</a></p>
  </div>
</div>`;
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

  const results: Record<Stage, { sent: number; skipped: number; failed: number }> = {
    d1_video: { sent: 0, skipped: 0, failed: 0 },
    d3_any_photo: { sent: 0, skipped: 0, failed: 0 },
    d7_white_glove: { sent: 0, skipped: 0, failed: 0 },
  };

  const resend = getResend();

  for (const cfg of STAGES) {
    const nowIso = new Date().toISOString();
    const earliest = new Date(Date.now() - cfg.maxDays * 24 * 3600 * 1000).toISOString();
    const latest = new Date(Date.now() - cfg.minDays * 24 * 3600 * 1000).toISOString();

    // Candidate users: signed up within [earliest, latest] AND have zero claims
    const { data: candidates, error: candErr } = await supabaseAdmin
      .rpc("list_reactivation_candidates", {
        p_earliest: earliest,
        p_latest: latest,
        p_stage: cfg.stage,
      });

    if (candErr) {
      console.error(`[REACTIVATION] candidate lookup failed for ${cfg.stage}:`, candErr.message);
      continue;
    }

    for (const c of candidates || []) {
      try {
        const { data: sent, error: sendErr } = await resend.emails.send({
          from: FROM,
          to: [c.email],
          subject: cfg.subject,
          html: cfg.html(c.email),
          tags: [
            { name: "type", value: "reactivation" },
            { name: "stage", value: cfg.stage },
          ],
        });

        if (sendErr) {
          console.error(`[REACTIVATION] send failed ${cfg.stage} ${c.email}:`, sendErr.message);
          results[cfg.stage].failed++;
          continue;
        }

        const { error: recErr } = await supabaseAdmin
          .from("reactivation_sends")
          .insert({ user_id: c.user_id, stage: cfg.stage, email_id: sent?.id, sent_at: nowIso });

        if (recErr) {
          // Unique violation = already sent by a parallel run; treat as skip
          if (recErr.code === "23505") {
            results[cfg.stage].skipped++;
          } else {
            console.error(`[REACTIVATION] record failed ${cfg.stage} ${c.email}:`, recErr.message);
          }
        } else {
          results[cfg.stage].sent++;
        }
      } catch (e) {
        console.error(`[REACTIVATION] exception ${cfg.stage} ${c.email}:`, e);
        results[cfg.stage].failed++;
      }
    }
  }

  console.log("[REACTIVATION] run complete:", JSON.stringify(results));
  return NextResponse.json({ ok: true, results });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
