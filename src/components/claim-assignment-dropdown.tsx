"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PUBLIC_DOMAINS } from "@/lib/team-lookup";

interface TeamMember {
  id: string;
  email: string;
}

function repName(email: string | null | undefined): string {
  if (!email) return "Unassigned";
  return email
    .split("@")[0]
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/**
 * Phase 5 Slice B — inline rep-assignment pill for the claim detail page.
 *
 * Renders a floating bottom-right pill: "Assigned to: Sarah ▼". Opens to
 * a searchable list of company team members. Selecting a rep PATCHes
 * claims.assigned_user_id via /api/claim/[id]/assign-rep.
 *
 * Same team-membership gate pattern as the other Phase 1-3 floating
 * actions, with the addition that the current assignee can also reassign
 * (so a rep handing off their claim doesn't need admin).
 */
export function ClaimAssignmentDropdown({ claimId }: { claimId: string }) {
  const [canEdit, setCanEdit] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [currentRepId, setCurrentRepId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auth + claim + team fetch on mount
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: profile }, { data: claim }] = await Promise.all([
        supabase
          .from("company_profiles")
          .select("company_id, is_admin, email")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("claims")
          .select("assigned_user_id, user_id, company_id")
          .eq("id", claimId)
          .maybeSingle(),
      ]);
      if (cancelled || !claim) return;

      // Same authorization shape as the assign-rep API: admin, owner, or
      // current assignee, falling back to same-domain for legacy claims.
      const isAdmin = !!profile?.is_admin;
      const isCurrentAssignee = claim.assigned_user_id === user.id;
      const isOwner = claim.user_id === user.id;
      const sameCompany = !!(
        profile?.company_id &&
        claim.company_id &&
        profile.company_id === claim.company_id
      );
      const callerDomain = (user.email || profile?.email || "")
        .split("@")[1]
        ?.toLowerCase();
      let sameDomain = false;
      if (callerDomain && !sameCompany && !PUBLIC_DOMAINS.has(callerDomain)) {
        const { data: ownerProf } = await supabase
          .from("company_profiles")
          .select("email")
          .eq("user_id", claim.user_id)
          .maybeSingle();
        const ownerDomain = (ownerProf?.email || "")
          .split("@")[1]
          ?.toLowerCase();
        sameDomain = !!(ownerDomain && callerDomain === ownerDomain);
      }
      const allowed =
        isAdmin ||
        isCurrentAssignee ||
        isOwner ||
        sameCompany ||
        sameDomain;
      if (cancelled) return;
      setCanEdit(allowed);
      setCurrentRepId(claim.assigned_user_id ?? null);

      if (!allowed) return;

      // Fetch team
      try {
        const res = await fetch("/api/admin/team");
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            setTeam(
              ((json.members as TeamMember[]) || []).filter((m) => m.email)
            );
          }
        }
      } catch {
        // non-fatal
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const assign = useCallback(
    async (newRepId: string | null) => {
      if (saving) return;
      setSaving(newRepId ?? "__unassign__");
      setError(null);
      const previous = currentRepId;
      // Optimistic update
      setCurrentRepId(newRepId);
      try {
        const res = await fetch(`/api/claim/${claimId}/assign-rep`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rep_user_id: newRepId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setOpen(false);
      } catch (e) {
        // Roll back optimistic update
        setCurrentRepId(previous);
        setError(e instanceof Error ? e.message : "Assignment failed");
      } finally {
        setSaving(null);
      }
    },
    [claimId, currentRepId, saving]
  );

  if (!canEdit) return null;

  const currentRep = team.find((m) => m.id === currentRepId);
  const filteredTeam = search.trim()
    ? team.filter(
        (m) =>
          m.email.toLowerCase().includes(search.toLowerCase()) ||
          repName(m.email).toLowerCase().includes(search.toLowerCase())
      )
    : team;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-80 right-4 sm:bottom-60 sm:right-6 z-30"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.12] border border-[var(--purple)]/40 text-white px-4 py-2.5 rounded-full text-xs font-bold shadow-lg backdrop-blur-md transition-all"
        aria-label="Assign rep"
      >
        <svg
          className="w-4 h-4 text-[var(--purple)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
          />
        </svg>
        <span className="whitespace-nowrap">
          {currentRep ? repName(currentRep.email) : "Unassigned"}
        </span>
        <svg
          className={`w-3 h-3 text-[var(--gray-muted)] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-[var(--border-glass)] bg-[rgb(15,18,35)] backdrop-blur-[20px] shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-[var(--border-glass)]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reps…"
              autoFocus
              className="w-full px-3 py-1.5 rounded-lg bg-white/[0.04] text-white text-xs focus:outline-none focus:bg-white/[0.08]"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => assign(null)}
              disabled={!!saving}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/[0.04] ${
                currentRepId === null ? "text-[var(--purple)]" : "text-[var(--gray)]"
              }`}
            >
              {saving === "__unassign__" ? "Unassigning…" : "— Unassign —"}
            </button>
            {filteredTeam.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[var(--gray-dim)]">
                No matches.
              </p>
            ) : (
              filteredTeam.map((m) => {
                const isCurrent = m.id === currentRepId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => assign(m.id)}
                    disabled={!!saving}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/[0.04] flex items-center justify-between ${
                      isCurrent
                        ? "bg-[var(--purple)]/[0.08] text-white"
                        : "text-[var(--gray)]"
                    }`}
                  >
                    <span>
                      <span className="font-medium">{repName(m.email)}</span>
                      <span className="text-[10px] text-[var(--gray-dim)] block">
                        {m.email}
                      </span>
                    </span>
                    {isCurrent && saving !== m.id && (
                      <svg
                        className="w-3 h-3 text-[var(--purple)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                    )}
                    {saving === m.id && (
                      <span className="text-[10px] text-[var(--gray-dim)]">…</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {error && (
            <div className="px-3 py-2 border-t border-[var(--border-glass)] text-[10px] text-red-300 bg-red-500/10">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
