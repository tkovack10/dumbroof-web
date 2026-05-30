"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface BrandReportsPromptProps {
  /** The claim whose reports we'll re-bake with the new logo. */
  claimId: string;
  /** The signed-in user (owner of the company_profiles row + the storage path). */
  userId: string;
  /** True once the company has a logo on file — when true this prompt renders nothing. */
  hasLogo: boolean;
  /**
   * Fired after the logo is saved. The parent updates its local logo state (so this
   * prompt hides) AND kicks the reprocess that re-bakes the PDFs branded. Reuses the
   * claim page's existing handleReprocess so there's one reprocess path.
   */
  onBranded: () => void;
}

// Only raster formats embed cleanly in the Chrome-headless PDF render. Vector/PDF/SVG
// download fine but render as broken alt-text in reports (E203). Keep in sync with
// company-profile-gate.tsx's logo guard.
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * The "1-click to brand" nudge that the logo-gate removal (#62/#71 activation fix) was
 * supposed to be paired with. We dropped the logo requirement so users could activate
 * without it — but a logo-less user's first reports go out UNbranded with no path back.
 * This renders WITH the finished reports (claim page `generatedDocs` slot) and, only when
 * the company has no logo, offers a one-click "add logo → re-brand this claim" action.
 */
export function BrandReportsPrompt({ claimId, userId, hasLogo, onBranded }: BrandReportsPromptProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Logo-gated: only nudge companies whose reports went out unbranded — a returning
  // user who already added a logo never sees this. (The onboarding success-screen copy
  // is left as-is: brand-new activators have no logo yet, so it's correct there.)
  if (hasLogo || !userId) return null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Allow re-picking the same file later by clearing the input value.
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setError("");
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setError("Use a PNG, JPG, WEBP, or GIF — vector/PDF logos render broken in reports.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Logo must be under 5 MB.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const logoPath = `${userId}/branding/logo.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("claim-documents")
        .upload(logoPath, file, { upsert: true });
      if (upErr) throw new Error(`Logo upload failed: ${upErr.message}`);

      // Persist logo_path on the company profile. Activated users already have a row
      // (created at onboarding); update it. Insert is a defensive fallback only.
      const { data: existing } = await supabase
        .from("company_profiles")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (existing) {
        const { error: updErr } = await supabase
          .from("company_profiles")
          .update({ logo_path: logoPath, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: insErr } = await supabase
          .from("company_profiles")
          .insert({ user_id: userId, logo_path: logoPath, user_role: "contractor", is_admin: true, updated_at: new Date().toISOString() });
        if (insErr) throw new Error(insErr.message);
      }

      // Logo saved → hand off. Parent flips local hasLogo (this unmounts) + reprocesses
      // so the PDFs come back branded. Leave `busy` set: the slot unmounts on success.
      onBranded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't brand your reports — try again.");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-[var(--cyan)]/5 border border-[var(--cyan)]/20 p-4 mb-4 flex items-start gap-3">
      <svg className="w-5 h-5 text-[var(--cyan)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
      </svg>
      <div className="flex-1">
        <p className="text-sm font-semibold text-[var(--white)]">These reports aren&apos;t branded yet</p>
        <p className="text-xs text-[var(--gray-muted)] mt-0.5">
          Add your company logo and we&apos;ll re-brand this claim&apos;s documents with <strong>your</strong> name — not ours.
        </p>
        {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-2.5 inline-flex items-center gap-1.5 bg-[var(--cyan)]/15 hover:bg-[var(--cyan)]/25 border border-[var(--cyan)]/30 text-[var(--cyan)] text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          aria-label="Add your logo and re-brand this claim's reports"
        >
          {busy ? "Re-branding your reports…" : "Add logo & re-brand →"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFile}
          className="hidden"
        />
      </div>
    </div>
  );
}
