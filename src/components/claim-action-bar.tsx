"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Claim } from "@/types/claim";

interface ClaimActionBarProps {
  claim: Claim;
  isReprocessing: boolean;
  onUpload: () => void;
  onReprocess: () => void;
}

type ActionKind = "primary" | "secondary";

interface Action {
  key: string;
  label: string;
  kind: ActionKind;
  onClick: () => void;
  disabled?: boolean;
}

const HIDDEN_STATUSES = new Set([
  "uploaded",
  "extracting",
  "processing",
  "qa_review_pending",
]);

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ClaimActionBar({ claim, isReprocessing, onUpload, onReprocess }: ClaimActionBarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const { primary, secondary, overflow } = useMemo<{ primary: Action; secondary: Action[]; overflow: Action[] }>(() => {
    const hasPDFs = (claim.output_files?.length ?? 0) > 0;
    const hasScope = Array.isArray(claim.scope_comparison) && claim.scope_comparison.length > 0;
    const hasMeasurements = (claim.measurement_files?.length ?? 0) > 0;
    const isWon = claim.claim_outcome === "won";
    const id = claim.id;

    const sendCarrier = () =>
      router.push(`/dashboard/send-document?claim=${id}&audience=carrier`);
    const sendHomeowner = () =>
      router.push(`/dashboard/send-document?claim=${id}&audience=homeowner`);
    const goSupplement = () => scrollToId("lifecycle-supplement");
    const goEstimate = () => scrollToId("lifecycle-estimate");
    const goInstalls = () => scrollToId("lifecycle-installs");
    const goCoc = () => scrollToId("lifecycle-coc");
    const goInvoice = () => scrollToId("lifecycle-invoice");

    if (isWon) {
      return {
        primary: { key: "install", label: "Send Install Supplement", kind: "primary" as const, onClick: goInstalls },
        secondary: [
          { key: "coc", label: "Generate CoC", kind: "secondary" as const, onClick: goCoc },
          { key: "invoice", label: "Generate Invoice", kind: "secondary" as const, onClick: goInvoice },
        ],
        overflow: [
          { key: "reprocess", label: "Reprocess Claim", kind: "secondary" as const, onClick: onReprocess, disabled: isReprocessing },
        ],
      };
    }

    if (hasScope) {
      // Post-scope: composer is the headline action
      return {
        primary: { key: "supplement", label: "Send Supplement", kind: "primary" as const, onClick: goSupplement },
        secondary: [
          { key: "upload", label: "Upload Files", kind: "secondary" as const, onClick: onUpload },
          { key: "reprocess", label: isReprocessing ? "Reprocessing…" : "Reprocess", kind: "secondary" as const, onClick: onReprocess, disabled: isReprocessing },
        ],
        overflow: [
          { key: "send-carrier", label: "Resend to Carrier", kind: "secondary" as const, onClick: sendCarrier },
          ...(hasMeasurements ? [{ key: "configure", label: "Configure Estimate", kind: "secondary" as const, onClick: goEstimate }] : []),
        ],
      };
    }

    if (hasPDFs) {
      // Pre-scope, PDFs ready
      return {
        primary: { key: "send-carrier", label: "Send to Carrier", kind: "primary" as const, onClick: sendCarrier },
        secondary: [
          { key: "send-homeowner", label: "Send to Homeowner", kind: "secondary" as const, onClick: sendHomeowner },
          { key: "upload", label: "Upload Files", kind: "secondary" as const, onClick: onUpload },
        ],
        overflow: [
          { key: "reprocess", label: isReprocessing ? "Reprocessing…" : "Reprocess", kind: "secondary" as const, onClick: onReprocess, disabled: isReprocessing },
          ...(hasMeasurements ? [{ key: "configure", label: "Configure Estimate", kind: "secondary" as const, onClick: goEstimate }] : []),
        ],
      };
    }

    // No PDFs yet — generate first run
    return {
      primary: { key: "generate", label: isReprocessing ? "Generating…" : "Generate Reports", kind: "primary" as const, onClick: onReprocess, disabled: isReprocessing },
      secondary: [
        { key: "upload", label: "Upload Files", kind: "secondary" as const, onClick: onUpload },
      ],
      overflow: hasMeasurements
        ? [{ key: "configure", label: "Configure Estimate", kind: "secondary" as const, onClick: goEstimate }]
        : [],
    };
  }, [claim.id, claim.output_files, claim.scope_comparison, claim.measurement_files, claim.claim_outcome, isReprocessing, onReprocess, onUpload, router]);

  if (HIDDEN_STATUSES.has(claim.status)) return null;

  const renderButton = (a: Action) => {
    if (a.kind === "primary") {
      return (
        <button
          key={a.key}
          onClick={a.onClick}
          disabled={a.disabled}
          className="bg-gradient-to-br from-[var(--pink)]/15 to-[var(--blue)]/15 border border-[var(--pink)]/30 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-[var(--pink)]/25 hover:border-[var(--pink)]/50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {a.label}
        </button>
      );
    }
    return (
      <button
        key={a.key}
        onClick={a.onClick}
        disabled={a.disabled}
        className="bg-white/[0.04] border border-white/[0.1] text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {a.label}
      </button>
    );
  };

  return (
    <>
      {/* Mobile: full bottom bar — `sm:hidden` */}
      <div
        className="sm:hidden fixed left-0 right-0 bottom-0 z-30 bg-[var(--navy)]/95 backdrop-blur-xl border-t border-white/[0.08]"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
      >
        {/* Right side reserves 96px for the Richard FAB (bottom-right floating launcher) */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-3 pr-[96px] overflow-x-auto">
          {renderButton(primary)}
          {secondary.map(renderButton)}
          {overflow.length > 0 && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="bg-white/[0.04] border border-white/[0.1] text-[var(--gray-muted)] hover:text-white px-3 py-2 rounded-lg text-sm transition-colors"
                aria-label="More actions"
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="absolute bottom-full right-0 mb-2 min-w-[200px] bg-[var(--navy)] border border-white/[0.1] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)] py-1">
                  {overflow.map((a) => (
                    <button
                      key={a.key}
                      onClick={() => { setMenuOpen(false); a.onClick(); }}
                      disabled={a.disabled}
                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Desktop: centered floating pill — `hidden sm:flex` */}
      <div className="hidden sm:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-30 max-w-[640px]">
        <div className="flex items-center gap-2 bg-[var(--navy)]/95 backdrop-blur-xl border border-white/[0.1] rounded-full px-3 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          {renderButton(primary)}
          {secondary.map(renderButton)}
          {overflow.length > 0 && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="bg-white/[0.04] border border-white/[0.1] text-[var(--gray-muted)] hover:text-white px-3 py-2 rounded-lg text-sm transition-colors"
                aria-label="More actions"
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="absolute bottom-full right-0 mb-2 min-w-[200px] bg-[var(--navy)] border border-white/[0.1] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)] py-1">
                  {overflow.map((a) => (
                    <button
                      key={a.key}
                      onClick={() => { setMenuOpen(false); a.onClick(); }}
                      disabled={a.disabled}
                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
