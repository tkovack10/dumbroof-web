"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Rec {
  id: number;
  agent: string;
  target_type: string;
  target_path: string;
  summary: string;
  rationale: string | null;
  proposed_diff: string;
  evidence: Record<string, unknown> | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  deferred_until: string | null;
  github_pr_url: string | null;
  github_branch: string | null;
  created_at: string;
}

const AGENT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  damage_detective: { bg: "bg-blue-500/20", text: "text-blue-300", label: "Damage Detective" },
  carrier_analyst: { bg: "bg-red-500/20", text: "text-red-300", label: "Carrier Analyst" },
  richard_trainer: { bg: "bg-green-500/20", text: "text-green-300", label: "Richard Trainer" },
  qa_auditor: { bg: "bg-purple-500/20", text: "text-purple-300", label: "QA Auditor" },
};

export function RecommendationsQueue({ initialRecs }: { initialRecs: Rec[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentFilter = searchParams.get("agent");
  const [recs, setRecs] = useState<Rec[]>(initialRecs);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [acting, setActing] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!agentFilter) return recs;
    return recs.filter((r) => r.agent === agentFilter);
  }, [recs, agentFilter]);

  const stats = useMemo(() => {
    const byAgent: Record<string, number> = {};
    for (const r of recs) {
      byAgent[r.agent] = (byAgent[r.agent] || 0) + 1;
    }
    return byAgent;
  }, [recs]);

  const handleAction = async (id: number, action: "approve" | "reject" | "defer", reason?: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/admin/agent-recommendations/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.text();
        alert(`Action failed: ${body}`);
        return;
      }
      const data = await res.json();
      if (action === "approve" && data.pr_url) {
        window.open(data.pr_url, "_blank");
      }
      setRecs((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(`Action failed: ${String(err)}`);
    } finally {
      setActing(null);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg-dark)] px-6 py-10">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-black text-white mb-2">Agent Recommendations</h1>
          <p className="text-[var(--gray-dim)] text-sm">
            Proposed improvements from damage-detective, carrier-analyst, and richard-trainer.
            Review each diff, then Open PR (creates a GitHub PR), Dismiss, or Defer.
          </p>
        </header>

        {/* Agent filter tiles */}
        <section className="flex flex-wrap gap-3 mb-8">
          <FilterChip
            label="All"
            count={recs.length}
            active={!agentFilter}
            onClick={() => router.push("/admin/agent-recommendations")}
          />
          {Object.entries(AGENT_COLORS).map(([key, cfg]) => (
            <FilterChip
              key={key}
              label={cfg.label}
              count={stats[key] || 0}
              active={agentFilter === key}
              onClick={() => router.push(`/admin/agent-recommendations?agent=${key}`)}
            />
          ))}
        </section>

        {filtered.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-white mb-1">No pending recommendations</p>
            <p className="text-sm text-[var(--gray-dim)]">
              When the weekly agents find improvement opportunities, they&apos;ll appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((rec) => {
              const cfg = AGENT_COLORS[rec.agent] || AGENT_COLORS.qa_auditor;
              const isExpanded = expanded === rec.id;
              return (
                <article key={rec.id} className="glass-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : rec.id)}
                    className="w-full p-5 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text} border border-white/10`}>
                            {cfg.label}
                          </span>
                          <span className="text-xs text-[var(--gray-dim)] font-mono">{rec.target_path}</span>
                        </div>
                        <h2 className="text-sm font-bold text-white mb-1">{rec.summary}</h2>
                        <p className="text-xs text-[var(--gray-dim)]">
                          {formatRelative(rec.created_at)}
                          {rec.status === "deferred" && rec.deferred_until && ` · deferred until ${rec.deferred_until.slice(0, 10)}`}
                        </p>
                      </div>
                      <svg
                        className={`w-5 h-5 text-[var(--gray-dim)] transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-white/[0.06] p-5 bg-white/[0.02]">
                      {rec.rationale && (
                        <div className="mb-4">
                          <h3 className="text-xs font-semibold text-[var(--gray-dim)] uppercase mb-1">Rationale</h3>
                          <p className="text-sm text-[var(--gray)]">{rec.rationale}</p>
                        </div>
                      )}

                      <div className="mb-4">
                        <h3 className="text-xs font-semibold text-[var(--gray-dim)] uppercase mb-1">Proposed Diff</h3>
                        <pre className="text-xs text-[var(--gray)] bg-black/50 p-4 rounded-lg overflow-x-auto font-mono whitespace-pre-wrap border border-white/[0.06]">
                          {rec.proposed_diff}
                        </pre>
                      </div>

                      {rec.evidence && Object.keys(rec.evidence).length > 0 && (
                        <details className="mb-4">
                          <summary className="text-xs text-[var(--gray-dim)] cursor-pointer">Evidence data</summary>
                          <pre className="mt-2 text-xs text-[var(--gray)] bg-black/40 p-3 rounded overflow-x-auto">
                            {JSON.stringify(rec.evidence, null, 2)}
                          </pre>
                        </details>
                      )}

                      <div className="flex flex-wrap gap-3 mt-4">
                        <button
                          type="button"
                          onClick={() => handleAction(rec.id, "approve")}
                          disabled={acting === rec.id}
                          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-sm text-white font-semibold transition-colors disabled:opacity-50"
                        >
                          {acting === rec.id ? "Creating PR..." : "Open PR"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const reason = prompt("Optional reason for deferring:");
                            handleAction(rec.id, "defer", reason || undefined);
                          }}
                          disabled={acting === rec.id}
                          className="px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-sm text-amber-200 border border-amber-500/30 transition-colors disabled:opacity-50"
                        >
                          Defer 7 days
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const reason = prompt("Reason for dismissal:");
                            if (reason !== null) handleAction(rec.id, "reject", reason || undefined);
                          }}
                          disabled={acting === rec.id}
                          className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-sm text-[var(--gray-dim)] border border-white/[0.1] transition-colors disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function FilterChip({ label, count, active, onClick }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? "bg-white text-black"
          : "bg-white/[0.06] text-[var(--gray-dim)] hover:bg-white/[0.1] border border-white/[0.1]"
      }`}
    >
      {label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
    </button>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
