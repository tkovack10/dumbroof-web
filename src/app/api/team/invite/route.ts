import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";

const ALLOWED_ROLES = new Set(["admin", "member", "rep", "readonly"]);

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  let body: { email?: string; role?: string; message?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const role = (body.role || "member").trim();
  const message = (body.message || "").trim() || null;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Resolve the inviter's company_id. If they don't have one yet (solo user),
  // mint a new UUID and assign it to them so teammates share a company.
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("id, company_id, role, is_admin, email, company_name, contact_name")
    .eq("user_id", user.id)
    .limit(1);

  const profile = profileRows?.[0];
  if (!profile) {
    return NextResponse.json(
      { error: "Your profile is incomplete — complete settings first." },
      { status: 400 }
    );
  }

  // Only admins/owners can invite
  const inviterRole = profile.role || (profile.is_admin ? "owner" : "member");
  if (!["owner", "admin"].includes(inviterRole)) {
    return NextResponse.json(
      { error: "Only admins can invite teammates." },
      { status: 403 }
    );
  }

  // Only owners can promote another member to admin. An admin can invite
  // member/rep/readonly roles, but not another admin (prevents privilege
  // escalation by a single compromised admin account).
  if (role === "admin" && inviterRole !== "owner") {
    return NextResponse.json(
      { error: "Only the company owner can invite another admin." },
      { status: 403 }
    );
  }

  let companyId: string = profile.company_id;
  if (!companyId) {
    companyId = crypto.randomUUID();
    await supabaseAdmin
      .from("company_profiles")
      .update({ company_id: companyId, role: "owner" })
      .eq("user_id", user.id);
  }

  // Reject if there's already an active invite for this email at this company
  const { data: existing } = await supabaseAdmin
    .from("company_invites")
    .select("id, token, expires_at")
    .eq("company_id", companyId)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "An active invite already exists for this email." },
      { status: 409 }
    );
  }

  // Also reject if this email is already a teammate
  const { data: existingProfile } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("email", email)
    .limit(1);

  if (existingProfile && existingProfile.length > 0) {
    return NextResponse.json(
      { error: "This email is already on your team." },
      { status: 409 }
    );
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invite, error: inviteErr } = await supabaseAdmin
    .from("company_invites")
    .insert({
      company_id: companyId,
      email,
      role,
      token,
      invited_by: user.id,
      message,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (inviteErr || !invite) {
    console.error("[invite] insert failed", inviteErr);
    return NextResponse.json(
      { error: inviteErr?.message || "Failed to create invite" },
      { status: 500 }
    );
  }

  // Compose email
  const inviterName = profile.contact_name || profile.email || user.email || "Your teammate";
  const companyName = profile.company_name || "your company";
  const acceptUrl = `https://dumbroof.ai/invite/${token}`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
      <h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(inviterName)} invited you to ${escapeHtml(companyName)}</h1>
      <p style="font-size:15px;line-height:1.5;color:#333;margin:0 0 16px;">
        You've been invited to join <strong>${escapeHtml(companyName)}</strong> on dumbroof.ai — the AI claims platform for roofing companies.
        You'll have <strong>${escapeHtml(role)}</strong> access to the team's claims.
      </p>
      ${
        message
          ? `<blockquote style="border-left:3px solid #8b5cf6;padding:8px 14px;margin:16px 0;background:#f4f0ff;color:#222;font-size:14px;">
              ${escapeHtml(message).replace(/\n/g, "<br/>")}
            </blockquote>`
          : ""
      }
      <p style="margin:24px 0;">
        <a href="${acceptUrl}" style="display:inline-block;background:linear-gradient(90deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:15px;">
          Accept invite
        </a>
      </p>
      <p style="font-size:12px;color:#888;margin:24px 0 0;">
        This invite expires in 14 days. If you didn't expect this, you can ignore this email.
      </p>
      <p style="font-size:12px;color:#aaa;margin:16px 0 0;">
        Or paste this link: <span style="color:#555;">${acceptUrl}</span>
      </p>
    </div>
  `.trim();

  try {
    const resend = getResend();
    await resend.emails.send({
      from: EMAIL_FROM,
      to: [email],
      replyTo: profile.email || EMAIL_REPLY_TO,
      subject: `${inviterName} invited you to ${companyName} on dumbroof.ai`,
      html,
    });
  } catch (e) {
    console.error("[invite] Resend send failed", e);
    // Don't fail the whole request — the invite exists and can be resent. Tell the caller.
    return NextResponse.json(
      {
        ok: true,
        invite_id: invite.id,
        email_sent: false,
        warning: "Invite created but email send failed. You can resend from the team settings page.",
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ok: true,
    invite_id: invite.id,
    email_sent: true,
  });
}
