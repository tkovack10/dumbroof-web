"use client";

import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
}

/**
 * Comms tab — renders the consolidated CommunicationsCenter (edit requests +
 * carrier correspondence + draft responses) plus the existing CommunicationLog.
 * Phase 3c-1 collapsed three v2 slots and a subtab switcher into this single,
 * vertical-stack layout. Pending counts surface via the highlights chip + tab
 * badge — the subtab UI added complexity without UX value.
 */
export function CommsTab({ slots }: Props) {
  const hasContent = slots.communicationsCenter || slots.communicationLog;

  return (
    <div className="space-y-4">
      {slots.communicationsCenter && <section>{slots.communicationsCenter}</section>}
      {slots.communicationLog && <section>{slots.communicationLog}</section>}
      {!hasContent && (
        <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-8 text-center text-sm text-[var(--gray-muted)]">
          No communications yet on this claim.
        </div>
      )}
    </div>
  );
}
