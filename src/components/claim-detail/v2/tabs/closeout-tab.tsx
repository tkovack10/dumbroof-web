"use client";

import type { ReactNode } from "react";
import type { Claim } from "@/types/claim";
import type { V2Slots } from "../types";

interface Props {
  claim: Claim;
  slots: V2Slots;
}

/**
 * Closeout tab — visible at all phases per Tom's call (gives reps a roadmap
 * even on pre-scope claims). Locked stages render with reduced opacity and
 * a "unlocks at win" hint instead of being hidden entirely.
 *
 * Order = workflow: AOB → Engagement → Build → Install → CoC → Invoice.
 */
export function CloseoutTab({ claim, slots }: Props) {
  const isWon = claim.claim_outcome === "won";

  const steps: { num: number; title: string; status: "done" | "now" | "locked"; body: ReactNode }[] = [
    {
      num: 1,
      title: "AOB / Contingency Agreement",
      status: slots.signatureManager ? (isWon ? "done" : "now") : "locked",
      body: slots.signatureManager,
    },
    {
      num: 2,
      title: "Homeowner engagement",
      status: slots.homeownerEngagement ? (isWon ? "done" : "now") : "locked",
      body: slots.homeownerEngagement,
    },
    {
      num: 3,
      title: "Ready to build",
      status: slots.readyToBuild ? (isWon ? "now" : "locked") : "locked",
      body: slots.readyToBuild,
    },
    {
      num: 4,
      title: "Install supplements",
      status: slots.installSupplements && isWon ? "now" : "locked",
      body: slots.installSupplements ?? slots.lockedInstall,
    },
    {
      num: 5,
      title: "Certificate of completion",
      status: slots.certificateOfCompletion && isWon ? "now" : "locked",
      body: slots.certificateOfCompletion ?? slots.lockedCoc,
    },
    {
      num: 6,
      title: "Invoicing",
      status: slots.invoicing && isWon ? "now" : "locked",
      body: slots.invoicing ?? slots.lockedInvoice,
    },
  ];

  return (
    <div className="space-y-3">
      {!isWon && (
        <p className="text-xs text-[var(--gray-muted)]">
          Pre-win — closeout cards visible as a roadmap. Steps unlock progressively as the claim moves forward.
        </p>
      )}
      {steps.map((s) => (
        <CloseoutCard key={s.num} {...s} />
      ))}
    </div>
  );
}

function CloseoutCard({
  num,
  title,
  status,
  body,
}: {
  num: number;
  title: string;
  status: "done" | "now" | "locked";
  body: ReactNode;
}) {
  const stepStyle =
    status === "done"
      ? "bg-green-500/15 text-green-400 border-green-500/30"
      : status === "now"
      ? "bg-[var(--cyan)]/15 text-[var(--cyan)] border-[var(--cyan)]/30 shadow-[0_0_14px_rgba(34,216,255,0.35)]"
      : "bg-white/[0.04] text-[var(--gray-muted)] border-white/[0.1]";

  return (
    <section
      className={`bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5 ${
        status === "locked" ? "opacity-60" : ""
      }`}
    >
      <header className="flex items-center gap-3 mb-3">
        <div
          className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold ${stepStyle}`}
          aria-hidden="true"
        >
          {status === "done" ? "✓" : num}
        </div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {status === "locked" && (
          <span className="ml-auto text-[10px] text-[var(--gray-muted)] uppercase tracking-wider">
            unlocks later
          </span>
        )}
      </header>
      {body && <div className={status === "locked" ? "pointer-events-none" : ""}>{body}</div>}
    </section>
  );
}
