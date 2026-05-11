"use client";

import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
}

/**
 * Documents tab — generated PDFs (with click-to-send) on top, source documents
 * below. Mobile collapses this tab into Overview (per the IA spec) — see
 * V2_MOBILE_TABS in types.ts.
 */
export function DocumentsTab({ slots }: Props) {
  const generated = slots.generatedDocs ?? slots.lockedEstimate;
  const source = slots.sourceDocs;

  return (
    <div className="space-y-4">
      {generated && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-[var(--gray-muted)] mb-3">
            Generated documents
          </h3>
          {generated}
        </section>
      )}
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
