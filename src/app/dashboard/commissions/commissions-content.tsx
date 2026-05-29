"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckUploadModal } from "@/components/check-upload-modal";
import { AobCommissionModal } from "@/components/aob-commission-modal";
import {
  fmtMoneyCents,
  fmtCommissionType,
  timeAgo,
  type CommissionType,
} from "@/lib/commissions";

type Status = "pending" | "approved" | "rejected" | "paid";

interface MineRequest {
  id: string;
  claim_id: string;
  type: CommissionType;
  amount_cents: number;
  photo_url: string | null;
  status: Status;
  submitted_at: string;
  paid_at: string | null;
  notes: string | null;
  decision_notes: string | null;
  claim: { address: string | null; homeowner_name: string | null } | null;
}

interface Summary {
  pending: { count: number; cents: number };
  approved: { count: number; cents: number };
  paid: { count: number; cents: number };
  rejected: { count: number; cents: number };
}

const EMPTY_SUMMARY: Summary = {
  pending: { count: 0, cents: 0 },
  approved: { count: 0, cents: 0 },
  paid: { count: 0, cents: 0 },
  rejected: { count: 0, cents: 0 },
};

export function CommissionsContent() {
  const [requests, setRequests] = useState<MineRequest[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCheck, setShowCheck] = useState(false);
  const [showAob, setShowAob] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/commissions/mine");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setRequests(json.requests || []);
      setSummary(json.summary || EMPTY_SUMMARY);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <Link
          href="/dashboard"
          className="text-xs text-[var(--gray-muted)] hover:text-white"
        >
          ← Back to dashboard
        </Link>

        <div className="mt-3 mb-6 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Commissions</h1>
            <p className="text-[var(--gray-muted)] mt-1 text-sm">
              Upload your checks for 10% and your signed AOBs for $100. Your
              admin reviews &amp; pays them out.
            </p>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <SummaryTile
            label="Pending"
            cents={summary.pending.cents}
            count={summary.pending.count}
            color="var(--amber)"
          />
          <SummaryTile
            label="Approved"
            cents={summary.approved.cents}
            count={summary.approved.count}
            color="var(--cyan)"
          />
          <SummaryTile
            label="Paid out"
            cents={summary.paid.cents}
            count={summary.paid.count}
            color="var(--green)"
          />
        </div>

        {/* CTAs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          <button
            type="button"
            onClick={() => setShowAob(true)}
            className="text-left p-5 rounded-2xl border border-[var(--cyan)]/40 bg-gradient-to-br from-[var(--cyan)]/[0.10] to-transparent hover:border-[var(--cyan)] transition-colors"
          >
            <p className="text-lg font-bold text-white">Get my $100</p>
            <p className="text-sm text-[var(--gray-muted)] mt-0.5">
              Submit a signed AOB. Requires a complete claim + uploaded AOB.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setShowCheck(true)}
            className="text-left p-5 rounded-2xl border border-[var(--green)]/40 bg-gradient-to-br from-[var(--green)]/[0.10] to-transparent hover:border-[var(--green)] transition-colors"
          >
            <p className="text-lg font-bold text-white">Upload a check</p>
            <p className="text-sm text-[var(--gray-muted)] mt-0.5">
              Snap a collected check — we file your 10% in one tap.
            </p>
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {error}
          </div>
        )}

        <h2 className="text-sm font-bold text-[var(--gray)] uppercase tracking-wide mb-3">
          My requests
        </h2>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card p-5 animate-shimmer h-24" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-[var(--gray)] text-sm">
              No commissions yet. Upload a check or submit a signed AOB to get
              started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </div>
        )}
      </div>

      <AobCommissionModal
        open={showAob}
        onClose={() => setShowAob(false)}
        onSubmitted={load}
      />
      <CheckUploadModal
        open={showCheck}
        onClose={() => setShowCheck(false)}
        onUploaded={load}
        enableCommission
      />
    </div>
  );
}

function SummaryTile({
  label,
  cents,
  count,
  color,
}: {
  label: string;
  cents: number;
  count: number;
  color: string;
}) {
  return (
    <div className="glass-card p-4">
      <p
        className="text-xs font-bold uppercase tracking-wide"
        style={{ color }}
      >
        {label}
      </p>
      <p className="font-mono text-xl sm:text-2xl font-bold text-white mt-1 tabular-nums">
        {fmtMoneyCents(cents)}
      </p>
      <p className="text-xs text-[var(--gray-muted)] mt-0.5">
        {count} {count === 1 ? "request" : "requests"}
      </p>
    </div>
  );
}

function RequestRow({ request: r }: { request: MineRequest }) {
  return (
    <div className="glass-card p-4 flex items-center gap-4">
      {r.photo_url ? (
        <a
          href={r.photo_url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-16 h-16 rounded-lg overflow-hidden border border-[var(--border-glass)] bg-black flex-shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.photo_url} alt="proof" className="w-full h-full object-cover" />
        </a>
      ) : (
        <div className="w-16 h-16 rounded-lg border border-dashed border-[var(--border-glass)] flex items-center justify-center text-[10px] text-[var(--gray-dim)] flex-shrink-0">
          no photo
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
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
        <p className="text-xs text-[var(--gray-muted)] mt-0.5">
          {r.status === "paid" && r.paid_at
            ? `Paid ${timeAgo(r.paid_at)}`
            : `Submitted ${timeAgo(r.submitted_at)}`}
          {r.status === "rejected" && r.decision_notes
            ? ` · ${r.decision_notes}`
            : ""}
        </p>
      </div>

      <p className="font-mono text-xl font-bold text-[var(--green)] flex-shrink-0">
        {fmtMoneyCents(r.amount_cents)}
      </p>
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
