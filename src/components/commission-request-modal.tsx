"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { directUpload } from "@/lib/upload-utils";

type Type = "check_10pct" | "aob_100" | "other";

interface Props {
  claimId: string;
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function CommissionRequestModal({
  claimId,
  open,
  onClose,
  onSubmitted,
}: Props) {
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<Type>("check_10pct");
  const [checkAmount, setCheckAmount] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedCents = useMemo(() => {
    if (type === "aob_100") return 10_000;
    if (type === "check_10pct") {
      const n = parseFloat(checkAmount.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.round(n * 100 * 0.1);
    }
    const n = parseFloat(customAmount.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [type, checkAmount, customAmount]);

  const reset = useCallback(() => {
    setType("check_10pct");
    setCheckAmount("");
    setCustomAmount("");
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
    if (computedCents <= 0) {
      setError("Enter an amount first.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      let photoPath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `claims/${claimId}/commissions/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { data: signed, error: signErr } = await supabase.storage
          .from("claim-documents")
          .createSignedUploadUrl(path);
        if (signErr || !signed?.signedUrl) {
          throw signErr || new Error("Could not get upload URL");
        }
        await directUpload(signed.signedUrl, file);
        photoPath = path;
      }

      const res = await fetch(`/api/claim/${claimId}/commission-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          amount_cents: computedCents,
          photo_path: photoPath,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      reset();
      onSubmitted?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }, [type, computedCents, file, notes, claimId, supabase, reset, onSubmitted, onClose]);

  if (!open) return null;

  const photoLabel =
    type === "aob_100" ? "Photo of signed AOB" : "Photo of check (optional)";

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
            <h2 className="text-lg font-bold text-white">Submit commission</h2>
            <p className="text-xs text-[var(--gray-muted)] mt-0.5">
              Goes to your company admin for approval &amp; pay.
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

          {/* Type */}
          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Type
            </label>
            <div className="space-y-2">
              <TypeOption
                active={type === "check_10pct"}
                onClick={() => setType("check_10pct")}
                title="10% of collected check"
                sub="Default rule. Enter the check amount; we compute 10%."
              />
              <TypeOption
                active={type === "aob_100"}
                onClick={() => setType("aob_100")}
                title="$100 — Signed AOB"
                sub="Flat per signed AOB. Attach a photo of the signature page."
              />
              <TypeOption
                active={type === "other"}
                onClick={() => setType("other")}
                title="Other"
                sub="Custom amount — enter $ manually."
              />
            </div>
          </div>

          {/* Amount */}
          {type === "check_10pct" && (
            <div>
              <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                Check amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gray-muted)]">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={checkAmount}
                  onChange={(e) => setCheckAmount(e.target.value)}
                  placeholder="4,210.00"
                  className="w-full pl-7 pr-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
                />
              </div>
            </div>
          )}

          {type === "other" && (
            <div>
              <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                Commission amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gray-muted)]">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="250.00"
                  className="w-full pl-7 pr-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
                />
              </div>
            </div>
          )}

          <div className="p-4 rounded-xl border border-[var(--green)]/40 bg-[var(--green)]/10 flex items-center justify-between">
            <span className="text-xs text-[var(--gray)] uppercase tracking-wide font-bold">
              Commission requested
            </span>
            <span className="font-mono text-2xl font-bold text-[var(--green)]">
              ${(computedCents / 100).toFixed(2)}
            </span>
          </div>

          {/* Photo */}
          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              {photoLabel}
            </label>
            {previewUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-[var(--border-glass)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="preview" className="w-full max-h-56 object-contain bg-black" />
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
                Tap to attach photo
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
            disabled={submitting || computedCents <= 0}
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-40 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all"
          >
            {submitting ? "Submitting…" : "Submit for approval"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TypeOption({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border transition-colors ${
        active
          ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08]"
          : "border-[var(--border-glass)] bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 ${
            active ? "border-[var(--cyan)] bg-[var(--cyan)]" : "border-[var(--gray-dim)]"
          }`}
        />
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-xs text-[var(--gray-muted)] mt-0.5">{sub}</div>
        </div>
      </div>
    </button>
  );
}
