import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendCapiEvent, CapiEventName, extractMetaTracking } from "@/lib/meta-conversions-api";

/**
 * Notify team + send welcome email via the unified /api/notify-signup endpoint.
 * That endpoint handles both team notification AND welcome email with PDF attachment
 * server-side, so neither can be killed by browser navigation or function termination.
 */
async function notifyNewSignup(email: string) {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    await fetch(`${origin}/api/notify-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "google_oauth" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Non-fatal
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  // `next` param honored for magic-link / save-spot deep links
  // (e.g. /auth/callback?next=/dashboard/new-claim from mobile-magic-hero)
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Recovery / invite — redirect to password reset page
      if (type === "recovery" || type === "invite") {
        return NextResponse.redirect(`${origin}/dashboard/settings?reset=true`);
      }

      const { data: { user } } = await supabase.auth.getUser();

      // Finalize invite/referral linkage if cookies were set by /signup or /invite/[token].
      // We run these BEFORE the new-user count check because the user's context
      // may shift (company_id changes) after an invite acceptance.
      let invitePostAcceptRedirect: string | null = null;
      if (user) {
        const cookieStore = await cookies();
        const inviteToken = cookieStore.get("dr_invite")?.value;
        const refCode = cookieStore.get("dr_ref")?.value;

        if (inviteToken) {
          try {
            const { data: inviteRows } = await supabaseAdmin
              .from("company_invites")
              .select("id, company_id, email, role, invited_by, expires_at, accepted_at, revoked_at")
              .eq("token", inviteToken)
              .limit(1);
            const invite = inviteRows?.[0];
            if (
              invite &&
              !invite.accepted_at &&
              !invite.revoked_at &&
              new Date(invite.expires_at).getTime() > Date.now() &&
              (user.email || "").toLowerCase() === invite.email.toLowerCase()
            ) {
              // Upsert into company_profiles with the invited company + role
              const { data: profRows } = await supabaseAdmin
                .from("company_profiles")
                .select("id")
                .eq("user_id", user.id)
                .limit(1);

              const profileUpdate = {
                company_id: invite.company_id,
                role: invite.role,
                invited_by: invite.invited_by,
                invite_accepted_at: new Date().toISOString(),
                is_admin: invite.role === "admin" || invite.role === "owner",
              };

              if (profRows && profRows.length > 0) {
                await supabaseAdmin
                  .from("company_profiles")
                  .update(profileUpdate)
                  .eq("user_id", user.id);
              } else {
                await supabaseAdmin.from("company_profiles").insert({
                  user_id: user.id,
                  email: user.email,
                  ...profileUpdate,
                });
              }
              await supabaseAdmin
                .from("company_invites")
                .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
                .eq("id", invite.id);
              invitePostAcceptRedirect = "/dashboard";
            }
          } catch (err) {
            console.error("[auth/callback] invite finalize failed", err);
          }
          cookieStore.delete("dr_invite");
        }

        if (refCode) {
          try {
            const { data: refererRows } = await supabaseAdmin
              .from("company_profiles")
              .select("user_id, email")
              .eq("referral_code", refCode)
              .limit(1);
            const referrerUserId = refererRows?.[0]?.user_id;
            const referrerEmail = (refererRows?.[0]?.email as string | null) || "";
            // Normalize emails to block Gmail-alias self-referrals.
            const normalizeEmail = (e: string): string => {
              const [local = "", domain = ""] = e.toLowerCase().trim().split("@");
              if (domain === "gmail.com" || domain === "googlemail.com") {
                return local.split("+")[0].replace(/\./g, "") + "@gmail.com";
              }
              return e.toLowerCase().trim();
            };
            const aliasSelfRefer =
              !!referrerEmail &&
              !!user.email &&
              normalizeEmail(referrerEmail) === normalizeEmail(user.email);
            if (referrerUserId && referrerUserId !== user.id && !aliasSelfRefer) {
              const emailLower = (user.email || "").toLowerCase();
              const { data: existingRef } = await supabaseAdmin
                .from("referrals")
                .select("id, status")
                .eq("referrer_user_id", referrerUserId)
                .or(`referred_user_id.eq.${user.id},referred_email.eq.${emailLower}`)
                .order("created_at", { ascending: false })
                .limit(1);
              const existing = existingRef?.[0];
              const nowIso = new Date().toISOString();
              if (existing) {
                await supabaseAdmin
                  .from("referrals")
                  .update({
                    referred_user_id: user.id,
                    status: existing.status === "pending" ? "signed_up" : existing.status,
                    signed_up_at: existing.status === "pending" ? nowIso : undefined,
                  })
                  .eq("id", existing.id);
              } else {
                await supabaseAdmin.from("referrals").insert({
                  referrer_user_id: referrerUserId,
                  referral_code: refCode,
                  referred_email: emailLower,
                  referred_user_id: user.id,
                  status: "signed_up",
                  signed_up_at: nowIso,
                });
              }
            }
          } catch (err) {
            console.error("[auth/callback] referral link failed", err);
          }
          cookieStore.delete("dr_ref");
        }
      }

      if (invitePostAcceptRedirect) {
        return NextResponse.redirect(`${origin}${invitePostAcceptRedirect}`);
      }

      if (user) {
        // Check if new user (no claims) — send to new-claim + notify team
        const { count } = await supabase
          .from("claims")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id);

        if (count === 0) {
          // New user — notify team + send welcome email (both handled by notifyNewSignup).
          // MUST await: fire-and-forget here gets killed when Vercel terminates the
          // function on redirect. 2026-04-06 burst of 7 signups missed welcome this way.
          await notifyNewSignup(user.email || "unknown");

          // Fire Meta CAPI Lead event server-side. iOS 14+ blocks the
          // browser pixel for ~25-40% of users. Without this, Meta's
          // algorithm can't optimize against actual signup conversions.
          // Fire-and-forget; never blocks the redirect.
          const tracking = extractMetaTracking(request);
          sendCapiEvent({
            eventName: CapiEventName.Lead,
            email: user.email || undefined,
            eventSourceUrl: `${origin}/`,
            clientIpAddress: request.headers.get("x-forwarded-for") || undefined,
            clientUserAgent: request.headers.get("user-agent") || undefined,
            fbc: tracking.fbc,
            fbp: tracking.fbp,
            customData: {
              content_name: "auth_callback_signup",
              content_category: type || "oauth_or_email_confirm",
            },
          }).catch(() => {});

          // Honor `next` if present, otherwise default to new-claim form
          return NextResponse.redirect(`${origin}${next || "/dashboard/new-claim"}`);
        }
      }
      // Existing user — honor `next` if present, otherwise dashboard
      return NextResponse.redirect(`${origin}${next || "/dashboard"}`);
    }

    console.error("Auth callback error:", error.message);
  }

  // No code or exchange failed — likely expired/used magic link
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("This sign-in link has expired or was already used. Enter your email below to get a new one.")}`
  );
}
