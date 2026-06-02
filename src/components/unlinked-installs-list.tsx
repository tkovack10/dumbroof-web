"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface UnlinkedEvent {
  id: string;
  acculynx_event_id: string;
  title: string | null;
  location: string | null;
  calendar_name: string | null;
  job_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
}

interface ClaimHit {
  id: string;
  address: string | null;
  homeowner_name: string | null;
}

interface Props {
  /** Bumped by the parent to force a refetch after a calendar load. */
  refreshKey?: number;
  /** Reports the count so the parent tab strip can badge it. */
  onCountChange?: (n: number) => void;
  /** Called after a link so the parent can refresh the calendar/schedules. */
  onLinked?: () => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function UnlinkedInstallsList({ refreshKey, onCountChange, onLinked }: Props) {
  const [events, setEvents] = useState<UnlinkedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/production/unlinked-installs");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const next: UnlinkedEvent[] = body.events || [];
      setEvents(next);
      onCountChange?.(next.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/integrations/acculynx/sync-calendar", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSyncMsg(
        `Synced ${body.events_seen ?? 0} install${(body.events_seen ?? 0) === 1 ? "" : "s"} · ` +
          `${body.matched ?? 0} matched · ${body.unmatched ?? 0} unlinked` +
          (body.errors?.length ? ` · ${body.errors.length} warning(s)` : "")
      );
      await load();
      onLinked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [load, onLinked]);

  return (
    <div className="glass-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3 px-1 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">Unlinked AccuLynx installs</h3>
          <p className="text-xs text-[var(--gray-muted)]">
            Calendar installs that didn&apos;t match a claim by address. Link each to put it on the board.
          </p>
        </div>
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--amber)]/15 hover:bg-[var(--amber)]/25 border border-[var(--amber)]/40 text-[var(--amber)] transition-colors disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "⟲ Sync from AccuLynx"}
        </button>
      </div>

      {syncMsg && (
        <div className="text-xs text-[var(--green)] bg-[var(--green)]/10 border border-[var(--green)]/20 rounded-lg px-3 py-2 mb-3">
          {syncMsg}
        </div>
      )}
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--gray-muted)] py-4 text-center">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-[var(--gray-muted)] py-4 text-center">
          All AccuLynx installs are linked to claims ✓
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => (
            <UnlinkedRow key={ev.id} ev={ev} onLinked={() => { load(); onLinked?.(); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function UnlinkedRow({ ev, onLinked }: { ev: UnlinkedEvent; onLinked: () => void }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ClaimHit[]>([]);
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Default the search to the event's address text (title/location).
  useEffect(() => {
    if (open && !term) setTerm((ev.location || ev.title || "").slice(0, 40));
  }, [open, ev.location, ev.title, term]);

  useEffect(() => {
    if (!open || term.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("claims")
        .select("id, address, homeowner_name")
        .ilike("address", `%${term.trim()}%`)
        .limit(6);
      if (!cancelled) setHits((data as ClaimHit[]) || []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, open, supabase]);

  const link = useCallback(
    async (claimId: string) => {
      setLinking(true);
      setErr(null);
      try {
        const res = await fetch(`/api/admin/production/unlinked-installs/${ev.id}/link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claim_id: claimId }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        onLinked();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Link failed");
        setLinking(false);
      }
    },
    [ev.id, onLinked]
  );

  return (
    <li className="rounded-xl border border-[var(--border-glass)] bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-white truncate">{ev.title || ev.location || "Install"}</p>
          <p className="text-[11px] text-[var(--gray-muted)]">
            {fmtDate(ev.starts_at)}
            {ev.calendar_name ? ` · ${ev.calendar_name}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-semibold text-[var(--cyan)] hover:text-white px-2 py-1 rounded-md hover:bg-[var(--cyan)]/10 flex-shrink-0"
        >
          {open ? "Cancel" : "Link to claim"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {err && <p className="text-xs text-red-300">{err}</p>}
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search claims by address…"
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
          />
          {hits.length > 0 && (
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {hits.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={linking}
                  onClick={() => link(c.id)}
                  className="block w-full text-left p-2 rounded-lg hover:bg-white/[0.04] text-sm text-white disabled:opacity-50"
                >
                  {c.address ?? c.id}
                  {c.homeowner_name && (
                    <span className="text-xs text-[var(--gray-muted)] ml-2">{c.homeowner_name}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
