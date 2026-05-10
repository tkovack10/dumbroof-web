"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  userId: string;
  userEmail: string;
  next: string;
}

// Required first-time profile completion. Submits to /api/onboarding/profile
// which writes to company_profiles + (if a logo file is provided) uploads to
// claim-documents/{user_id}/branding/logo.{ext} and stamps logo_path.
//
// Logo is optional v1 — we don't want to block users who don't have a digital
// logo handy. Without one, PDFs render header text only.
export function OnboardingProfileClient({ userId, userEmail, next }: Props) {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("Owner");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allRequiredFilled =
    companyName.trim().length > 1 &&
    contactName.trim().length > 1 &&
    phone.trim().length >= 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allRequiredFilled || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      let logoPath: string | null = null;

      // Upload logo first if provided. Stored under the user's branding
      // folder so the existing logo lookup in processor.py:5582 picks it up
      // for PDF generation.
      if (logoFile) {
        const supabase = createClient();
        const ext = logoFile.name.split(".").pop()?.toLowerCase() || "png";
        const path = `${userId}/branding/logo.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("claim-documents")
          .upload(path, logoFile, {
            cacheControl: "3600",
            upsert: true,
            contentType: logoFile.type || "application/octet-stream",
          });
        if (uploadErr) throw new Error(`Logo upload failed: ${uploadErr.message}`);
        logoPath = path;
      }

      // Server route writes company_profiles. Auth-gated; uses the user's
      // session to identify them.
      const res = await fetch("/api/onboarding/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          contact_name: contactName.trim(),
          contact_title: contactTitle.trim() || "Owner",
          phone: phone.trim(),
          website: website.trim() || null,
          logo_path: logoPath,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Profile save failed (${res.status})`);
      }

      // Hard navigation to drop the new cookie state cleanly + trigger
      // middleware re-evaluation (so the gate doesn't re-fire on /dashboard).
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg-deep)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <span className="text-3xl font-extrabold tracking-tight gradient-text">
            dumbroof<span className="font-normal opacity-70">.ai</span>
          </span>
        </div>

        <div className="glass-card p-7">
          <h1 className="text-2xl font-bold text-[var(--white)] mb-1">
            One quick step
          </h1>
          <p className="text-[var(--gray-muted)] text-sm mb-5">
            We need your company info so your supplements come out branded as
            you, not as &quot;Your Roofing Company.&quot; Takes 30 seconds.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Company name <span className="text-[var(--red)]">*</span>
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Apex Roofing & Restoration"
                className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">
                Your name <span className="text-[var(--red)]">*</span>
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">
                Your title
              </label>
              <input
                type="text"
                value={contactTitle}
                onChange={(e) => setContactTitle(e.target.value)}
                placeholder="Owner, GM, Sales Manager…"
                className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">
                Phone <span className="text-[var(--red)]">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 555-1234"
                className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">
                Website
              </label>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yourroofingcompany.com"
                className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">
                Logo (optional)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-[var(--gray-muted)] file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-[var(--white)] hover:file:bg-white/15"
              />
              <p className="mt-1 text-xs text-[var(--gray-dim)]">
                PNG, JPG, or PDF. We&apos;ll convert as needed. Skip for now if
                you don&apos;t have one handy — you can upload from settings later.
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!allRequiredFilled || submitting}
              className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] disabled:opacity-30 text-white py-3 rounded-lg font-semibold text-sm transition-opacity"
            >
              {submitting ? "Saving…" : "Continue →"}
            </button>

            <p className="text-xs text-[var(--gray-dim)] text-center">
              Signed in as <span className="text-[var(--white)]">{userEmail}</span>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
