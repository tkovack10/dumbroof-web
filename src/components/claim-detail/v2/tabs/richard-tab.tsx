"use client";

import { ClaimBrainChat } from "@/components/claim-brain-chat";
import type { Claim } from "@/types/claim";

/**
 * "Ask Richard" tab — promotes the per-claim Claim Brain from a floating corner
 * FAB to a first-class tab (Phase 2, "Richard IS DumbRoof"). Renders the SAME
 * ClaimBrainChat in inlineMode (fills the tab; no floating panel, no × close).
 *
 * On v2 this is the single per-claim Richard instance — the page.tsx floating
 * FAB is now v1-only, so Richard never double-mounts. See
 * project_richard_onboarding_activation.
 */
export function RichardTab({ claim, userId }: { claim: Claim; userId?: string }) {
  // Same variance formula the FAB used in page.tsx.
  const variance =
    (claim.contractor_rcv || 0) - (claim.current_carrier_rcv || claim.original_carrier_rcv || 0);
  return (
    <ClaimBrainChat
      inlineMode
      claimId={claim.id}
      claimAddress={claim.address}
      carrier={claim.carrier}
      variance={variance}
      userId={userId}
      filePath={claim.file_path}
    />
  );
}
