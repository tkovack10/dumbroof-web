"use client";

import { useState } from "react";
import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
}

/**
 * Photos tab — collapsible "Refine photos" panel sits above the RoofPhotoMap
 * per-slope diagram. Editor is Phase 3c-3 embedded PhotoReviewContent; same
 * pattern as the Scope tab's "Refine line items". Default collapsed because
 * the editor is 653 LOC of UI; PhotoReviewContent only mounts when opened.
 *
 * Standalone /dashboard/photo-review route still works for direct links.
 */
export function PhotosTab({ slots }: Props) {
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <div className="space-y-4">
      {slots.photoEditor && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl overflow-hidden">
          <button
            onClick={() => setEditorOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
            aria-expanded={editorOpen}
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-white">Refine photos</p>
              <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                Approve, reject, edit tags, or correct annotations without leaving the claim.
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
              {slots.photoEditor}
            </div>
          )}
        </section>
      )}

      {slots.roofPhotoMap && (
        <section>{slots.roofPhotoMap}</section>
      )}
      {!slots.roofPhotoMap && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-6 text-center">
          <div className="text-[var(--gray-muted)] text-sm">
            Per-slope photo map will appear here once an EagleView measurement file is processed.
          </div>
        </section>
      )}
    </div>
  );
}
