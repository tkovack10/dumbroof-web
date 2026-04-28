"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { checkPhone, explainCheckFailure, formatPhone } from "@/lib/phone-validation";

/**
 * One-time-per-session prompt to add or fix the user's phone number.
 *
 * Why this exists: email open rate is low. Tom wants a callable phone for
 * every active user. Some users (e.g. Jacob Henderson, Supreme Building
 * Group) typed `283-212-3456` to bypass the form — this nag catches that
 * pattern and asks them to provide a real number.
 *
 * Behavior:
 *   - Mounts on /dashboard. On first render of each session, checks the
 *     user's company_profiles.phone via Supabase.
 *   - Skips if the phone passes NANP validation.
 *   - Skips if the user clicked "Remind me later" in the last 7 days
 *     (localStorage flag).
 *   - Otherwise renders a centered modal with a single phone input + Save
 *     button + "Remind me later" link.
 *
 * Save writes directly to company_profiles.phone via the authenticated
 * Supabase client (RLS allows users to update their own row).
 */

const REMIND_LATER_KEY = "phone_nag_remind_later_until";
const REMIND_LATER_DAYS = 7;

export function PhoneNagModal({ userId }: { userId: string }) {
  const [show, setShow] = useState(false);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Respect the user's "remind me later" deferral.
      try {
        const until = localStorage.getItem(REMIND_LATER_KEY);
        if (until && Date.now() < parseInt(until, 10)) return;
      } catch { /* localStorage unavailable — proceed */ }

      const { data } = await supabase
        .from("company_profiles")
        .select("phone")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;

      const check = checkPhone(data?.phone ?? "");
      if (!check.valid) {
        // Pre-fill input with the existing (invalid) value so the user sees
        // what's there, can fix typos rather than retyping from scratch.
        setPhone(data?.phone ?? "");
        setShow(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, supabase]);

  if (!show) return null;

  const handleSave = async () => {
    setError(null);
    const check = checkPhone(phone);
    if (!check.valid) {
      setError(explainCheckFailure(check));
      return;
    }
    setSaving(true);
    const formatted = formatPhone(phone);
    const { error: updateError } = await supabase
      .from("company_profiles")
      .update({ phone: formatted })
      .eq("user_id", userId);
    setSaving(false);
    if (updateError) {
      setError(`Could not save: ${updateError.message}`);
      return;
    }
    setShow(false);
    try { localStorage.removeItem(REMIND_LATER_KEY); } catch { /* noop */ }
  };

  const handleRemindLater = () => {
    try {
      const until = Date.now() + REMIND_LATER_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(REMIND_LATER_KEY, String(until));
    } catch { /* noop */ }
    setShow(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-nag-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-glass)] bg-[rgb(15,18,35)] p-6 shadow-2xl">
        <h2 id="phone-nag-title" className="text-white text-lg font-semibold mb-1">
          📞 Add your phone number
        </h2>
        <p className="text-white/60 text-sm mb-4">
          We use this to reach you directly when something needs attention on a
          claim — much faster than email. Your number is only visible to your
          team and DumbRoof support.
        </p>

        <label className="block text-white/70 text-xs font-medium mb-1">
          Phone number
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          placeholder="(555) 234-5678"
          autoFocus
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-indigo-500/50 mb-3"
        />

        {error && (
          <div className="text-amber-300 text-xs mb-3 bg-amber-500/10 border border-amber-500/20 rounded p-2">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mt-2">
          <button
            type="button"
            onClick={handleRemindLater}
            className="text-white/40 hover:text-white/70 text-xs transition-colors"
          >
            Remind me later
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? "Saving…" : "Save phone"}
          </button>
        </div>
      </div>
    </div>
  );
}
