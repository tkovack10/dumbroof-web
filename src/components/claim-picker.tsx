"use client";

import { useEffect, useMemo, useState } from "react";
import type { Claim } from "@/types/claim";

/**
 * Searchable selector over the caller's team claims (/api/team-claims).
 * Returns the FULL claim row via onSelect so consumers (e.g. the AOB modal)
 * can read completeness fields without a second fetch.
 *
 * Used by the dashboard-level check + AOB commission flows, where there's no
 * claim in context yet (unlike the per-claim page where claimId is known).
 */
export function ClaimPicker({
  selected,
  onSelect,
  label = "Which claim?",
}: {
  selected: Claim | null;
  onSelect: (claim: Claim | null) => void;
  label?: string;
}) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/team-claims")
      .then((r) => (r.ok ? r.json() : { claims: [] }))
      .then((json) => {
        if (!cancelled) setClaims((json.claims || []) as Claim[]);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? claims.filter(
          (c) =>
            (c.address || "").toLowerCase().includes(q) ||
            (c.homeowner_name || "").toLowerCase().includes(q) ||
            (c.claim_number || "").toLowerCase().includes(q)
        )
      : claims;
    return base.slice(0, 30);
  }, [claims, query]);

  if (selected) {
    return (
      <div>
        <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
          {label}
        </label>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--cyan)] bg-[var(--cyan)]/[0.08] px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {selected.address || "Untitled claim"}
            </p>
            <p className="text-xs text-[var(--gray-muted)] truncate">
              {[selected.homeowner_name, selected.claim_number]
                .filter(Boolean)
                .join(" · ") || "No details yet"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setOpen(true);
            }}
            className="text-xs text-[var(--cyan)] hover:underline flex-shrink-0"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
        {label} <span className="text-red-400">*</span>
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Search your claims by address, homeowner, or claim #"
        className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
      />
      {open && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-[var(--border-glass)] bg-[rgb(12,15,30)] divide-y divide-[var(--border-glass)]">
          {loading ? (
            <p className="px-4 py-3 text-xs text-[var(--gray-muted)]">
              Loading your claims…
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[var(--gray-muted)]">
              {claims.length === 0
                ? "No claims yet — create one first."
                : "No claims match that search."}
            </p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] transition-colors"
              >
                <p className="text-sm text-white truncate">
                  {c.address || "Untitled claim"}
                </p>
                <p className="text-xs text-[var(--gray-muted)] truncate">
                  {[c.homeowner_name, c.claim_number]
                    .filter(Boolean)
                    .join(" · ") || "No details yet"}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
