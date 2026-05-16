"use client";

import { useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { directUpload } from "@/lib/upload-utils";

/**
 * Local YYYY-MM-DD — DO NOT use `toISOString().slice(0,10)` here.
 * Same pattern as production-calendar.tsx (Phase 2 timezone fix): a Pacific
 * user at 9pm sees the wrong date if we use UTC for the default.
 */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type ExpenseType =
  | "material"
  | "labor"
  | "dumpster"
  | "permit"
  | "rental"
  | "subcontractor"
  | "misc";

const TYPE_OPTIONS: { value: ExpenseType; label: string; emoji: string }[] = [
  { value: "material", label: "Material", emoji: "🧱" },
  { value: "labor", label: "Labor", emoji: "🔨" },
  { value: "dumpster", label: "Dumpster", emoji: "🚛" },
  { value: "subcontractor", label: "Subcontractor", emoji: "👷" },
  { value: "permit", label: "Permit", emoji: "📄" },
  { value: "rental", label: "Rental", emoji: "🪜" },
  { value: "misc", label: "Misc", emoji: "📦" },
];

interface Props {
  claimId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function ExpenseUploadModal({ claimId, open, onClose, onSaved }: Props) {
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<ExpenseType>("material");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState<string>(
    () => localDateKey(new Date())
  );
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setType("material");
    setAmount("");
    setVendor("");
    setDescription("");
    setOccurredAt(localDateKey(new Date()));
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setNotes("");
    setError(null);
  }, [previewUrl]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

  const handleFile = useCallback(
    (f: File) => {
      setFile(f);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(f));
    },
    [previewUrl]
  );

  const submit = useCallback(async () => {
    const numeric = parseFloat(amount.replace(/[^0-9.]/g, ""));
    const amountCents = Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
    if (amountCents <= 0) {
      setError("Enter a positive amount.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let receiptPath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `claims/${claimId}/expenses/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { data: signed, error: signErr } = await supabase.storage
          .from("claim-documents")
          .createSignedUploadUrl(path);
        if (signErr || !signed?.signedUrl) {
          throw signErr || new Error("Could not get upload URL");
        }
        await directUpload(signed.signedUrl, file);
        receiptPath = path;
      }

      const occurredIso = new Date(occurredAt + "T12:00:00").toISOString();

      const res = await fetch(`/api/claim/${claimId}/expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          amount_cents: amountCents,
          vendor: vendor.trim() || null,
          description: description.trim() || null,
          receipt_path: receiptPath,
          occurred_at: occurredIso,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      reset();
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record expense");
    } finally {
      setSubmitting(false);
    }
  }, [
    amount,
    type,
    vendor,
    description,
    occurredAt,
    notes,
    file,
    claimId,
    supabase,
    reset,
    onSaved,
    onClose,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={handleClose}
    >
      <div
        className="w-full sm:max-w-lg bg-[rgb(15,18,35)] sm:rounded-2xl rounded-t-2xl border border-[var(--border-glass)] max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[var(--border-glass)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Record expense</h2>
            <p className="text-xs text-[var(--gray-muted)] mt-0.5">
              Receipt photo, vendor, amount — Richard will OCR it.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="text-[var(--gray-muted)] hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    type === t.value
                      ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08] text-white"
                      : "border-[var(--border-glass)] bg-white/[0.02] text-[var(--gray)] hover:bg-white/[0.04]"
                  }`}
                >
                  <span>{t.emoji}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                Amount <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gray-muted)]">
                  $
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                Date
              </label>
              <input
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Vendor
            </label>
            <input
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="ABC Roofing Supply"
              className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="35 sq Owens Corning Duration HR — Driftwood"
              className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Receipt photo (optional)
            </label>
            {previewUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-[var(--border-glass)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="receipt preview"
                  className="w-full max-h-64 object-contain bg-black"
                />
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                  }}
                  className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg hover:bg-black/80"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="w-full px-4 py-3 rounded-xl border border-dashed border-[var(--border-glass)] hover:border-[var(--cyan)] text-sm text-[var(--gray)] hover:text-white transition-colors"
              >
                Tap to take photo of the receipt
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
            />
          </div>
        </div>

        <div className="p-6 border-t border-[var(--border-glass)] flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm text-[var(--gray)] hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="bg-gradient-to-r from-[var(--green)] to-[var(--cyan)] hover:shadow-[var(--shadow-glow-cyan)] disabled:opacity-40 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all"
          >
            {submitting ? "Saving…" : "Record expense"}
          </button>
        </div>
      </div>
    </div>
  );
}
