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
  const { data: events } = await supabase
    .from("claim_events")
    .select("event_type, occurred_at, metadata")
    .eq("claim_id", claimId)
    .in("event_type", [
      "forensic_sent_to_carrier",
      "forensic_sent_to_homeowner",
      "supplement_sent_to_carrier",
      "coc_sent_to_homeowner",
      "homeowner_engagement_sent",
      "check_received",
    ])
    .order("occurred_at", { ascending: false });

  const latestByType: Record<string, { occurred_at: string; metadata: unknown } | null> = {
    forensic_sent_to_carrier: null,
    forensic_sent_to_homeowner: null,
    supplement_sent_to_carrier: null,
    coc_sent_to_homeowner: null,
    homeowner_engagement_sent: null,
    check_received: null,
  };

  for (const e of events || []) {
    if (latestByType[e.event_type] === null) {
      latestByType[e.event_type] = {
        occurred_at: e.occurred_at,
        metadata: e.metadata,
      };
    }
  }

  const forensic =
    latestByType.forensic_sent_to_carrier || latestByType.forensic_sent_to_homeowner;

  return NextResponse.json({
    checkpoints: {
      forensic: {
        done: !!forensic,
        at: forensic?.occurred_at ?? null,
      },
      supplement: {
        done: !!latestByType.supplement_sent_to_carrier,
        at: latestByType.supplement_sent_to_carrier?.occurred_at ?? null,
      },
      coc: {
        done: !!latestByType.coc_sent_to_homeowner,
        at: latestByType.coc_sent_to_homeowner?.occurred_at ?? null,
      },
      engagement: {
        done: !!latestByType.homeowner_engagement_sent,
        at: latestByType.homeowner_engagement_sent?.occurred_at ?? null,
      },
      check_received: {
        done: !!latestByType.check_received,
        at: latestByType.check_received?.occurred_at ?? null,
      },
    },
  });
}
