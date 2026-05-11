"use client";

import { useState } from "react";
import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
}

type CommsSubtab = "all" | "drafts" | "edits";

/**
 * Comms tab — consolidates the THREE separate communication surfaces from v1
 * into a single tab with subtabs. Phase 2 keeps them as distinct rendered
 * blocks (no behavior change); Phase 3 will merge them into a single Inbox/
 * Outbox/Drafts/Edits unified view component.
 *
 * Drafts subtab surfaces the highest-urgency surface (pending review) so
 * nothing slips while the highlights-panel badge is the secondary signal.
 */
export function CommsTab({ slots }: Props) {
  const [sub, setSub] = useState<CommsSubtab>("all");

  const hasDrafts = !!slots.draftResponses;
  const hasEdits = !!slots.editRequests;

  return (
    <div className="space-y-4">
      <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-1 inline-flex gap-1">
        {([
          ["all", "All"],
          ["drafts", "Drafts"],
          ["edits", "Edit requests"],
        ] as [CommsSubtab, string][]).map(([k, label]) => {
          const active = sub === k;
          const badge =
            k === "drafts" && hasDrafts ? "•" :
            k === "edits" && hasEdits ? "•" : null;
          return (
            <button
              key={k}
              onClick={() => setSub(k)}
              className={`relative px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                active
                  ? "bg-white/[0.08] text-white"
                  : "text-[var(--gray-muted)] hover:text-white"
              }`}
            >
              {label}
              {badge && (
                <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[var(--pink)] align-middle shadow-[0_0_5px_var(--pink)]" />
              )}
            </button>
          );
        })}
      </div>

      {(sub === "all" || sub === "drafts") && hasDrafts && (
        <section>{slots.draftResponses}</section>
      )}
      {(sub === "all" || sub === "edits") && hasEdits && (
        <section>{slots.editRequests}</section>
      )}
      {sub === "all" && slots.communicationLog && (
        <section>{slots.communicationLog}</section>
      )}
      {sub === "all" && slots.carrierCorrespondence && (
        <section>{slots.carrierCorrespondence}</section>
      )}

      {sub === "drafts" && !hasDrafts && (
        <EmptyState text="No drafts pending review." />
      )}
      {sub === "edits" && !hasEdits && (
        <EmptyState text="No edit requests pending." />
      )}
      {sub === "all" && !hasDrafts && !hasEdits && !slots.communicationLog && !slots.carrierCorrespondence && (
        <EmptyState text="No communications yet on this claim." />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-8 text-center text-sm text-[var(--gray-muted)]">
      {text}
    </div>
  );
}
