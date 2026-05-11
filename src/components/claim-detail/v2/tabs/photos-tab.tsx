"use client";

import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
}

/**
 * Photos tab — RoofPhotoMap (per-slope diagram) is the centerpiece. Below
 * it the photo grid lives via the existing /dashboard/photo-review route
 * (Phase 3 will inline a single PhotoEditor with mode prop here).
 */
export function PhotosTab({ slots }: Props) {
  return (
    <div className="space-y-4">
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
