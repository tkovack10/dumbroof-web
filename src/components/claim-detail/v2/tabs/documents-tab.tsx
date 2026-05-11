"use client";

import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
  isReprocessing?: boolean;
}

/**
 * Documents tab — generated PDFs (with click-to-send) on top, source documents
 * below. Mobile collapses this tab into Overview (per the IA spec) — see
 * V2_MOBILE_TABS in types.ts.
 *
 * When reprocessing, the generated docs block is empty (slot returns null
 * because isReady=false). Show a placeholder so the user understands what's
 * happening (Bug A fix — was a black void during the ~30s pipeline run).
 */
export function DocumentsTab({ slots, isReprocessing = false }: Props) {
  const generated = slots.generatedDocs ?? slots.lockedEstimate;
  const source = slots.sourceDocs;

  return (
    <div className="space-y-4">
      {generated ? (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-[var(--gray-muted)] mb-3">
            Generated documents
          </h3>
          {generated}
        </section>
      ) : isReprocessing ? (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5 text-center">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-[var(--gray-muted)] mb-3">
            Generated documents
          </h3>
          <div className="flex flex-col items-center gap-2 py-6">
            <svg className="animate-spin w-6 h-6 text-[var(--cyan)]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-sm text-white">Regenerating your reports…</p>
            <p className="text-xs text-[var(--gray-muted)] max-w-sm">
              This usually takes ~30 seconds. Your forensic, estimate, scope comparison, supplement letter, and cover email will refresh here automatically when done.
            </p>
          </div>
        </section>
      ) : null}
      {source && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-[var(--gray-muted)] mb-3">
            Source documents
          </h3>
          {source}
        </section>
      )}
      {slots.uploadDocsBlock && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-[var(--gray-muted)] mb-3">
            Add more documents
          </h3>
          {slots.uploadDocsBlock}
        </section>
      )}
    </div>
  );
}
