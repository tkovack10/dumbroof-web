"use client";

import type { Claim } from "@/types/claim";

interface HighlightsPanelProps {
  claim: Claim;
  win?: { orig: number; updated: number; move: number; pct: number } | null;
  isReprocessing: boolean;
  onUpload: () => void;
  onReprocess: () => void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  // After firing onUpload (which sets showUpload=true on the page), v2 also
  // needs to switch the active tab to Documents so the form is visible. v1
  // doesn't pass this — the form appears inline at its own anchor.
  onUploadGoToDocuments?: () => void;
}

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Sticky top of the v2 per-claim page. Always visible while scrolling.
 * Compact 2-row layout on mobile, single-row with inline actions on desktop.
 *
 * Visual language pulled from Kristen's Meta Ads dashboard (see Phase 1
 * commit 31b0bb8): bg-[var(--navy)]/95 + border-white/[0.08], color used
 * sparingly, brand gradient reserved for the primary action button only.
 */
export function HighlightsPanel({
  claim,
  win,
  isReprocessing,
  onUpload,
  onReprocess,
  onPrimaryAction,
  primaryActionLabel,
  onUploadGoToDocuments,
}: HighlightsPanelProps) {
  const carrierLabel = claim.carrier || "Unknown carrier";
  const phaseLabel = claim.phase === "pre-scope" ? "Pre-Scope" : claim.phase === "supplement" ? "Supplement" : claim.phase || "Active";
  const dolLabel = claim.date_of_loss ? new Date(claim.date_of_loss).toLocaleDateString() : null;
  const variance = (claim.contractor_rcv ?? 0) - (claim.current_carrier_rcv ?? claim.original_carrier_rcv ?? 0);
  const variancePct = (claim.original_carrier_rcv ?? 0) > 0
    ? Math.round((variance / (claim.original_carrier_rcv ?? 1)) * 100)
    : null;

  return (
    <div
      className="sticky top-[60px] z-20 bg-[var(--navy)]/95 backdrop-blur-xl border-b border-white/[0.08]"
      role="banner"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-start sm:items-center justify-between gap-3">
          {/* Title + meta */}
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-xl font-bold text-white truncate leading-tight">
              {claim.address || "Untitled claim"}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] sm:text-xs text-[var(--gray-muted)]">
              <span>{carrierLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{phaseLabel}</span>
              {claim.claim_number && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>#{claim.claim_number}</span>
                </>
              )}
              {dolLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>DOL {dolLabel}</span>
                </>
              )}
            </div>
          </div>

          {/* Desktop inline actions */}
          {onPrimaryAction && (
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <button
                onClick={onPrimaryAction}
                className="bg-gradient-to-br from-[var(--pink)]/15 to-[var(--blue)]/15 border border-[var(--pink)]/30 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-[var(--pink)]/25 hover:border-[var(--pink)]/50 whitespace-nowrap"
              >
                {primaryActionLabel || "Continue"}
              </button>
              <button
                onClick={() => {
                  onUpload();
                  onUploadGoToDocuments?.();
                }}
                className="bg-white/[0.04] border border-white/[0.1] text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/[0.08] whitespace-nowrap"
              >
                Upload
              </button>
              <button
                onClick={onReprocess}
                disabled={isReprocessing}
                className="bg-white/[0.04] border border-white/[0.1] text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isReprocessing ? "Reprocessing…" : "Reprocess"}
              </button>
            </div>
          )}
        </div>

        {/* Variance + chips row */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {variance !== 0 && (
            <span
              className={`inline-flex items-baseline gap-1 px-2.5 py-1 rounded-md border text-sm font-bold ${
                variance > 0
                  ? "text-green-400 bg-green-500/15 border-green-500/30"
                  : "text-red-400 bg-red-500/15 border-red-500/30"
              }`}
            >
              {variance > 0 ? "+" : ""}
              {fmtMoney(variance)}
              {variancePct !== null && (
                <span className="text-[10px] font-semibold opacity-80">
                  {variancePct > 0 ? "+" : ""}
                  {variancePct}%
                </span>
              )}
            </span>
          )}
          {win && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--pink)]/15 text-[var(--pink)] border border-[var(--pink)]/30">
              CARRIER MOVED
            </span>
          )}
          {claim.trade_count != null && claim.trade_count >= 3 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--cyan)]/15 text-[var(--cyan)] border border-[var(--cyan)]/30">
              {claim.trade_count} trades
            </span>
          )}
          {claim.o_and_p_enabled && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
              O&amp;P
            </span>
          )}
          {(claim.pending_drafts ?? 0) > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--pink)]/15 text-[var(--pink)] border border-[var(--pink)]/30">
              {claim.pending_drafts} draft{(claim.pending_drafts ?? 0) > 1 ? "s" : ""} pending
            </span>
          )}
          {(claim.pending_edits ?? 0) > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
              {claim.pending_edits} edit request{(claim.pending_edits ?? 0) > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
