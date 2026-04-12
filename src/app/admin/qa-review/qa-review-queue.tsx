"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { QAAuditResult, QAAuditIssue } from "@/types/claim";

interface QueueClaim {
  id: string;
  slug?: string | null;
  address: string | null;
  carrier: string | null;
  status: string;
  qa_audit_flags: QAAuditResult | null;
  last_processed_at: string | null;
  user_id: string;
  contractor_rcv: number | null;
  user_email?: string | null;
}

export function QAReviewQueue({ initialClaims }: { initialClaims: QueueClaim[] }) {
  const router = useRouter();
  const [claims, setClaims] = useState<QueueClaim[]>(initialClaims);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);

  const stats = useMemo(() => {
    let totalCritical = 0;
    let totalMedium = 0;
    for (const c of claims) {
      totalCritical += c.qa_audit_flags?.critical?.length || 0;
      totalMedium += c.qa_audit_flags?.medium?.length || 0;
    }
    return { totalCritical, totalMedium, queueSize: claims.length };
  }, [claims]);

  const handleOverride = async (claimId: string) => {
    if (!confirm("Release this claim to the customer? They will get the completion email and download access. The qa_audit_flags will remain for audit history.")) {
      return;
    }
    setOverriding(claimId);
    try {
      const res = await fetch(`/api/admin/qa-review/${claimId}/release`, { method: "POST" });
      if (!res.ok) {
        const body = await res.text();
        alert(`Release failed: ${body}`);
        return;
      }
      setClaims((prev) => prev.filter((c) => c.id !== claimId));
    } catch (err) {
      alert(`Release failed: ${String(err)}`);
    } finally {
      setOverriding(null);
    }
  };

  const handleReprocess = async (claimId: string) => {
    if (!confirm("Reprocess this claim from scratch? This will re-run PDF generation and the QA audit.")) return;
    setOverriding(claimId);
    try {
      const res = await fetch(`https://dumbroof-backend-production.up.railway.app/api/reprocess/${claimId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        alert(`Reprocess failed: HTTP ${res.status}`);
        return;
      }
      alert("Reprocess triggered. Refresh in ~5 min to see results.");
      router.refresh();
    } catch (err) {
      alert(`Reprocess failed: ${String(err)}`);
    } finally {
      setOverriding(null);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg-dark)] px-6 py-10">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-black text-white mb-2">QA Review Queue</h1>
          <p className="text-[var(--gray-dim)] text-sm">
            Claims held from customer delivery because the qa-auditor agent flagged critical issues.
            Review each, then release (override) or reprocess.
          </p>
        </header>

        {/* Stats tiles */}
        <section className="grid grid-cols-3 gap-4 mb-8">
          <StatTile label="Pending Claims" value={stats.queueSize} color="#2563eb" />
          <StatTile label="Critical Flags" value={stats.totalCritical} color="#b91c1c" />
          <StatTile label="Medium Warnings" value={stats.totalMedium} color="#b45309" />
        </section>

        {claims.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-white mb-1">Queue is empty</p>
            <p className="text-sm text-[var(--gray-dim)]">
              No claims currently blocked by the QA auditor. When it flags a report, it will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {claims.map((claim) => {
              const flags = claim.qa_audit_flags;
              const crit = flags?.critical || [];
              const med = flags?.medium || [];
              const isExpanded = expanded === claim.id;
              return (
                <article key={claim.id} className="glass-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : claim.id)}
                    className="w-full p-5 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h2 className="text-lg font-bold text-white">{claim.address || "(no address)"}</h2>
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                            {crit.length} critical
                          </span>
                          {med.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {med.length} medium
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--gray-dim)] mb-2">
                          {claim.carrier || "(no carrier)"} · {claim.user_email || "(no email)"} · processed {formatRelative(claim.last_processed_at)}
                        </p>
                        {flags?.summary && (
                          <p className="text-sm text-blue-300 italic">&ldquo;{flags.summary}&rdquo;</p>
                        )}
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
                      {crit.length > 0 && (
                        <IssueList label="🛑 Critical Issues" color="text-red-400" issues={crit} />
                      )}
                      {med.length > 0 && (
                        <IssueList label="⚠️ Medium Warnings" color="text-amber-400" issues={med} />
                      )}

                      {flags?.ground_truth != null && (
                        <details className="mt-4">
                          <summary className="text-xs text-[var(--gray-dim)] cursor-pointer">Ground truth used for audit</summary>
                          <pre className="mt-2 text-xs text-[var(--gray)] bg-black/40 p-3 rounded overflow-x-auto">{JSON.stringify(flags.ground_truth, null, 2)}</pre>
                        </details>
                      )}

                      <div className="mt-6 flex flex-wrap gap-3">
                        <a
                          href={`/admin/claim/${claim.id}`}
                          className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-sm text-white border border-white/[0.1] transition-colors"
                        >
                          Open claim details
                        </a>
                        <button
                          type="button"
                          onClick={() => handleReprocess(claim.id)}
                          disabled={overriding === claim.id}
                          className="px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-sm text-amber-200 border border-amber-500/30 transition-colors disabled:opacity-50"
                        >
                          {overriding === claim.id ? "…" : "Reprocess"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOverride(claim.id)}
                          disabled={overriding === claim.id}
                          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-sm text-white font-semibold transition-colors disabled:opacity-50"
                        >
                          {overriding === claim.id ? "Releasing…" : "Override & release to customer"}
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

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="glass-card p-5">
      <p className="text-xs uppercase tracking-wider text-[var(--gray-dim)] mb-2">{label}</p>
      <p className="text-4xl font-black" style={{ color }}>{value}</p>
    </div>
  );
}

function IssueList({ label, color, issues }: { label: string; color: string; issues: QAAuditIssue[] }) {
  return (
    <div className="mb-4">
      <h3 className={`text-sm font-bold ${color} mb-2`}>{label}</h3>
      <ul className="space-y-3">
        {issues.map((it, i) => (
          <li key={i} className="bg-black/30 rounded-lg p-3 border border-white/[0.06]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-bold text-white">{it.issue}</span>
              {it.location && <span className="text-xs text-[var(--gray-dim)]">@ {it.location}</span>}
            </div>
            {it.found && it.expected && (
              <div className="text-xs mb-2 font-mono">
                <div className="text-red-400">found:    {it.found}</div>
                <div className="text-green-400">expected: {it.expected}</div>
              </div>
            )}
            {it.quote && (
              <div className="text-xs italic text-[var(--gray)] bg-black/40 p-2 rounded">&ldquo;{it.quote}&rdquo;</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "unknown";
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
