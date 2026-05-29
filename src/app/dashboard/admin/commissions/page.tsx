"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  fmtMoneyCents,
  fmtCommissionType,
  timeAgo,
} from "@/lib/commissions";

type Status = "pending" | "approved" | "rejected" | "paid";

interface Claim {
  address: string | null;
  homeowner_name: string | null;
  carrier_name: string | null;
  financials: { total?: number } | null;
}

interface CommissionRequest {
  id: string;
  claim_id: string;
  rep_user_id: string;
  rep_email: string | null;
  type: "check_10pct" | "aob_100" | "other";
  amount_cents: number;
  photo_path: string | null;
  photo_url: string | null;
  status: Status;
  submitted_at: string;
  decided_at: string | null;
  paid_at: string | null;
  notes: string | null;
  decision_notes: string | null;
  claim: Claim | null;
}

const TABS: { key: Status | "all"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function repName(email: string | null): string {
  if (!email) return "Unknown";
  const local = email.split("@")[0];
  return local
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export default function CommissionsPage() {
  const [tab, setTab] = useState<Status | "all">("pending");
  const [data, setData] = useState<CommissionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/commissions?status=${tab}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.requests || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  // Always-on pending summary for the primary CTA, regardless of which
  // tab is open. Refetched whenever the list reloads.
  const [pendingSummary, setPendingSummary] = useState<{
    count: number;
    cents: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/commissions?status=pending")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json?.requests) return;
        const rows = json.requests as CommissionRequest[];
        const cents = rows.reduce((s, r) => s + r.amount_cents, 0);
        setPendingSummary({ count: rows.length, cents });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const decide = useCallback(
    async (id: string, action: "approve" | "reject" | "mark_paid") => {
      setBusyId(id);
      try {
        const res = await fetch("/api/admin/commissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const totalPendingCents = data.reduce(
    (sum, r) => (r.status === "pending" ? sum + r.amount_cents : sum),
    0
  );

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 pl-10 lg:pl-0 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Commissions</h1>
            <p className="text-[var(--gray-muted)] mt-1 text-sm">
              Approve, reject, and pay rep commission requests. 10% on checks, $100 per signed AOB.
            </p>
          </div>
          {pendingSummary && pendingSummary.count > 0 ? (
            <button
              type="button"
              onClick={() => setTab("pending")}
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
            >
              Approve {pendingSummary.count} pending{" "}
              <span className="font-mono opacity-90">
                ({fmtMoneyCents(pendingSummary.cents)})
              </span>
              {" →"}
            </button>
          ) : (
            <span className="text-xs text-[var(--green)] font-semibold inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--green)]/10 border border-[var(--green)]/30">
              ✓ Nothing pending
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-[var(--border-glass)]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-[var(--cyan)] text-white"
                  : "border-transparent text-[var(--gray-muted)] hover:text-white"
              }`}
            >
              {t.label}
              {tab === t.key && data.length > 0 && (
                <span className="ml-2 text-xs text-[var(--gray-muted)] font-normal">
                  {data.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "pending" && data.length > 0 && (
          <div className="glass-card p-4 mb-6 flex items-center justify-between">
            <span className="text-sm text-[var(--gray)]">
              <span className="font-bold text-white">{data.length}</span> pending
              · awaiting your approval
            </span>
            <span className="font-mono text-lg font-bold text-[var(--amber)]">
              {fmtMoneyCents(totalPendingCents)}
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card p-5 animate-shimmer h-32" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-[var(--gray)] text-sm">
              No commission requests {tab !== "all" ? `in ${tab}` : ""}.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                busy={busyId === r.id}
                onDecide={decide}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestCard({
  request: r,
  busy,
  onDecide,
}: {
  request: CommissionRequest;
  busy: boolean;
  onDecide: (id: string, action: "approve" | "reject" | "mark_paid") => void;
}) {
  return (
    <div className="glass-card p-5">
      <div className="flex flex-col lg:flex-row gap-5">
        {/* Photo (if present) */}
        {r.photo_url ? (
          <a
            href={r.photo_url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full lg:w-40 h-32 rounded-xl overflow-hidden border border-[var(--border-glass)] bg-black flex-shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={r.photo_url}
              alt="commission proof"
              className="w-full h-full object-cover"
            />
          </a>
        ) : (
          <div className="w-full lg:w-40 h-32 rounded-xl border border-dashed border-[var(--border-glass)] flex items-center justify-center text-xs text-[var(--gray-dim)] flex-shrink-0">
            no photo
          </div>
        )}

        {/* Main */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-semibold text-white">
                  {repName(r.rep_email)}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--border-glass)] text-[var(--gray)]">
                  {fmtCommissionType(r.type)}
                </span>
                <StatusBadge status={r.status} />
              </div>
              <Link
                href={`/dashboard/claim/${r.claim_id}`}
                className="block text-sm text-[var(--cyan)] hover:underline mt-1 truncate"
              >
                {r.claim?.address ?? r.claim_id}
              </Link>
              {r.claim && (
                <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                  {[r.claim.homeowner_name, r.claim.carrier_name]
                    .filter(Boolean)
                    .join(" · ")}
                  {r.claim.financials?.total
                    ? ` · Claim total ${fmtMoneyCents(Math.round(r.claim.financials.total * 100))}`
                    : ""}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="font-mono text-2xl font-bold text-[var(--green)]">
                {fmtMoneyCents(r.amount_cents)}
              </p>
              <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                submitted {timeAgo(r.submitted_at)}
              </p>
            </div>
          </div>

          {r.notes && (
            <p className="mt-3 text-sm text-[var(--gray)] bg-white/[0.02] rounded-lg px-3 py-2 border border-[var(--border-glass)]">
              {r.notes}
            </p>
          )}

          {r.decision_notes && (
            <p className="mt-2 text-xs text-[var(--gray-muted)]">
              Decision note: {r.decision_notes}
            </p>
          )}

          {/* Actions */}
          {r.status === "pending" && (
            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => onDecide(r.id, "approve")}
                disabled={busy}
                className="bg-gradient-to-r from-[var(--green)] to-[var(--cyan)] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => onDecide(r.id, "reject")}
                disabled={busy}
                className="px-4 py-2 rounded-xl border border-[var(--red-accent)]/50 text-[var(--red-accent)] hover:bg-[var(--red-accent)]/10 text-sm font-semibold transition-colors"
              >
                Reject
              </button>
            </div>
          )}
          {r.status === "approved" && (
            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => onDecide(r.id, "mark_paid")}
                disabled={busy}
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold"
              >
                Mark paid
              </button>
              <span className="text-xs text-[var(--gray-muted)]">
                approved {timeAgo(r.decided_at || r.submitted_at)}
              </span>
            </div>
          )}
          {r.status === "paid" && r.paid_at && (
            <p className="text-xs text-[var(--green)] mt-3">
              ✓ Paid {timeAgo(r.paid_at)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; color: string; bg: string }> = {
    pending: { label: "Pending", color: "var(--amber)", bg: "rgba(255, 194, 51, 0.15)" },
    approved: { label: "Approved", color: "var(--cyan)", bg: "rgba(34, 216, 255, 0.12)" },
    paid: { label: "Paid", color: "var(--green)", bg: "rgba(34, 197, 94, 0.15)" },
    rejected: { label: "Rejected", color: "var(--red-accent)", bg: "rgba(255, 90, 106, 0.12)" },
  };
  const s = map[status];
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
}
