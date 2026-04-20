import { Suspense } from "react";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SignupClient } from "./signup-client";

export const dynamic = "force-dynamic";

interface SignupPageProps {
  searchParams: Promise<{
    invite?: string;
    ref?: string;
    email?: string;
    next?: string;
    redirect?: string; // legacy alias for `next`
  }>;
}

/**
 * Dedicated signup route — handles ads-driven landing + invite + referral flows.
 *
 *   /signup                             → generic signup
 *   /signup?invite={token}&email=foo    → accepting a team invite (arrives from /invite/[token])
 *   /signup?ref={code}                  → referred by another company (arrives from /r/[code])
 *
 * On this page we resolve the invite or referral context server-side (so we can
 * display "You're joining {company}" or "{referrer_name} sent you this") and
 * stash the context in cookies so the /auth/callback route can finalize the
 * linkage after email confirmation or Google OAuth.
 */
export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { invite, ref, email, next, redirect: redirectAlias } = await searchParams;
  const resolvedNext = next || redirectAlias;

  let inviteContext: null | {
    token: string;
    companyName: string;
    inviterName: string;
    inviteEmail: string;
    role: string;
  } = null;

  let referralContext: null | {
    code: string;
    referrerName: string;
    companyName: string;
  } = null;

  // Resolve invite context
  if (invite) {
    const { data: inviteRows } = await supabaseAdmin
      .from("company_invites")
      .select("id, email, role, invited_by, expires_at, accepted_at, revoked_at")
      .eq("token", invite)
      .limit(1);
    const row = inviteRows?.[0];
    if (row && !row.accepted_at && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()) {
      let inviterName = "Your teammate";
      let companyName = "a company";
      if (row.invited_by) {
        const { data: inviterRows } = await supabaseAdmin
          .from("company_profiles")
          .select("name, email, company_name")
          .eq("user_id", row.invited_by)
          .limit(1);
        const inviter = inviterRows?.[0];
        if (inviter) {
          inviterName = inviter.name || inviter.email || inviterName;
          companyName = inviter.company_name || companyName;
        }
      }
      inviteContext = {
        token: invite,
        companyName,
        inviterName,
        inviteEmail: row.email,
        role: row.role,
      };
    }
  }

  // Resolve referral context
  if (ref) {
    const normalized = ref.trim().toUpperCase();
    const { data: profileRows } = await supabaseAdmin
      .from("company_profiles")
      .select("user_id, referral_code, name, email, company_name")
      .eq("referral_code", normalized)
      .limit(1);
    const prof = profileRows?.[0];
    if (prof) {
      referralContext = {
        code: normalized,
        referrerName: prof.name || prof.email || "A friend",
        companyName: prof.company_name || "their roofing company",
      };
    }
  }

  // Persist invite/ref in cookies so /auth/callback can pick them up after
  // email confirmation / Google OAuth round-trip (query params don't survive).
  // 24h is long enough for email-confirm / OAuth flows but short enough to
  // limit cross-user contamination on shared browsers.
  const cookieStore = await cookies();
  const oneDay = 60 * 60 * 24;
  if (inviteContext) {
    cookieStore.set("dr_invite", inviteContext.token, {
      httpOnly: true, sameSite: "lax", secure: true, maxAge: oneDay, path: "/",
    });
  }
  if (referralContext) {
    cookieStore.set("dr_ref", referralContext.code, {
      httpOnly: true, sameSite: "lax", secure: true, maxAge: oneDay, path: "/",
    });
  }

  return (
    <Suspense>
      <SignupClient
        inviteContext={inviteContext}
        referralContext={referralContext}
        prefillEmail={inviteContext?.inviteEmail || email || ""}
        nextPath={resolvedNext || "/dashboard/new-claim"}
      />
    </Suspense>
  );
}
