"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Bet 2 — Richard as Inline Co-Pilot.
 *
 * Reusable proactive-suggestion banner. Mounts on every admin surface,
 * fetches `/api/admin/richard-suggestion?surface=X[&claim_id=Y]`, and
 * shows the highest-impact action Richard wants to push. Dismissible
 * per session so a single "no" doesn't pop right back.
 *
 * Surfaces today: command_center · claim_detail · production · job_pnl
 * Chat sidebar (RichardLauncher) stays for explicit asks; this is the
 * unsolicited surface that makes the agent feel alive.
 */

export type RichardSurface =
  | "command_center"
  | "claim_detail"
  | "production"
  | "job_pnl";

interface Suggestion {
  id: string;
  kind: string;
  headline: string;
  sub?: string;
  cta: { label: string; href: string } | null;
  money_at_stake?: number;
}

interface ApiResponse {
  suggestion: Suggestion | null;
  error?: string;
}

interface RichardSuggestionBannerProps {
  surface: RichardSurface;
  claimId?: string;
  className?: string;
}

const DISMISS_KEY = "richard-suggestions-dismissed";

function isDismissed(id: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw) as string[];
    return arr.includes(id);
  } catch {
    return false;
  }
}

function markDismissed(id: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    if (!arr.includes(id)) arr.push(id);
    window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify(arr));
  } catch {
    /* sessionStorage unavailable — silent */
  }
}

export function RichardSuggestionBanner({
  surface,
  claimId,
  className = "",
}: RichardSuggestionBannerProps) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHidden(false);
    const qs = new URLSearchParams({ surface });
    if (claimId) qs.set("claim_id", claimId);
    fetch(`/api/admin/richard-suggestion?${qs.toString()}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as ApiResponse;
      })
      .then((data) => {
        if (cancelled) return;
        const s = data?.suggestion ?? null;
        if (s && isDismissed(s.id)) {
          setSuggestion(null);
        } else {
          setSuggestion(s);
        }
      })
      .catch(() => {
        if (!cancelled) setSuggestion(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [surface, claimId]);

  if (loading || !suggestion || hidden) return null;

  return (
    <div
      className={`mb-4 rounded-2xl border border-[var(--purple)]/40 bg-gradient-to-r from-[rgba(168,85,247,0.10)] to-[rgba(59,130,246,0.06)] p-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        <RichardGlyph />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="text-[10px] font-semibold tracking-wider uppercase text-[var(--purple)]">
              Richard suggests
            </div>
            {typeof suggestion.money_at_stake === "number" &&
              suggestion.money_at_stake > 0 && (
                <div className="text-[10px] font-semibold tracking-wider uppercase text-[var(--green)]">
                  · ${Math.round(suggestion.money_at_stake).toLocaleString("en-US")} in play
                </div>
              )}
          </div>
          <div className="mt-1 text-sm font-semibold text-white leading-snug">
            {suggestion.headline}
          </div>
          {suggestion.sub && (
            <div className="mt-1 text-xs text-[var(--gray-muted)] leading-relaxed">
              {suggestion.sub}
            </div>
          )}
          {suggestion.cta && (
            <div className="mt-3">
              <Link
                href={suggestion.cta.href}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--purple)]/50 bg-[var(--purple)]/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--purple)]/25 transition-colors"
              >
                {suggestion.cta.label}
              </Link>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss suggestion"
          onClick={() => {
            markDismissed(suggestion.id);
            setHidden(true);
          }}
          className="flex-shrink-0 h-6 w-6 grid place-items-center rounded-md text-[var(--gray-muted)] hover:text-white hover:bg-white/5 transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 3L11 11M11 3L3 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function RichardGlyph() {
  return (
    <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-[var(--purple)] to-[var(--blue)] grid place-items-center text-white text-xs font-bold shadow-[0_0_18px_rgba(168,85,247,0.35)]">
      R
    </div>
  );
}
