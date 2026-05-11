"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Claim } from "@/types/claim";
import type { ActiveSupplementItem } from "./types";

interface InspectorProps {
  claim: Claim;
  contactCard: ReactNode;
  editFieldsCard: ReactNode;
  timelineRail: ReactNode;
  activeSupplementItem?: ActiveSupplementItem | null;
  onClearActive?: () => void;
}

/**
 * Right-rail inspector on desktop (≥lg). On smaller screens, the inspector
 * collapses behind a slide-up bottom sheet triggered by the ⓘ button in the
 * highlights panel — but the highlights panel for now only shows the button
 * on mobile via the InspectorMobileTrigger below. Both sources render the
 * same content so there's a single source of truth.
 *
 * Apple Pages / Final Cut "Inspector" pattern: persistent metadata about the
 * selected object, separate from the canvas, hide-able via toolbar toggle.
 */
export function Inspector({ claim, contactCard, editFieldsCard, timelineRail, activeSupplementItem, onClearActive }: InspectorProps) {
  return (
    <aside
      className="hidden lg:block sticky top-[200px] self-start w-[320px] shrink-0 max-h-[calc(100vh-220px)] overflow-y-auto pl-6 pr-2 py-2 space-y-4"
      aria-label="Claim inspector"
    >
      {activeSupplementItem && (
        <ActiveSelectionCard item={activeSupplementItem} onClear={onClearActive} />
      )}
      <DamageScoreCard claim={claim} />
      <Section title="Contact details">{contactCard}</Section>
      <Section title="Editable fields">{editFieldsCard}</Section>
      <Section title="Timeline">{timelineRail}</Section>
    </aside>
  );
}

interface MobileSheetProps {
  claim: Claim;
  contactCard: ReactNode;
  editFieldsCard: ReactNode;
  timelineRail: ReactNode;
  open: boolean;
  onClose: () => void;
  activeSupplementItem?: ActiveSupplementItem | null;
  onClearActive?: () => void;
}

/**
 * Bottom-sheet variant of the inspector for mobile + tablet (< lg). Slides up
 * from the bottom of the viewport when the ⓘ button in the highlights panel
 * is tapped. Apple HIG sheet pattern: scoped task closely related to current
 * context, dismissible by tapping the backdrop or swiping down.
 */
export function InspectorMobileSheet({
  claim,
  contactCard,
  editFieldsCard,
  timelineRail,
  open,
  onClose,
  activeSupplementItem,
  onClearActive,
}: MobileSheetProps) {
  // Lock body scroll when open so the sheet can scroll independently
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div
        className={`lg:hidden fixed left-0 right-0 bottom-0 z-50 max-h-[80vh] bg-[var(--navy)] border-t border-white/[0.1] rounded-t-2xl shadow-[0_-12px_48px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Claim details"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/[0.2]" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold text-white">Claim details</h2>
          <button
            onClick={onClose}
            className="text-[var(--gray-muted)] hover:text-white text-xl leading-none p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(80vh - 60px)" }}>
          {activeSupplementItem && (
            <ActiveSelectionCard item={activeSupplementItem} onClear={onClearActive} />
          )}
          <DamageScoreCard claim={claim} />
          <Section title="Contact details">{contactCard}</Section>
          <Section title="Editable fields">{editFieldsCard}</Section>
          <Section title="Timeline">{timelineRail}</Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--gray-muted)] hover:text-white transition-colors mb-2"
        aria-expanded={open}
      >
        {title}
        <span className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${open ? "opacity-100" : "max-h-0 opacity-0"}`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Cross-tab linking: when the user clicks any row in the SupplementComposer,
 * this card surfaces in the Inspector with the item details + matching code
 * citation. Apple Pages "selection-binds-the-inspector" pattern.
 */
function ActiveSelectionCard({ item, onClear }: { item: ActiveSupplementItem; onClear?: () => void }) {
  const typeStyle =
    item.type === "missing"
      ? "text-red-400 bg-red-500/15 border-red-500/30"
      : item.type === "under"
      ? "text-amber-400 bg-amber-500/15 border-amber-500/30"
      : "text-[var(--cyan)] bg-[var(--cyan)]/15 border-[var(--cyan)]/30";

  return (
    <section className="bg-gradient-to-br from-[var(--cyan)]/8 to-[var(--blue)]/8 border border-[var(--cyan)]/30 rounded-xl p-4 animate-in">
      <header className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--cyan)]">
          Active selection
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="text-[var(--gray-muted)] hover:text-white text-sm leading-none"
            aria-label="Clear selection"
            title="Clear"
          >
            ×
          </button>
        )}
      </header>
      <div className="text-sm font-semibold text-white leading-tight">{item.label}</div>
      <div className="flex items-center gap-2 mt-2">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase ${typeStyle}`}>
          {item.type}
        </span>
        {item.amount > 0 && (
          <span className="text-sm font-bold text-green-400 tabular-nums">
            +${Math.round(item.amount).toLocaleString()}
          </span>
        )}
      </div>
      {item.detail && (
        <p className="text-[11px] text-[var(--gray)] mt-2 leading-relaxed line-clamp-3">
          {item.detail}
        </p>
      )}
      {item.codeCitation && (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--gray-muted)] mb-1">
            Code authority
          </div>
          <div className="text-xs font-bold text-[var(--cyan)]">{item.codeCitation.code_tag}</div>
          <div className="text-[11px] text-white mt-0.5">{item.codeCitation.title}</div>
          {item.codeCitation.requirement && (
            <p className="text-[10px] text-[var(--gray)] mt-1.5 leading-relaxed line-clamp-3">
              {item.codeCitation.requirement}
            </p>
          )}
          {item.codeCitation.has_warranty_void && (
            <div className="mt-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
              WARRANTY VOID WITHOUT THIS ITEM
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DamageScoreCard({ claim }: { claim: Claim }) {
  // Phase 2 keeps the existing score; Phase 3 will redesign with the
  // "Strong: hail-soft-metal-strike" actionable why-line.
  if (claim.damage_score == null) return null;
  const score = Math.round(claim.damage_score);
  const grade = claim.damage_grade || "";
  return (
    <div className="bg-gradient-to-br from-[var(--pink)]/10 to-[var(--blue)]/10 border border-[var(--pink)]/25 rounded-xl p-4 text-center">
      <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--gray-muted)] mb-1">Damage score</div>
      <div
        className="text-3xl font-extrabold leading-none bg-gradient-to-r from-green-400 to-[var(--cyan)] bg-clip-text text-transparent"
      >
        {score}
      </div>
      <div className="text-[10px] text-[var(--gray-muted)] mt-1">/ 100</div>
      {grade && (
        <div className="text-xs font-semibold text-white mt-2 capitalize">{grade.toLowerCase()}</div>
      )}
    </div>
  );
}
