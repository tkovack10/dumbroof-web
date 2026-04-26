"use client";

/**
 * "What can dumbroof do for this claim?" widget — top of /dashboard/new-claim.
 *
 * Three things this widget does:
 *  1. Tells users what each upload combo unlocks (photos → forensic, photos +
 *     measurements → forensic + Xact + code compliance, etc.) — bullets light
 *     up live as they add files in the form below.
 *  2. Surfaces advanced features (AOB digital signature, COC scheduling,
 *     day-of-job supplements) so non-power users discover them.
 *  3. Lists the automatic customer touchpoints so users see what dumbroof
 *     does WITHOUT them having to wire anything.
 *
 * Tom on Apr 26: "we really want users to know about these features."
 *
 * Anchor: ~/.claude/plans/glimmering-scribbling-steele.md (Phase C)
 */

import { useState } from "react";

interface FeatureChecklistProps {
  hasPhotos: boolean;
  hasMeasurements: boolean;
  hasCarrierScope: boolean;
}

interface CoreRowProps {
  checked: boolean;
  current: boolean;
  title: string;
  outputs: string[];
}

function CoreRow({ checked, current, title, outputs }: CoreRowProps) {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
        checked ? "bg-emerald-500/[0.06] border border-emerald-500/20" : current ? "bg-white/[0.04] border border-white/10" : "border border-transparent"
      }`}
    >
      <span
        className={`shrink-0 w-5 h-5 rounded-full mt-0.5 flex items-center justify-center text-[10px] font-bold ${
          checked
            ? "bg-emerald-500 text-emerald-950"
            : current
            ? "border-2 border-[var(--cyan)] text-[var(--cyan)]"
            : "border border-white/20"
        }`}
        aria-hidden="true"
      >
        {checked ? "✓" : current ? "●" : ""}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${checked ? "text-white" : current ? "text-white" : "text-white/60"}`}>
          {title}
        </div>
        <ul className="mt-1 space-y-0.5">
          {outputs.map((o, i) => (
            <li key={i} className={`text-xs ${checked ? "text-emerald-300" : "text-white/50"}`}>
              → {o}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface AdvancedRowProps {
  title: string;
  outputs: string[];
}

function AdvancedRow({ title, outputs }: AdvancedRowProps) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.02]">
      <span className="shrink-0 w-5 h-5 rounded-full mt-0.5 border border-white/20 flex items-center justify-center" aria-hidden="true">
        <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white/80">{title}</span>
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
            Coming soon
          </span>
        </div>
        <ul className="mt-1 space-y-0.5">
          {outputs.map((o, i) => (
            <li key={i} className="text-xs text-white/40">
              → {o}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function NewClaimFeatureChecklist({
  hasPhotos,
  hasMeasurements,
  hasCarrierScope,
}: FeatureChecklistProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Core feature combos — checked when fully met, "current" when this is the
  // user's actual current upload tier (next-up indicator).
  const photosOnlyChecked = hasPhotos;
  const photosMeasChecked = hasPhotos && hasMeasurements;
  const photosMeasScopeChecked = hasPhotos && hasMeasurements && hasCarrierScope;

  // Indicate which row is the user's CURRENT tier (highest matched tier).
  const currentTier = photosMeasScopeChecked
    ? 3
    : photosMeasChecked
    ? 2
    : photosOnlyChecked
    ? 1
    : 0;

  return (
    <div className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-glass)] overflow-hidden mb-6">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
        aria-expanded={!collapsed}
      >
        <div>
          <div className="text-sm font-semibold text-white">What can dumbroof do for this claim?</div>
          <div className="text-xs text-white/50 mt-0.5">
            Currently:{" "}
            {currentTier === 0
              ? "Add photos to unlock the forensic report"
              : currentTier === 1
              ? "Forensic Report"
              : currentTier === 2
              ? "Forensic Report + Build Scope + Code Compliance"
              : "Forensic + Build Scope + Scope Comparison + Supplement Automation"}
          </div>
        </div>
        <span className="text-white/30 text-xs">{collapsed ? "Show" : "Hide"}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-1">
          {/* Core feature tiers */}
          <CoreRow
            checked={photosOnlyChecked}
            current={currentTier === 1}
            title="Photos only"
            outputs={["Forensic Causation Report"]}
          />
          <CoreRow
            checked={photosMeasChecked}
            current={currentTier === 2}
            title="Photos + measurements (EagleView, HOVER)"
            outputs={["Forensic Report", "Xactimate-Style Build Scope", "Code Compliance Report"]}
          />
          <CoreRow
            checked={photosMeasScopeChecked}
            current={currentTier === 3}
            title="Photos + measurements + carrier scope"
            outputs={[
              "Everything above",
              "Scope Comparison (line-by-line vs carrier)",
              "Supplement Automation (AI-drafted email + evidence pack)",
            ]}
          />

          {/* Advanced features — informational for now, wiring lands in Phase C v2 */}
          <div className="pt-3 pb-1 px-2">
            <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">
              Advanced features
            </div>
          </div>
          <AdvancedRow
            title="Upload contingency / AOB"
            outputs={["Digital signature flow", "Auto-schedule email cadence after signature"]}
          />
          <AdvancedRow
            title="Upload an already-signed agreement"
            outputs={["Skip signature step", "Go straight to email cadence"]}
          />
          <AdvancedRow
            title="Upload Certificate of Completion (COC)"
            outputs={["Auto-schedule COC delivery to homeowner + carrier"]}
          />
          <AdvancedRow
            title="Day-of-job supplement triggers"
            outputs={["Real-time supplement detection during the install"]}
          />

          {/* Customer touchpoints — explains automatic emails */}
          <div className="pt-3 pb-1 px-2">
            <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">
              Automatic customer touchpoints
            </div>
          </div>
          <div className="px-3 py-3 rounded-lg bg-indigo-500/[0.06] border border-indigo-500/20 text-xs text-white/60">
            <div className="text-white/80 font-semibold text-[13px] mb-1.5">Every claim auto-sends:</div>
            <ul className="space-y-1">
              <li>• Pre-inspection notice (after AOB signed)</li>
              <li>• Forensic report delivery (after processing)</li>
              <li>• Supplement notice (after carrier rebuttal)</li>
              <li>• COC delivery (after install)</li>
              <li>• Final invoice</li>
            </ul>
            <div className="text-white/40 text-[11px] mt-2">
              Cadence is configurable in{" "}
              <a href="/dashboard/settings#email" className="text-indigo-300 hover:text-indigo-200 underline">
                Settings → Email
              </a>
              .
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
