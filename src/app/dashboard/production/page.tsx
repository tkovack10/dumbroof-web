"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ProductionCalendar,
  type Schedule,
  type Crew,
} from "@/components/production-calendar";
import { ScheduleClaimModal } from "@/components/schedule-claim-modal";
import { AdminTabStrip } from "@/components/admin-tab-strip";
import { RichardSuggestionBanner } from "@/components/richard-suggestion-banner";
import { NeedsInstallList } from "@/components/needs-install-list";

type View = "week" | "month";
type ProductionTab = "unscheduled" | "calendar" | "crews";

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtRange(view: View, cursor: Date): string {
  // Build manually instead of toLocaleDateString — Vercel edge ICU data has
  // produced odd output like "May 17 – 2026 (day: 23)" in production.
  if (view === "week") {
    const start = startOfWeek(cursor);
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}`;
    const endStr = sameMonth
      ? `${end.getDate()}, ${end.getFullYear()}`
      : `${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    return `${startStr} – ${endStr}`;
  }
  return `${MONTH_LONG[cursor.getMonth()]} ${cursor.getFullYear()}`;
}

export default function ProductionPage() {
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCrewModal, setShowCrewModal] = useState(false);
  const [tab, setTab] = useState<ProductionTab>("calendar");

  const [editing, setEditing] = useState<Schedule | null>(null);
  const [creatingAt, setCreatingAt] = useState<Date | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefillClaimId, setPrefillClaimId] = useState<string | null>(null);
  const [needsInstallCount, setNeedsInstallCount] = useState<number>(0);

  // Window for fetching — pad by 7 days on each side
  const { from, to } = useMemo(() => {
    let start: Date;
    let end: Date;
    if (view === "week") {
      start = startOfWeek(cursor);
      end = new Date(start.getTime() + 7 * 86_400_000);
    } else {
      start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return {
      from: new Date(start.getTime() - 7 * 86_400_000).toISOString(),
      to: new Date(end.getTime() + 7 * 86_400_000).toISOString(),
    };
  }, [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/production/schedules?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setSchedules((json.schedules as Schedule[]) || []);
      setCrews((json.crews as Crew[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const step = useCallback(
    (dir: 1 | -1) => {
      setCursor((c) => {
        const x = new Date(c);
        if (view === "week") {
          x.setDate(x.getDate() + dir * 7);
        } else {
          x.setMonth(x.getMonth() + dir);
        }
        return x;
      });
    },
    [view]
  );

  const counts = useMemo(() => {
    let scheduled = 0;
    let inProgress = 0;
    let completed = 0;
    let needNotify = 0;
    for (const s of schedules) {
      if (s.status === "scheduled") scheduled++;
      else if (s.status === "in_progress") inProgress++;
      else if (s.status === "completed") completed++;
      if (s.status === "scheduled" && s.notify_homeowner && !s.notified_at) {
        needNotify++;
      }
    }
    return { scheduled, inProgress, completed, needNotify };
  }, [schedules]);

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 pl-10 lg:pl-0">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--gray-muted)] hover:text-white mb-3 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
        <div className="mb-6 pl-10 lg:pl-0 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Production</h1>
            <p className="text-[var(--gray-muted)] mt-1 text-sm">
              Install calendar with homeowner auto-emails on every schedule change.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setCreatingAt(new Date());
              setModalOpen(true);
            }}
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
          >
            + New install
          </button>
        </div>

        {/* Richard inline suggestion — Bet 2 */}
        <RichardSuggestionBanner surface="production" />

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Scheduled" value={counts.scheduled} color="var(--cyan)" />
          <KpiCard label="In progress" value={counts.inProgress} color="var(--amber)" />
          <KpiCard label="Completed" value={counts.completed} color="var(--green)" />
          <KpiCard
            label="Need to notify"
            value={counts.needNotify}
            color={counts.needNotify > 0 ? "var(--red-accent)" : "var(--gray-muted)"}
          />
        </div>

        {/* Tabs — Phase 6 #5 */}
        <AdminTabStrip<ProductionTab>
          tabs={[
            { key: "unscheduled", label: "Unscheduled", count: needsInstallCount },
            { key: "calendar",    label: "Calendar",    count: counts.scheduled },
            { key: "crews",       label: "Crews",       count: crews.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "unscheduled" && (
          <NeedsInstallList
            refreshKey={schedules.length /* refetch when a schedule lands */}
            onScheduleClaim={(claim) => {
              setEditing(null);
              setCreatingAt(new Date());
              setPrefillClaimId(claim.claim_id);
              setModalOpen(true);
            }}
            onCountChange={setNeedsInstallCount}
          />
        )}

        {tab === "crews" && (
          <div className="glass-card p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white">Crews</h3>
              <button
                type="button"
                onClick={() => setShowCrewModal(true)}
                className="text-xs text-[var(--cyan)] hover:text-white font-semibold transition-colors"
              >
                + Add crew
              </button>
            </div>
            {crews.length === 0 ? (
              <p className="text-sm text-[var(--gray-muted)]">
                No crews yet. Click <em>+ Add crew</em> to create one.
              </p>
            ) : (
              <div className="space-y-2">
                {crews.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-glass)] bg-white/[0.02]"
                  >
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{ background: c.color }}
                    />
                    <span className="text-sm text-white">{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab !== "calendar" ? null : (
          <>
        {/* Controls */}
        <div className="glass-card p-3 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => step(-1)}
              className="w-9 h-9 rounded-lg hover:bg-white/[0.04] text-[var(--gray)] hover:text-white transition-colors flex items-center justify-center"
              aria-label="Previous"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setCursor(new Date())}
              className="px-3 py-1.5 rounded-lg hover:bg-white/[0.04] text-sm text-[var(--gray)] hover:text-white transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              className="w-9 h-9 rounded-lg hover:bg-white/[0.04] text-[var(--gray)] hover:text-white transition-colors flex items-center justify-center"
              aria-label="Next"
            >
              ›
            </button>
            <span className="ml-3 text-sm font-semibold text-white">
              {fmtRange(view, cursor)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5">
              {(["week", "month"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${
                    view === v ? "bg-white/[0.08] text-white" : "text-[var(--gray)]"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowCrewModal(true)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border-glass)] text-xs text-[var(--gray)] hover:text-white hover:bg-white/[0.04] transition-colors"
            >
              Manage crews
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="glass-card p-12 text-center animate-shimmer h-96" />
        ) : (
          <ProductionCalendar
            view={view}
            cursor={cursor}
            schedules={schedules}
            crews={crews}
            onScheduleClick={(s) => {
              setEditing(s);
              setCreatingAt(null);
              setModalOpen(true);
            }}
            onEmptySlotClick={(date) => {
              setEditing(null);
              setCreatingAt(date);
              setModalOpen(true);
            }}
          />
        )}
          </>
        )}
      </div>

      <ScheduleClaimModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setPrefillClaimId(null);
        }}
        existing={editing}
        initialDate={creatingAt}
        claimId={prefillClaimId ?? undefined}
        crews={crews}
        onSaved={() => {
          setPrefillClaimId(null);
          load();
        }}
      />

      <CrewsModal
        open={showCrewModal}
        onClose={() => {
          setShowCrewModal(false);
          load();
        }}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="glass-card p-4 text-center">
      <p className="text-2xl font-bold font-mono" style={{ color }}>
        {value}
      </p>
      <p className="text-xs text-[var(--gray-muted)] mt-1">{label}</p>
    </div>
  );
}

interface CrewRow extends Crew {
  active: boolean;
  members?: string[] | null;
  notes?: string | null;
}

function CrewsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [crews, setCrews] = useState<CrewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#22D8FF");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/crews");
      const json = await res.json();
      setCrews((json.crews as CrewRow[]) || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const add = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setName("");
      setColor("#22D8FF");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }, [name, color, load]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-[rgb(15,18,35)] sm:rounded-2xl rounded-t-2xl border border-[var(--border-glass)] max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[var(--border-glass)] flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Crews</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--gray-muted)] hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-white/[0.03] rounded animate-shimmer" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {crews.length === 0 ? (
                <p className="text-sm text-[var(--gray-muted)]">No crews yet.</p>
              ) : (
                crews.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-glass)] bg-white/[0.02]"
                  >
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{ background: c.color }}
                    />
                    <span className="text-sm text-white">{c.name}</span>
                    {!c.active && (
                      <span className="text-xs text-[var(--gray-dim)]">inactive</span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          <div className="pt-4 border-t border-[var(--border-glass)] space-y-3">
            <h3 className="text-sm font-bold text-white">Add a crew</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Crew A"
                className="flex-1 px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
              />
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-12 h-10 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] cursor-pointer"
              />
            </div>
            <button
              type="button"
              onClick={add}
              disabled={submitting || !name.trim()}
              className="w-full bg-gradient-to-r from-[var(--green)] to-[var(--cyan)] hover:shadow-[var(--shadow-glow-cyan)] disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            >
              {submitting ? "Adding…" : "Add crew"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
