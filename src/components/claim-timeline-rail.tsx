"use client";

import { useEffect, useState } from "react";

type Category = "milestone" | "communication" | "document" | "action" | "system";

interface ClaimEvent {
  id: string;
  event_type: string;
  event_category: Category;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  source: string;
  created_by: string | null;
}

const CATEGORY_STYLES: Record<Category, { dot: string; text: string; bg: string }> = {
  milestone:     { dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/30" },
  communication: { dot: "bg-cyan-400",    text: "text-cyan-300",    bg: "bg-cyan-500/10 border-cyan-500/30" },
  document:      { dot: "bg-blue-400",    text: "text-blue-300",    bg: "bg-blue-500/10 border-blue-500/30" },
  action:        { dot: "bg-purple-400",  text: "text-purple-300",  bg: "bg-purple-500/10 border-purple-500/30" },
  system:        { dot: "bg-gray-500",    text: "text-gray-400",    bg: "bg-gray-500/10 border-gray-500/30" },
};

function timeAgo(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return date.toLocaleDateString();
}

export function ClaimTimelineRail({ claimId }: { claimId: string }) {
  const [events, setEvents] = useState<ClaimEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/claims/${claimId}/events?limit=200`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setEvents(data.events || []);
      } catch (err) {
        console.warn("[timeline] fetch failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  const filtered = filter === "all" ? events : events.filter((e) => e.event_category === filter);
  const visible = showAll ? filtered : filtered.slice(0, 20);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const counts: Record<string, number> = { all: events.length };
  for (const ev of events) counts[ev.event_category] = (counts[ev.event_category] || 0) + 1;

  return (
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--white)]">Timeline</h3>
        {events.length > 0 && (
          <span className="text-xs text-[var(--gray-dim)]">{events.length} events</span>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(["all", "milestone", "communication", "document", "action", "system"] as const).map((cat) => {
          const active = filter === cat;
          const n = counts[cat] || 0;
          return (
            <button
              key={cat}
              onClick={() => {
                setFilter(cat);
                setShowAll(false);
              }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active
                  ? cat === "all"
                    ? "bg-[var(--cyan)]/15 border-[var(--cyan)]/40 text-[var(--cyan)]"
                    : `${CATEGORY_STYLES[cat as Category].bg} ${CATEGORY_STYLES[cat as Category].text}`
                  : "bg-white/[0.04] border-[var(--border-glass)] text-[var(--gray-muted)] hover:text-[var(--white)]"
              }`}
            >
              {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
              {n > 0 && <span className="ml-1 opacity-70">{n}</span>}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--gray-muted)] py-6 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--gray-muted)] py-6 text-center">
          {filter === "all"
            ? "No events yet. Activity will appear here as the claim progresses."
            : "No events in this category."}
        </p>
      ) : (
        <ol className="relative">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--border-glass)]" />
          {visible.map((ev) => {
            const style = CATEGORY_STYLES[ev.event_category] || CATEGORY_STYLES.action;
            const isExpanded = expanded.has(ev.id);
            const hasMetadata = ev.description || (ev.metadata && Object.keys(ev.metadata).length > 0);
            return (
              <li key={ev.id} className="relative pl-6 pb-3 last:pb-0">
                <span
                  className={`absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-[rgb(15,18,35)] ${style.dot}`}
                />
                <button
                  onClick={() => hasMetadata && toggleExpand(ev.id)}
                  disabled={!hasMetadata}
                  className="w-full text-left group"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-[var(--white)] font-medium group-hover:text-[var(--cyan)] transition-colors">
                      {ev.title}
                    </span>
                    <span className="text-xs text-[var(--gray-dim)] flex-shrink-0">
                      {timeAgo(ev.occurred_at)}
                    </span>
                  </div>
                  {hasMetadata && isExpanded && (
                    <div className="mt-1.5 text-xs text-[var(--gray-muted)] bg-white/[0.02] rounded px-2 py-1.5">
                      {ev.description && <p>{ev.description}</p>}
                      {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                        <pre className="mt-1 text-[10px] font-mono opacity-70 overflow-x-auto">
                          {JSON.stringify(ev.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {filtered.length > 20 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 w-full text-xs text-[var(--cyan)] hover:text-[var(--white)] transition-colors"
        >
          Show {filtered.length - 20} more events
        </button>
      )}
    </div>
  );
}
