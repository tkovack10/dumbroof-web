import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM_CLAIMS, EMAIL_REPLY_TO, teamBccFor } from "@/lib/resend";
import { logClaimEvent } from "@/lib/claim-events";

/**
 * POST /api/admin/production/schedules/[id]/notify
 *
 * Sends the homeowner an email about the scheduled install. Idempotent on
 * the schedule row (notified_at is set after a successful send; calling
 * again re-sends only if reset=true is passed).
 *
 * Email content follows the existing claims-from address pattern
 * (Dumb Roof Claims <claims@dumbroof.ai>) and includes platform BCC
 * per E166 / teamBccFor() rule.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;

  const body = await req.json().catch(() => ({}));
  const reset: boolean = !!body.reset;

  const { data: schedule } = await supabaseAdmin
    .from("production_schedules")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!schedule || schedule.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (schedule.notified_at && !reset) {
    return NextResponse.json({
      ok: true,
      already_sent: true,
      notified_at: schedule.notified_at,
    });
  }

  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("id, homeowner_name, homeowner_email, address, carrier")
    .eq("id", schedule.claim_id)
    .maybeSingle();
  if (!claim?.homeowner_email) {
    return NextResponse.json(
      { error: "Claim has no homeowner email on file" },
      { status: 400 }
    );
  }

  // Look up company info for branding
  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("name, phone, office_phone, website")
    .eq("id", companyId)
    .maybeSingle();

  const scheduledDate = new Date(schedule.scheduled_at);
  const dateStr = scheduledDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = scheduledDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const homeownerFirst = (claim.homeowner_name || "")
    .split(/\s+/)
    .filter(Boolean)[0] || "there";
  const companyName = company?.name || "your roofing team";
  const subject = `Your ${companyName} install is scheduled for ${dateStr}`;

  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px;">Hi ${escapeHtml(homeownerFirst)},</h2>
  <p>Your install is on the schedule:</p>
  <div style="background: #f5f5f5; border-left: 4px solid #22c55e; padding: 16px; border-radius: 6px; margin: 16px 0;">
    <p style="margin: 0; font-size: 18px;"><strong>${escapeHtml(dateStr)}</strong></p>
    <p style="margin: 4px 0 0; color: #666;">Arrival around ${escapeHtml(timeStr)}</p>
    ${claim.address ? `<p style="margin: 8px 0 0; color: #666;">${escapeHtml(claim.address)}</p>` : ""}
  </div>
  ${
    schedule.notes
      ? `<p style="background: #fff8e1; padding: 12px; border-radius: 6px;"><strong>From the crew:</strong> ${escapeHtml(schedule.notes)}</p>`
      : ""
  }
  <p>If this date doesn't work, reply to this email or call us at <strong>${escapeHtml(company?.phone || company?.office_phone || "your project lead")}</strong> and we'll find another window.</p>
  <p>Thanks,<br/>${escapeHtml(companyName)}</p>
  ${company?.website ? `<p style="color: #999; font-size: 12px; margin-top: 24px;"><a href="${escapeAttr(company.website.startsWith("http") ? company.website : "https://" + company.website)}" style="color: #999;">${escapeHtml(company.website)}</a></p>` : ""}
</body></html>`;

  const bcc = teamBccFor({
    recipientEmail: claim.homeowner_email,
    companyName: company?.name ?? null,
  });

  let resendId: string | null = null;
  try {
    const resend = getResend();
    const { data } = await resend.emails.send({
      from: EMAIL_FROM_CLAIMS,
      to: [claim.homeowner_email],
      bcc,
      replyTo: EMAIL_REPLY_TO,
      subject,
      html,
    });
    resendId = data?.id || null;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Email send failed" },
      { status: 500 }
    );
  }

  await supabaseAdmin
    .from("production_schedules")
    .update({
      notified_at: new Date().toISOString(),
      homeowner_email_id: resendId,
    })
    .eq("id", id);

  await logClaimEvent(claim.id, "homeowner_email_sent", {
    source: "user",
    createdBy: user.id,
    title: "Install schedule emailed to homeowner",
    metadata: {
      schedule_id: id,
      to: claim.homeowner_email,
      subject,
      resend_id: resendId,
      reason: "production_schedule_notify",
    },
  });

  return NextResponse.json({ ok: true, resend_id: resendId });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
