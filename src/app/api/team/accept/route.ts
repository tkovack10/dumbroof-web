import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { syncTeamSeats } from "@/lib/billing/sync-team-seats";

/**
 * Accept a team invite. Links the authenticated user's company_profiles row
 * to the invite's company_id with the invited role, and marks the invite accepted.
 *
 * The user MUST already be signed in. If they don't have an account yet, the
 * invite landing page redirects them to /signup?invite={token} first.
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = (body.token || "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing invite token" }, { status: 400 });
  }

  // Look up the invite
  const { data: inviteRows } = await supabaseAdmin
    .from("company_invites")
    .select("id, company_id, email, role, invited_by, expires_at, accepted_at, revoked_at")
    .eq("token", token)
    .limit(1);

  const invite = inviteRows?.[0];
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: "This invite was already accepted." }, { status: 409 });
  }
  if (invite.revoked_at) {
    return NextResponse.json({ error: "This invite has been revoked." }, { status: 410 });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This invite has expired." }, { status: 410 });
  }

  // Email match check — invite was issued to a specific address.
  // Allow acceptance if the authenticated user's email matches exactly.
  const userEmail = (user.email || "").toLowerCase();
  if (userEmail !== invite.email.toLowerCase()) {
    return NextResponse.json(
      {
        error: `This invite was sent to ${invite.email}. Sign in with that email to accept.`,
      },
      { status: 403 }
    );
  }

  // Find or create the user's company_profiles row.
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("id, company_id")
    .eq("user_id", user.id)
    .limit(1);

  const profile = profileRows?.[0];

  if (profile) {
    // Reassign this user to the inviting company (replacing solo profile if any).
    const { error: updateErr } = await supabaseAdmin
      .from("company_profiles")
      .update({
        company_id: invite.company_id,
        role: invite.role,
        invited_by: invite.invited_by,
        invite_accepted_at: new Date().toISOString(),
        is_admin: invite.role === "admin" || invite.role === "owner",
      })
      .eq("user_id", user.id);
    if (updateErr) {
      console.error("[accept] profile update failed", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  } else {
    // No profile yet — insert one scoped to this company.
    const { error: insertErr } = await supabaseAdmin
      .from("company_profiles")
      .insert({
        user_id: user.id,
        email: user.email,
        company_id: invite.company_id,
        role: invite.role,
        invited_by: invite.invited_by,
        invite_accepted_at: new Date().toISOString(),
        is_admin: invite.role === "admin" || invite.role === "owner",
      });
    if (insertErr) {
      console.error("[accept] profile insert failed", insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  // Mark invite accepted
  await supabaseAdmin
    .from("company_invites")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: user.id,
    })
    .eq("id", invite.id);

  // Update Stripe seat count for the team. Team-size grew by one — if the
  // company is on a paid plan with includedUsers exceeded, this adds (or
  // increments) the extra_seat line on the subscription, prorated.
  // Fire-and-await so any Stripe failure surfaces in the response — but the
  // helper itself is defensive and never throws.
  try {
    const seatResult = await syncTeamSeats(invite.company_id);
    if (seatResult.synced) {
      console.log("[accept] team seats synced", {
        company_id: invite.company_id,
        extra_seats: seatResult.extraSeats,
      });
    }
  } catch (e) {
    // Defensive — never block invite acceptance on a Stripe hiccup.
    console.error("[accept] syncTeamSeats threw", e);
  }

  return NextResponse.json({
    ok: true,
    company_id: invite.company_id,
    role: invite.role,
  });
}
