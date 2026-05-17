import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/claim/[id]/checkpoints
 * Returns the 4 sales/communication checkpoints for a claim, plus
 * a check-received flag, so the rep workspace can render at-a-glance dots.
 *
 *  - forensic:     forensic_sent_to_carrier OR forensic_sent_to_homeowner
 *  - supplement:   supplement_sent_to_carrier
 *  - coc:          coc_sent_to_homeowner
 *  - engagement:   homeowner_engagement_sent
 *  - checkReceived: check_received event (or check_uploads row)
 *
 * All four checkpoints are looked up from the unified claim_events table.
 */
export async function GET(
  _req: Request,
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

  // RLS on claim_events scopes by company membership — one query, all events.
  // Accept BOTH new (Phase 1 invented) + legacy (backend/main.py emitter) names.
  const { data: events } = await supabase
    .from("claim_events")
    .select("event_type, occurred_at, metadata")
    .eq("claim_id", claimId)
    .in("event_type", [
      "forensic_sent_to_carrier",
      "forensic_sent_to_homeowner",
      "supplement_sent_to_carrier",
      "supplement_sent",
      "install_supplement_sent",
      "coc_sent_to_homeowner",
      "coc_sent",
      "homeowner_engagement_sent",
      "homeowner_email_sent",
      "sequence_started",
      "check_received",
    ])
    .order("occurred_at", { ascending: false });

  type Slot = { occurred_at: string; metadata: unknown } | null;
  const byCheckpoint: {
    forensic: Slot;
    supplement: Slot;
    coc: Slot;
    engagement: Slot;
    check_received: Slot;
  } = {
    forensic: null,
    supplement: null,
    coc: null,
    engagement: null,
    check_received: null,
  };

  function bumpLatest(
    key: keyof typeof byCheckpoint,
    occurred_at: string,
    metadata: unknown
  ) {
    if (!byCheckpoint[key] || byCheckpoint[key]!.occurred_at < occurred_at) {
      byCheckpoint[key] = { occurred_at, metadata };
    }
  }

  for (const e of events || []) {
    switch (e.event_type) {
      case "forensic_sent_to_carrier":
      case "forensic_sent_to_homeowner":
        bumpLatest("forensic", e.occurred_at, e.metadata);
        break;
      case "supplement_sent_to_carrier":
      case "supplement_sent":
      case "install_supplement_sent":
        bumpLatest("supplement", e.occurred_at, e.metadata);
        break;
      case "coc_sent_to_homeowner":
      case "coc_sent":
        bumpLatest("coc", e.occurred_at, e.metadata);
        break;
      case "homeowner_engagement_sent":
      case "homeowner_email_sent":
      case "sequence_started":
        bumpLatest("engagement", e.occurred_at, e.metadata);
        break;
      case "check_received":
        bumpLatest("check_received", e.occurred_at, e.metadata);
        break;
    }
  }

  return NextResponse.json({
    checkpoints: {
      forensic: {
        done: !!byCheckpoint.forensic,
        at: byCheckpoint.forensic?.occurred_at ?? null,
      },
      supplement: {
        done: !!byCheckpoint.supplement,
        at: byCheckpoint.supplement?.occurred_at ?? null,
      },
      coc: {
        done: !!byCheckpoint.coc,
        at: byCheckpoint.coc?.occurred_at ?? null,
      },
      engagement: {
        done: !!byCheckpoint.engagement,
        at: byCheckpoint.engagement?.occurred_at ?? null,
      },
      check_received: {
        done: !!byCheckpoint.check_received,
        at: byCheckpoint.check_received?.occurred_at ?? null,
      },
    },
  });
}
