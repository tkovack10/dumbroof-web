"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ClaimFilterChips,
  type ClaimGridFilter,
  type ClaimGridCounts,
} from "@/components/claim-filter-chips";
import {
  ClaimRowAction,
  type ClaimGridRow,
} from "@/components/claim-row-action";

interface GridResponse {
  claims: ClaimGridRow[];
  counts: ClaimGridCounts;
}

const STAGES: { key: string; label: string; color: string }[] = [
  { key: "uploaded",     label: "Uploaded",     color: "var(--blue)" },
  { key: "processing",   label: "Processing",   color: "var(--amber)" },
  { key: "ready",        label: "Ready",        color: "var(--cyan)" },
  { key: "won",          label: "Won",          color: "var(--green)" },
  { key: "installation", label: "Installation", color: "#f97316" },
  { key: "completed",    label: "Completed",    color: "var(--purple)" },
  { key: "invoiced",     label: "Invoiced",     color: "#14b8a6" },
  { key: "paid",         label: "Paid",         color: "#16a34a" },
  // Catch-all so error/draft/failed/submitted statuses surface for triage
  // instead of being silently lumped into "uploaded".
  { key: "unknown",      label: "Needs triage", color: "var(--red-accent)" },
];

const STAGE_KEYS = new Set(STAGES.map((s) => s.key));

function classifyStage(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (!s) return "uploaded";
  if (STAGE_KEYS.has(s)) return s;
  if (s.includes("upload")) return "uploaded";
  if (s.includes("process")) return "processing";
  if (s.includes("ready")) return "ready";
  if (s === "win" || s.includes("won")) return "won";
  if (s.includes("install")) return "installation";
  if (s.includes("complete")) return "completed";
  if (s.includes("invoice")) return "invoiced";
  if (s === "paid") return "paid";
  // error / failed / draft / submitted / anything else → triage bucket
  return "unknown";
}

export default function PipelinePage() {
  const [filter, setFilter] = useState<ClaimGridFilter>("all");
  const [data, setData] = useState<GridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/claims-grid?filter=${filter}&scope=all`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as GridResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, ClaimGridRow[]>();
    for (const s of STAGES) buckets.set(s.key, []);
    for (const c of data?.claims ?? []) {
      const k = classifyStage(c.status);
      buckets.get(k)?.push(c);
    }
    return buckets;
  }, [data]);

  const toggleStage = useCallback((key: string) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-5 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Pipeline</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Every claim, grouped by stage. Click any stage header to collapse.
          </p>
        </div>

        <div className="mb-5">
          <ClaimFilterChips
            active={filter}
            counts={data?.counts ?? null}
            onChange={setFilter}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-xl animate-shimmer" />
            ))}
          </div>
        ) : !data || data.claims.length === 0 ? (
          <div className="glass-card p-12 text-center text-sm text-[var(--gray-muted)]">
            No claims match this filter.
          </div>
        ) : (
          <div className="space-y-5">
            {STAGES.map((stage) => {
              const claims = grouped.get(stage.key) ?? [];
              if (claims.length === 0) return null;
              const collapsed = collapsedStages.has(stage.key);
              return (
                <div key={stage.key}>
                  <button
                    type="button"
                    onClick={() => toggleStage(stage.key)}
                    className="w-full flex items-center gap-2 mb-2 opacity-90 hover:opacity-100 transition-opacity"
                  >
                    <svg
                      className={`w-3 h-3 text-[var(--gray-muted)] transition-transform ${
                        collapsed ? "-rotate-90" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: stage.color }}
                    />
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: stage.color }}
                    >
                      {stage.label}
                    </span>
                    <span className="text-xs font-mono text-[var(--gray-muted)]">
                      {claims.length}
                    </span>
                    <span className="flex-1 h-px bg-[var(--border-glass)] ml-2" />
                  </button>
                  {!collapsed && (
                    <div className="space-y-2">
                      {claims.map((c) => (
                        <ClaimRowAction key={c.id} claim={c} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
