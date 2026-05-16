"use client";

import { useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { directUpload } from "@/lib/upload-utils";

type Source = "insurance" | "homeowner" | "stripe_invoice" | "other";

interface Props {
  claimId: string;
  open: boolean;
  onClose: () => void;
  onUploaded?: () => void;
}

export function CheckUploadModal({ claimId, open, onClose, onUploaded }: Props) {
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<Source>("insurance");
  const [payor, setPayor] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setAmount("");
    setSource("insurance");
    setPayor("");
    setNotes("");
    setError(null);
    setPreviewUrl(null);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }, [previewUrl]);

  const submit = useCallback(async () => {
    if (!file) {
      setError("Please pick or take a photo of the check first.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      // 1. direct-upload the photo to claim-documents bucket
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `claims/${claimId}/checks/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { data: signed, error: signErr } = await supabase.storage
        .from("claim-documents")
        .createSignedUploadUrl(path);
      if (signErr || !signed?.signedUrl) {
        throw signErr || new Error("Could not get upload URL");
      }
      await directUpload(signed.signedUrl, file);

      // 2. parse amount → cents
      const numeric = parseFloat(amount.replace(/[^0-9.]/g, ""));
      const amountCents = Number.isFinite(numeric)
        ? Math.round(numeric * 100)
        : null;

      // 3. record metadata
      const res = await fetch(`/api/claim/${claimId}/upload-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_path: path,
          amount_cents: amountCents,
          source,
          payor: payor.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      reset();
      onUploaded?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }, [file, amount, source, payor, notes, claimId, supabase, reset, onUploaded, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={handleClose}
    >
      <div
        className="w-full sm:max-w-lg bg-[rgb(15,18,35)] sm:rounded-2xl rounded-t-2xl border border-[var(--border-glass)] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[var(--border-glass)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Upload check</h2>
            <p className="text-xs text-[var(--gray-muted)] mt-0.5">
              Snap a photo. Richard will read the amount &amp; payor.
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

          {/* Photo */}
          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Photo of check <span className="text-red-400">*</span>
            </label>
            {previewUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-[var(--border-glass)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="check preview" className="w-full max-h-64 object-contain bg-black" />
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                  }}
                  className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg hover:bg-black/80"
                >
                  Retake
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="w-full p-6 rounded-xl border border-dashed border-[var(--border-glass)] hover:border-[var(--cyan)] hover:bg-white/[0.02] transition-colors text-center"
              >
                <svg
                  className="w-10 h-10 text-[var(--gray-muted)] mx-auto mb-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                  />
                </svg>
                <p className="text-sm text-white font-medium">Tap to take photo</p>
                <p className="text-xs text-[var(--gray-dim)] mt-1">JPEG/PNG/HEIC up to 25 MB</p>
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gray-muted)]">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="4,210.00"
                className="w-full pl-7 pr-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
              />
            </div>
            <p className="text-xs text-[var(--gray-dim)] mt-1">
              Leave blank to let Richard read it from the photo.
            </p>
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Source
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["insurance", "Insurance carrier"],
                  ["homeowner", "Homeowner"],
                  ["stripe_invoice", "Stripe invoice"],
                  ["other", "Other"],
                ] as [Source, string][]
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSource(val)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    source === val
                      ? "border border-[var(--cyan)] bg-[var(--cyan)]/[0.08] text-white"
                      : "border border-[var(--border-glass)] bg-white/[0.02] text-[var(--gray)] hover:bg-white/[0.04]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Payor */}
          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Payor (optional)
            </label>
            <input
              type="text"
              value={payor}
              onChange={(e) => setPayor(e.target.value)}
              placeholder="State Farm"
              className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Notes (optional)
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
            disabled={submitting || !file}
            className="bg-gradient-to-r from-[var(--green)] to-[var(--cyan)] hover:shadow-[var(--shadow-glow-cyan)] disabled:opacity-40 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all"
          >
            {submitting ? "Uploading…" : "Record check"}
          </button>
        </div>
      </div>
    </div>
  );
}
