"use client";

import { useState } from "react";
import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
}

/**
 * Scope tab — Tom's Financial-first ask is enforced inside the
 * ScopeComparison component itself (Phase 1 ship: cyan-active Financial tab
 * is the default). Below it: Supplement Composer, Estimate (read-only browse),
 * Refine Line Items (collapsible editable mode — Phase 3c-2), then config.
 *
 * Order is the workflow loop: see the variance → build the supplement →
 * browse line items → edit them inline → configure roof/gutters/siding.
 *
 * The "Refine line items" panel is collapsed by default — opening it would
 * blow up the tab height (528 LOC of editable UI). Tom asked for the editor
 * to live INSIDE the per-claim page (no /scope-review navigation), so the
 * collapsible reveal is the MVP UX. Standalone route still works for direct
 * links.
 */
export function ScopeTab({ slots }: Props) {
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <div className="space-y-4">
      {slots.scopeComparison || (slots.lockedScopeComparison && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
          {slots.lockedScopeComparison}
        </section>
      ))}

      {slots.supplementComposer && (
        <section>{slots.supplementComposer}</section>
      )}

      {slots.estimateView || (slots.lockedEstimate && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
          {slots.lockedEstimate}
        </section>
      ))}

      {slots.estimateEditor && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl overflow-hidden">
          <button
            onClick={() => setEditorOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
            aria-expanded={editorOpen}
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-white">Refine line items</p>
              <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                Approve, edit, remove, or add line items without leaving the claim.
              </p>
            </div>
            <svg
              className={`w-4 h-4 text-[var(--gray-muted)] transition-transform ${editorOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {editorOpen && (
            <div className="px-4 sm:px-5 pb-5 border-t border-white/[0.08]">
              {slots.estimateEditor}
            </div>
          )}
        </section>
      )}

      {slots.estimateConfig && (
        <section>{slots.estimateConfig}</section>
      )}
    </div>
  );
}
