import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logClaimEvent } from "@/lib/claim-events";

/**
 * POST /api/claim/[id]/assign-rep
 * Body: { rep_user_id: string | null }   (null = unassign)
 *
 * Auth: admin OR the current assignee may reassign.
 * Validates the new rep belongs to the caller's company before writing
 * claims.assigned_user_id. Emits a `rep_assigned` claim_event so the
 * timeline + admin recent-activity surfaces pick it up.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: claimId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const newRepId: string | null =
    body.rep_user_id === null
      ? null
      : typeof body.rep_user_id === "string" && body.rep_user_id.length > 0
        ? body.rep_user_id
        : undefined;
  if (newRepId === undefined) {
    return NextResponse.json(
      { error: "rep_user_id must be a uuid or null" },
      { status: 400 }
    );
  }

  // Load caller profile + claim + (optionally) new rep profile in parallel
  const [callerRes, claimRes, newRepRes] = await Promise.all([
    supabaseAdmin
      .from("company_profiles")
      .select("is_admin, company_id, email")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabaseAdmin
      .from("claims")
      .select("id, company_id, user_id, assigned_user_id, address")
      .eq("id", claimId)
      .maybeSingle(),
    newRepId
      ? supabaseAdmin
          .from("company_profiles")
          .select("user_id, company_id, email")
          .eq("user_id", newRepId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const callerProfile = callerRes.data;
  const claim = claimRes.data;
  const newRepProfile = newRepRes.data;

  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // Authorize: admin OR current assignee OR claim owner
  const isAdmin = !!callerProfile?.is_admin;
  const isCurrentAssignee = claim.assigned_user_id === user.id;
  const isOwner = claim.user_id === user.id;
  if (!isAdmin && !isCurrentAssignee && !isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Validate the new rep is in the caller's company (when assigning, not unassigning)
  if (newRepId && newRepProfile) {
    const sameCompany =
      callerProfile?.company_id &&
      newRepProfile.company_id &&
      callerProfile.company_id === newRepProfile.company_id;
    const sameDomain = (() => {
      const callerDomain = (user.email || callerProfile?.email || "")
        .split("@")[1]
        ?.toLowerCase();
      const newRepDomain = (newRepProfile.email || "")
        .split("@")[1]
        ?.toLowerCase();
      return !!(callerDomain && newRepDomain && callerDomain === newRepDomain);
    })();
    if (!sameCompany && !sameDomain) {
      return NextResponse.json(
        { error: "Rep is not in your company" },
        { status: 400 }
      );
    }
  } else if (newRepId && !newRepProfile) {
    return NextResponse.json({ error: "Rep not found" }, { status: 404 });
  }

  // No-op shortcut
  if (claim.assigned_user_id === newRepId) {
    return NextResponse.json({
      ok: true,
      assigned_user_id: newRepId,
      unchanged: true,
    });
  }

  const previousRepId = claim.assigned_user_id;
  const { error: updErr } = await supabaseAdmin
    .from("claims")
    .update({ assigned_user_id: newRepId })
    .eq("id", claimId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logClaimEvent(claimId, "rep_assigned", {
    source: "user",
    createdBy: user.id,
    title: newRepId
      ? `Rep assigned: ${newRepProfile?.email ?? newRepId}`
      : "Rep unassigned",
    metadata: {
      previous_rep_user_id: previousRepId,
      new_rep_user_id: newRepId,
      new_rep_email: newRepProfile?.email ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    assigned_user_id: newRepId,
    new_rep_email: newRepProfile?.email ?? null,
  });
}
