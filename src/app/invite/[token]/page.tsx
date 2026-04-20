import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { InviteAcceptClient } from "./accept-client";

export const dynamic = "force-dynamic";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  const { data: inviteRows } = await supabaseAdmin
    .from("company_invites")
    .select("id, email, role, expires_at, accepted_at, revoked_at, invited_by")
    .eq("token", token)
    .limit(1);

  const invite = inviteRows?.[0];

  // Look up inviter + company info (best effort, don't block)
  let inviterName = "Your teammate";
  let companyName = "a company";
  if (invite?.invited_by) {
    const { data: inviterRows } = await supabaseAdmin
      .from("company_profiles")
      .select("name, email, company_name")
      .eq("user_id", invite.invited_by)
      .limit(1);
    const inviter = inviterRows?.[0];
    if (inviter) {
      inviterName = inviter.name || inviter.email || inviterName;
      companyName = inviter.company_name || companyName;
    }
  }

  // Check if the current visitor is already signed in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-[var(--bg-deep)] text-[var(--white)] flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-2xl p-8 shadow-2xl">
        {!invite ? (
          <InviteError title="Invite not found" detail="This link isn't valid. Ask your teammate to resend it." />
        ) : invite.accepted_at ? (
          <InviteError title="Invite already accepted" detail="This invite has already been used. Sign in to access the team." signInLink />
        ) : invite.revoked_at ? (
          <InviteError title="Invite revoked" detail="The person who sent this invite revoked it. Ask them to send a new one." />
        ) : new Date(invite.expires_at).getTime() < Date.now() ? (
          <InviteError title="Invite expired" detail="Invites are valid for 14 days. Ask your teammate to send a fresh one." />
        ) : user && user.email?.toLowerCase() !== invite.email.toLowerCase() ? (
          <InviteError
            title="Wrong account"
            detail={`This invite was sent to ${invite.email}. Sign out and sign in with that email to accept.`}
          />
        ) : user ? (
          // Signed in with matching email — show accept button
          <InviteAcceptClient
            token={token}
            inviterName={inviterName}
            companyName={companyName}
            role={invite.role}
            email={invite.email}
          />
        ) : (
          // Not signed in — send to signup with invite context
          (() => {
            redirect(`/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`);
          })()
        )}
      </div>
    </div>
  );
}

function InviteError({
  title,
  detail,
  signInLink,
}: {
  title: string;
  detail: string;
  signInLink?: boolean;
}) {
  return (
    <>
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-[var(--gray-muted)] text-sm mb-6">{detail}</p>
      <Link
        href={signInLink ? "/login" : "/"}
        className="inline-block px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white"
      >
        {signInLink ? "Sign in" : "Back to dumbroof.ai"}
      </Link>
    </>
  );
}
