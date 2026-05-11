"use client";

import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
}

/**
 * Scope tab — Tom's Financial-first ask is enforced inside the
 * ScopeComparison component itself (Phase 1 ship: cyan-active Financial tab
 * is the default). Below it: Estimate, Estimate Configuration, then the
 * Supplement Composer with code citations bound to selection (Phase 3 will
 * wire the cross-component selection state).
 *
 * Order is the workflow loop: see the variance → understand line items →
 * configure roof/gutters/siding → build the supplement.
 */
export function ScopeTab({ slots }: Props) {
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

      {slots.estimateConfig && (
        <section>{slots.estimateConfig}</section>
      )}
    </div>
  );
}
