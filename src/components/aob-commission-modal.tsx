"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { directUpload } from "@/lib/upload-utils";
import { ClaimPicker } from "@/components/claim-picker";
import { aobChecklist, isAobEligible } from "@/lib/aob-eligibility";
import { AOB_COMMISSION_CENTS } from "@/lib/commissions";
import type { Claim } from "@/types/claim";

/**
 * Dashboard flow for the $100 signed-AOB commission.
 *
 * The $100 is gated (Tom 2026-05-29): the rep must have created a real claim
 * with homeowner name/phone/email, claim #, a deliverable carrier email
 * (adjuster OR carrier claims email), inspection photos, AND the signed AOB
 * uploaded. This modal lets them pick the claim, snap the signed AOB inline,
 * see exactly what's still missing, and file the $100 only once the claim is
 * complete. The gate is also enforced server-side.
 */
export function AobCommissionModal({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const aobInput = useRef<HTMLInputElement>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [notes, setNotes] = useState("");
  const [uploadingAob, setUploadingAob] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const checklist = useMemo(
    () => (claim ? aobChecklist(claim) : []),
    [claim]
  );
  const eligible = claim ? isAobEligible(claim) : false;
  const aobOnFile = useMemo(
    () => !!claim && Array.isArray(claim.aob_files) && claim.aob_files.length > 0,
    [claim]
  );

  const reset = useCallback(() => {
    setClaim(null);
    setNotes("");
    setError(null);
    setMissing([]);
    setUploadingAob(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting || uploadingAob) return;
    reset();
    onClose();
  }, [submitting, uploadingAob, reset, onClose]);

  // Snap/attach the signed AOB directly to the claim's aob_files. Mirrors the
  // signature-manager upload path: sign-upload → directUpload → update-files.
  const uploadAob = useCallback(
    async (file: File) => {
      if (!claim) return;
      setUploadingAob(true);
      setError(null);
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const signRes = await fetch("/api/storage/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folder: "aob",
            fileName: `signed_aob_${Date.now()}.${ext}`,
            claimPath: claim.file_path,
          }),
        });
        const signData = await signRes.json();
        if (!signRes.ok) throw new Error(signData.error || "Could not get upload URL");
        await directUpload(signData.signedUrl, file);

        const filename = (signData.path as string).split("/").pop() || "";
        const updRes = await fetch("/api/team-claims/update-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claim_id: claim.id,
            column: "aob_files",
            filename,
          }),
        });
        if (!updRes.ok) {
          const b = await updRes.json().catch(() => ({}));
          throw new Error(b.error || "Could not attach the AOB to the claim");
        }
        // Reflect the new file locally so the checklist turns green immediately.
        setClaim((prev) =>
          prev
            ? { ...prev, aob_files: [...(prev.aob_files || []), filename] }
            : prev
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "AOB upload failed");
      } finally {
        setUploadingAob(false);
      }
    },
    [claim]
  );

  const submit = useCallback(async () => {
    if (!claim) {
      setError("Pick the claim this AOB is for first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMissing([]);
    try {
      const res = await fetch(`/api/claim/${claim.id}/commission-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "aob_100",
          amount_cents: AOB_COMMISSION_CENTS,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (Array.isArray(body.missing)) setMissing(body.missing);
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
  }, [claim, notes, reset, onSubmitted, onClose]);

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
            <h2 className="text-lg font-bold text-white">Get paid for a signed AOB</h2>
            <p className="text-xs text-[var(--gray-muted)] mt-0.5">
              $100 once the claim is complete &amp; the AOB is uploaded.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting || uploadingAob}
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
              {missing.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-xs text-red-200/90">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ClaimPicker
            selected={claim}
            onSelect={(c) => {
              setClaim(c);
              setError(null);
              setMissing([]);
            }}
            label="Which claim did you sign?"
          />

          {!claim && (
            <p className="text-xs text-[var(--gray-muted)]">
              No claim yet?{" "}
              <Link href="/dashboard/new-claim" className="text-[var(--cyan)] hover:underline">
                Start a new claim →
              </Link>{" "}
              (you&apos;ll need homeowner contact info, claim &amp; adjuster #,
              and inspection photos).
            </p>
          )}

          {claim && (
            <>
              {/* Completeness checklist */}
              <div className="rounded-xl border border-[var(--border-glass)] bg-white/[0.02] divide-y divide-[var(--border-glass)]">
                {checklist.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white">{item.label}</p>
                      {!item.ok && (
                        <p className="text-xs text-[var(--gray-muted)]">{item.hint}</p>
                      )}
                    </div>
                    {item.ok ? (
                      <span className="text-[var(--green)] text-sm font-bold flex-shrink-0">
                        ✓
                      </span>
                    ) : (
                      <span className="text-[var(--amber)] text-xs font-semibold flex-shrink-0">
                        needed
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Inline AOB upload when not yet on file */}
              {!aobOnFile && (
                <div>
                  <button
                    type="button"
                    onClick={() => aobInput.current?.click()}
                    disabled={uploadingAob}
                    className="w-full px-4 py-3 rounded-xl border border-dashed border-[var(--cyan)]/60 hover:border-[var(--cyan)] text-sm text-white hover:bg-white/[0.03] transition-colors disabled:opacity-50"
                  >
                    {uploadingAob ? "Uploading AOB…" : "📷 Snap / upload the signed AOB"}
                  </button>
                  <input
                    ref={aobInput}
                    type="file"
                    accept="image/*,application/pdf"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadAob(f);
                    }}
                  />
                </div>
              )}

              {/* Link to finish the rest on the claim page */}
              {!eligible && aobOnFile && (
                <Link
                  href={`/dashboard/claim/${claim.id}`}
                  className="block text-center text-sm text-[var(--cyan)] hover:underline"
                >
                  Finish the missing details on the claim page →
                </Link>
              )}

              {/* Amount summary */}
              <div className="p-4 rounded-xl border border-[var(--green)]/40 bg-[var(--green)]/10 flex items-center justify-between">
                <span className="text-xs text-[var(--gray)] uppercase tracking-wide font-bold">
                  AOB commission
                </span>
                <span className="font-mono text-2xl font-bold text-[var(--green)]">
                  $100.00
                </span>
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
            </>
          )}
        </div>

        <div className="p-6 border-t border-[var(--border-glass)] flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting || uploadingAob}
            className="px-4 py-2 rounded-xl text-sm text-[var(--gray)] hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || uploadingAob || !eligible}
            className="bg-gradient-to-r from-[var(--green)] to-[var(--cyan)] hover:shadow-[var(--shadow-glow-cyan)] disabled:opacity-40 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all"
          >
            {submitting ? "Submitting…" : "Submit for $100"}
          </button>
        </div>
      </div>
    </div>
  );
}
