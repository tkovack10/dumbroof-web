"use client";

import { useCallback, useRef, useState } from "react";
import type { DragEvent } from "react";

// ── Single agentic drop box ───────────────────────────────────────────────
// "Drop anything, we figure it out, you can fix it."
//
// Replaces the separate typed dropzones (photos / measurements / scope) with
// ONE zone that accepts any file. Per dropped file we:
//   1. POST the raw file to /api/classify-intake (multipart) → {category} —
//      this NEVER blocks and works anonymously (no storage_path = no auth gate),
//   2. upload it via the host's `uploadFile(file, category)` straight into the
//      detected folder (so downstream claim-creation reads it correctly), then
//   3. show a per-file chip with a small dropdown so the user can CORRECT it.
//      Correcting re-stages the file into the new folder via `uploadFile` again.
//
// Classification NEVER blocks the upload: on any error/timeout the file is kept
// and defaults to a sensible guess (image → photos, else other) the user can
// override.
//
// The component is upload-mechanism-agnostic — the host passes a `uploadFile`
// that stages the file wherever it needs (anon-instant-intake/... for the
// funnel, {user_id}/{slug}/... for authed surfaces) given the chosen category.
// The live per-file category is surfaced via `onItemsChange`.

export type IntakeCategory = "photos" | "measurements" | "scope" | "other";

export const CATEGORY_META: Record<
  IntakeCategory,
  { label: string; icon: string }
> = {
  photos: { label: "Roof photos", icon: "📷" },
  measurements: { label: "Measurements", icon: "📐" },
  scope: { label: "Carrier scope", icon: "📄" },
  other: { label: "Other", icon: "📎" },
};

const CATEGORY_ORDER: IntakeCategory[] = ["photos", "measurements", "scope", "other"];

export type DropItemStatus = "classifying" | "uploading" | "ready" | "error";

export interface DropItem {
  id: string;
  name: string;
  size: number;
  /** The underlying File — lets a host stage on its own schedule (e.g. the
   *  funnel stages once at unlock-time, avoiding cross-folder duplicates that
   *  immediate re-staging-on-correction would otherwise create). */
  file: File;
  /** Object URL for image previews (revoked by the host or on unmount). */
  previewUrl?: string;
  status: DropItemStatus;
  /** The detected (or user-corrected) intake category. */
  category: IntakeCategory;
  /** True once the user manually overrode the auto-detected category. */
  corrected?: boolean;
}

/** Endpoint that classifies a dropped file (multipart, anonymous-safe). */
const CLASSIFY_URL = `${
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://dumbroof-backend-production.up.railway.app"
}/api/classify-intake`;

export interface AgenticDropZoneProps {
  /**
   * Stage one file into the given category folder wherever the host needs it
   * (anon-instant-intake/... for the funnel, {user_id}/{slug}/... for authed
   * surfaces). Throw to mark the item errored (the file is NOT kept). Called
   * again when the user corrects a file's category to re-stage it.
   *
   * Hosts that stage on their own schedule (e.g. the funnel stages at unlock)
   * pass a no-op resolver and read the files off `onItemsChange` instead — set
   * `deferStaging` so the zone skips the on-drop / on-correct upload calls.
   */
  uploadFile?: (file: File, category: IntakeCategory) => Promise<void>;
  /** When true, never call uploadFile — the host stages from the items list. */
  deferStaging?: boolean;
  /**
   * Optional auth headers factory for the classify call. The anonymous funnel
   * omits this — multipart classification needs no auth. Authed surfaces pass
   * a bearer token (harmless either way).
   */
  getAuthHeaders?: () => Promise<Record<string, string>>;
  /** Fires whenever the item list changes (new file, status, or category). */
  onItemsChange?: (items: DropItem[]) => void;
  /** Compact styling for the in-chat variant. */
  compact?: boolean;
  className?: string;
  /** Override the idle headline / hint. */
  title?: string;
  hint?: string;
}

function guessCategory(file: File): IntakeCategory {
  if (file.type.startsWith("image/")) return "photos";
  const lower = file.name.toLowerCase();
  if (/\.(heic|heif|jpg|jpeg|png|webp|tiff?|bmp|gif)$/.test(lower)) return "photos";
  return "other";
}

async function classifyFile(
  file: File,
  getAuthHeaders?: () => Promise<Record<string, string>>
): Promise<IntakeCategory | null> {
  try {
    const authHeaders = getAuthHeaders ? await getAuthHeaders() : {};
    const fd = new FormData();
    fd.append("file", file);
    fd.append("filename", file.name);
    // NOTE: no Content-Type header — the browser sets the multipart boundary.
    const res = await fetch(CLASSIFY_URL, { method: "POST", headers: authHeaders, body: fd });
    if (!res.ok) return null;
    const data = (await res.json()) as { category?: string };
    const c = data.category;
    if (c === "photos" || c === "measurements" || c === "scope" || c === "other") {
      return c;
    }
    return null;
  } catch {
    // classify never blocks — fall back to the upfront guess.
    return null;
  }
}

export function AgenticDropZone({
  uploadFile,
  deferStaging = false,
  getAuthHeaders,
  onItemsChange,
  compact = false,
  className = "",
  title = "Drop anything — photos, a measurement report, or the carrier's estimate",
  hint = "Richard figures out what each file is. You can fix it if he's wrong.",
}: AgenticDropZoneProps) {
  const [items, setItems] = useState<DropItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mirror items in a ref so a category correction can read the underlying File
  // without depending on `items` (keeps `correct` stable + side-effect-free in
  // the state updater).
  const itemsRef = useRef<DropItem[]>(items);
  itemsRef.current = items;

  // Keep onItemsChange in a ref so the callback can fire the latest list from
  // inside the functional state updater without re-creating handlers.
  const onItemsChangeRef = useRef(onItemsChange);
  onItemsChangeRef.current = onItemsChange;

  const patchItem = useCallback((id: string, patch: Partial<DropItem>) => {
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, ...patch } : it));
      onItemsChangeRef.current?.(next);
      return next;
    });
  }, []);

  const ingest = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        const initial: DropItem = {
          id,
          name: file.name,
          size: file.size,
          file,
          previewUrl,
          status: "classifying",
          category: guessCategory(file),
        };
        setItems((prev) => {
          const next = [...prev, initial];
          onItemsChangeRef.current?.(next);
          return next;
        });

        // 1. Ask the backend what this is (multipart — anonymous-safe, never
        //    blocks). Fall back to the upfront guess on any failure.
        const detected = (await classifyFile(file, getAuthHeaders)) ?? guessCategory(file);

        // 2. Stage the file into the detected folder — unless the host stages
        //    on its own schedule (deferStaging), in which case we just mark it
        //    ready and the host reads the file off the items list.
        if (deferStaging || !uploadFile) {
          patchItem(id, { status: "ready", category: detected });
          continue;
        }
        patchItem(id, { status: "uploading", category: detected });
        try {
          await uploadFile(file, detected);
          patchItem(id, { status: "ready" });
        } catch {
          patchItem(id, { status: "error" });
        }
      }
    },
    [uploadFile, deferStaging, getAuthHeaders, patchItem]
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const dropped = Array.from(e.dataTransfer.files || []);
      if (dropped.length) ingest(dropped);
    },
    [ingest]
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(e.target.files || []);
      if (picked.length) ingest(picked);
      e.target.value = "";
    },
    [ingest]
  );

  const correct = useCallback(
    async (id: string, category: IntakeCategory) => {
      // Reflect the choice immediately. When the host stages on its own
      // schedule, this is all that's needed — it reads the final category off
      // the items list. Immediate-staging hosts re-stage into the new folder.
      const file = itemsRef.current.find((it) => it.id === id)?.file;
      const willStage = !deferStaging && !!uploadFile && !!file;
      patchItem(id, { category, corrected: true, status: willStage ? "uploading" : "ready" });
      if (!willStage || !file) return;
      try {
        await uploadFile(file, category);
        patchItem(id, { status: "ready" });
      } catch {
        patchItem(id, { status: "error" });
      }
    },
    [patchItem, uploadFile, deferStaging]
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((it) => it.id !== id);
      onItemsChangeRef.current?.(next);
      return next;
    });
  }, []);

  const openPicker = useCallback(() => {
    if (!inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.click();
  }, []);

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={onDrop}
        onClick={openPicker}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        className={`relative border-2 border-dashed rounded-xl text-center transition-colors cursor-pointer ${
          compact ? "p-4" : "p-6"
        } ${
          dragging
            ? "border-[var(--red)] bg-[var(--pink)]/10"
            : items.length > 0
              ? "border-green-300/60 bg-green-500/[0.06]"
              : "border-[var(--border-glass)] bg-[var(--bg-glass)]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          // Accept literally anything — the classifier sorts it.
          onChange={onPick}
          className="sr-only"
        />
        <svg
          className={`mx-auto mb-2 text-[var(--gray-dim)] ${compact ? "w-6 h-6" : "w-8 h-8"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className={`font-medium text-[var(--white)] ${compact ? "text-xs" : "text-sm"}`}>
          {title}
        </p>
        <p className={`text-[var(--gray-muted)] mt-1 ${compact ? "text-[11px]" : "text-xs"}`}>
          {hint}
        </p>
      </div>

      {items.length > 0 && (
        <div className="mt-3 space-y-2">
          {items.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--border-glass)] bg-[var(--bg-glass)] px-2.5 py-2"
            >
              {it.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.previewUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : (
                <span className="w-8 h-8 rounded bg-indigo-500/15 flex items-center justify-center text-sm shrink-0">
                  {CATEGORY_META[it.category].icon}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--white)] truncate">{it.name}</span>
                  <span className="text-[10px] text-[var(--gray-dim)] shrink-0">
                    {(it.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>

                <div className="flex items-center gap-1.5 mt-1">
                  {it.status === "uploading" || it.status === "classifying" ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--gray-muted)]">
                      <span className="w-2.5 h-2.5 rounded-full border border-white/20 border-t-indigo-400 animate-spin" />
                      {it.status === "uploading" ? "Uploading…" : "Richard is reading it…"}
                    </span>
                  ) : it.status === "error" ? (
                    <span className="text-[11px] text-rose-400">Upload failed</span>
                  ) : (
                    <>
                      {/* Detected type — visible + user-correctable. */}
                      <span className="text-[11px] text-[var(--gray-muted)]">
                        {it.corrected ? "Set to" : "Detected"}:
                      </span>
                      <select
                        value={it.category}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => correct(it.id, e.target.value as IntakeCategory)}
                        aria-label={`File type for ${it.name}`}
                        className="text-[11px] bg-[var(--bg-deep)] border border-[var(--border-glass)] rounded px-1.5 py-0.5 text-[var(--white)] outline-none focus:border-indigo-500/50"
                      >
                        {CATEGORY_ORDER.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_META[c].icon} {CATEGORY_META[c].label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(it.id);
                }}
                className="text-[var(--gray-dim)] hover:text-rose-400 shrink-0"
                aria-label={`Remove ${it.name}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
