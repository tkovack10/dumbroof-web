"use client";

import type { Claim } from "@/types/claim";

/**
 * Claim Lifecycle Progress Bar
 *
 * Shows where a claim is in its lifecycle and what the user can do next.
 * Each phase unlocks when the previous phase's documents are ready.
 *
 * Phases:
 *   1. Quick Forensic  — address + photos → forensic report
 *   2. Full Estimate   — + measurements → Xactimate estimate + code compliance
 *   3. Supplement       — + carrier scope → scope comparison + supplement composer
 *   4. Job Completion   — install supplement → COC → invoice → follow-up
 */

interface Phase {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  status: "complete" | "active" | "locked";
  action?: string; // CTA text for the active phase
}

function getPhases(claim: Claim): Phase[] {
  const isReady = claim.status === "ready" && (claim.output_files?.length ?? 0) > 0;
  const hasMeasurements = (claim.measurement_files?.length ?? 0) > 0;
  const hasScope = (claim.scope_files?.length ?? 0) > 0;
  const hasComparison = claim.scope_comparison && (claim.scope_comparison as unknown[]).length > 0;
  const isForensicOnly = claim.report_mode === "forensic_only";
  const hasCoc = (claim.coc_files?.length ?? 0) > 0;
  const lifecycle = claim.lifecycle_phase;

  // Phase 1: Quick Forensic — always starts once claim exists
  const phase1Complete = isReady;
  const phase1Active = !isReady;

  // Phase 2: Full Estimate — needs measurements uploaded + reprocessed
  const phase2Complete = isReady && hasMeasurements && !isForensicOnly;
  const phase2Active = phase1Complete && !phase2Complete;

  // Phase 3: Supplement — needs carrier scope uploaded + comparison generated
  const phase3Complete = isReady && hasScope && hasComparison;
  const phase3Active = phase2Complete && !phase3Complete;

  // Phase 4: Job Completion — install supplements, COC, invoice
  const phase4Complete = lifecycle === "complete" || lifecycle === "paid" || hasCoc;
  const phase4Active = phase3Complete && !phase4Complete;

  return [
    {
      id: "forensic",
      label: "Forensic Report",
      shortLabel: "Forensic",
      description: phase1Complete
        ? "AI forensic report generated"
        : claim.status === "processing" || claim.status === "uploaded"
          ? "Processing your photos..."
          : "Upload photos to get started",
      status: phase1Complete ? "complete" : "active",
      ...(!phase1Complete && { action: claim.status === "processing" || claim.status === "uploaded" ? undefined : "Upload Photos" }),
    },
    {
      id: "estimate",
      label: "Xactimate Estimate",
      shortLabel: "Estimate",
      description: phase2Complete
        ? "Line-by-line estimate with code citations"
        : phase2Active
          ? "Upload measurements to unlock"
          : "Needs forensic report first",
      status: phase2Complete ? "complete" : phase2Active ? "active" : "locked",
      ...(phase2Active && { action: "Upload Measurements" }),
    },
    {
      id: "supplement",
      label: "Supplement Package",
      shortLabel: "Supplement",
      description: phase3Complete
        ? "Scope comparison + supplement ready"
        : phase3Active
          ? "Upload carrier scope to compare"
          : "Needs estimate first",
      status: phase3Complete ? "complete" : phase3Active ? "active" : "locked",
      ...(phase3Active && { action: "Upload Carrier Scope" }),
    },
    {
      id: "completion",
      label: "Job Completion",
      shortLabel: "Completion",
      description: phase4Complete
        ? "COC sent, job documented"
        : phase4Active
          ? "Install supplements, COC, invoicing"
          : "Needs supplement first",
      status: phase4Complete ? "complete" : phase4Active ? "active" : "locked",
    },
  ];
}

function PhaseIcon({ status, index }: { status: Phase["status"]; index: number }) {
  if (status === "complete") {
    return (
      <div className="w-8 h-8 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center shrink-0">
        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="w-8 h-8 rounded-full bg-[var(--cyan)]/20 border-2 border-[var(--cyan)] flex items-center justify-center shrink-0 animate-pulse">
        <span className="text-xs font-bold text-[var(--cyan)]">{index + 1}</span>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-white/5 border-2 border-white/10 flex items-center justify-center shrink-0">
      <span className="text-xs font-medium text-[var(--gray-dim)]">{index + 1}</span>
    </div>
  );
}

function ConnectorLine({ status }: { status: "complete" | "active" | "locked" }) {
  return (
    <div className={`hidden sm:block flex-1 h-0.5 mx-1 ${
      status === "complete" ? "bg-green-500/40" : "bg-white/10"
    }`} />
  );
}

export function ClaimLifecycleBar({ claim, onScrollTo }: { claim: Claim; onScrollTo?: (section: string) => void }) {
  const phases = getPhases(claim);
  const activeIndex = phases.findIndex((p) => p.status === "active");
  const completeCount = phases.filter((p) => p.status === "complete").length;

  return (
    <div className="glass-card p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)]">
          Claim Lifecycle
        </h3>
        <span className="text-xs text-[var(--gray-dim)]">
          {completeCount}/{phases.length} phases
        </span>
      </div>

      {/* Desktop: horizontal stepper */}
      <div className="hidden sm:flex items-center gap-1">
        {phases.map((phase, i) => (
          <div key={phase.id} className="contents">
            <button
              className="flex flex-col items-center gap-1.5 min-w-0 flex-1 group"
              onClick={() => phase.status !== "locked" && onScrollTo?.(phase.id)}
              disabled={phase.status === "locked"}
            >
              <PhaseIcon status={phase.status} index={i} />
              <span className={`text-[11px] font-medium text-center leading-tight ${
                phase.status === "complete" ? "text-green-400" :
                phase.status === "active" ? "text-[var(--cyan)]" :
                "text-[var(--gray-dim)]"
              }`}>
                {phase.shortLabel}
              </span>
            </button>
            {i < phases.length - 1 && (
              <ConnectorLine status={phases[i + 1].status === "complete" ? "complete" : "locked"} />
            )}
          </div>
        ))}
      </div>

      {/* Mobile: vertical compact list */}
      <div className="sm:hidden space-y-2">
        {phases.map((phase, i) => (
          <button
            key={phase.id}
            className="flex items-center gap-3 w-full text-left"
            onClick={() => phase.status !== "locked" && onScrollTo?.(phase.id)}
            disabled={phase.status === "locked"}
          >
            <PhaseIcon status={phase.status} index={i} />
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium ${
                phase.status === "complete" ? "text-green-400" :
                phase.status === "active" ? "text-[var(--cyan)]" :
                "text-[var(--gray-dim)]"
              }`}>
                {phase.label}
              </div>
              <div className="text-[11px] text-[var(--gray-dim)] truncate">
                {phase.description}
              </div>
            </div>
            {phase.action && phase.status === "active" && (
              <span className="text-[10px] font-semibold text-[var(--cyan)] bg-[var(--cyan)]/10 px-2 py-0.5 rounded-full shrink-0">
                {phase.action}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Active phase CTA — desktop only */}
      {activeIndex >= 0 && phases[activeIndex].action && (
        <div className="hidden sm:block mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--gray-muted)]">
              {phases[activeIndex].description}
            </p>
            <button
              className="text-xs font-semibold text-[var(--cyan)] hover:text-white transition-colors"
              onClick={() => onScrollTo?.(phases[activeIndex].id)}
            >
              {phases[activeIndex].action} &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
