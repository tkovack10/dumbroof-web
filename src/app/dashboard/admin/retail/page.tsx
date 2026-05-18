"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { RetailSettingsModal } from "@/components/retail-settings-modal";

type Status =
  | "draft"
  | "proposal_sent"
  | "accepted"
  | "invoiced"
  | "paid"
  | "completed"
  | "lost";

interface LineItem {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
}

interface InvoiceRollup {
  total: number;
  paid: number;
  sent: number;
  drafts: number;
}

interface RetailJob {
  id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  address: string | null;
  city_state_zip: string | null;
  scope_description: string | null;
  line_items: LineItem[] | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  status: Status;
  deposit_pct: number;
  proposal_sent_at: string | null;
  accepted_at: string | null;
  intro_email_sent_at: string | null;
  created_at: string;
  invoice_rollup?: InvoiceRollup;
}

interface RetailInvoice {
  id: string;
  retail_job_id: string;
  kind: "deposit" | "progress" | "balance" | "full";
  amount_cents: number;
  description: string | null;
  payment_link: string | null;
  status: "draft" | "sent" | "paid" | "void";
  sent_to_email: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<Status, string> = {
  draft: "var(--gray-muted)",
  proposal_sent: "var(--cyan)",
  accepted: "var(--blue)",
  invoiced: "var(--amber)",
  paid: "var(--green)",
  completed: "var(--green)",
  lost: "var(--red-accent)",
};

const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  proposal_sent: "Proposal sent",
  accepted: "Accepted",
  invoiced: "Invoiced",
  paid: "Paid",
  completed: "Completed",
  lost: "Lost",
};

function fmtCents(c: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function RetailPage() {
  const [jobs, setJobs] = useState<RetailJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/admin/retail${q}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setJobs((json.jobs as RetailJob[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    let pipeline = 0;
    let invoiced = 0;
    let paid = 0;
    let drafts = 0;
    for (const j of jobs) {
      if (!["lost", "completed"].includes(j.status)) pipeline += j.total_cents;
      if (j.invoice_rollup) {
        invoiced += j.invoice_rollup.sent + j.invoice_rollup.paid;
        paid += j.invoice_rollup.paid;
      }
      if (j.status === "draft") drafts++;
    }
    return { pipeline, invoiced, paid, drafts };
  }, [jobs]);

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 pl-10 lg:pl-0 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Retail</h1>
            <p className="text-[var(--gray-muted)] mt-1 text-sm">
              Cash &amp; homeowner-funded jobs. Ask Richard:{" "}
              <em>&quot;make a retail estimate for the Smiths&quot;</em>,{" "}
              <em>&quot;send Jane our about-us info&quot;</em>, or{" "}
              <em>&quot;invoice $4,500 deposit&quot;</em>.
            </p>
          </div>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              // Open Richard launcher with a prompt — Phase 4 retail flow
              window.dispatchEvent(
                new CustomEvent("richard-launcher:open", {
                  detail: {
                    prompt: "Help me create a retail estimate for ",
                  },
                })
              );
            }}
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2 rounded-xl text-sm font-bold transition-all"
          >
            + Ask Richard for an estimate
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="px-4 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-sm text-[var(--gray)] hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Prices &amp; terms
            </span>
          </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <Kpi label="Open pipeline" value={fmtCents(totals.pipeline)} color="var(--cyan)" />
          <Kpi label="Invoiced" value={fmtCents(totals.invoiced)} color="var(--amber)" />
          <Kpi label="Paid" value={fmtCents(totals.paid)} color="var(--green)" />
          <Kpi label="Drafts" value={`${totals.drafts}`} color="var(--gray-muted)" />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(["all", "draft", "proposal_sent", "accepted", "invoiced", "paid", "lost"] as (Status | "all")[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                statusFilter === s
                  ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08] text-white"
                  : "border-[var(--border-glass)] bg-white/[0.02] text-[var(--gray)] hover:bg-white/[0.04]"
              }`}
            >
              {s === "all" ? "All" : STATUS_LABEL[s as Status]}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded animate-shimmer" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="glass-card p-12 text-center text-sm text-[var(--gray-muted)]">
            No retail jobs yet. Ask Richard to create one — he&apos;ll save it here.
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-glass)]">
                  <th className="px-5 py-3 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider text-left">
                    Customer
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider text-left">
                    Status
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider text-right">
                    Total
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider text-right">
                    Invoiced
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider text-right">
                    Paid
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider text-right">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const isExpanded = expanded === j.id;
                  return (
                    <Fragment key={j.id}>
                      <tr
                        onClick={() => setExpanded(isExpanded ? null : j.id)}
                        className={`border-b border-[var(--border-glass)] hover:bg-white/[0.03] transition-colors cursor-pointer ${
                          isExpanded ? "bg-white/[0.03]" : ""
                        }`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <svg
                              className={`w-3 h-3 text-[var(--gray-muted)] flex-shrink-0 transition-transform ${
                                isExpanded ? "rotate-90" : ""
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                            <div>
                              <p className="text-sm text-white">{j.customer_name}</p>
                              <p className="text-xs text-[var(--gray-dim)] ml-0">
                                {[j.address, j.city_state_zip].filter(Boolean).join(", ") || j.customer_email || "—"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide"
                            style={{
                              color: STATUS_COLORS[j.status],
                              background: `color-mix(in srgb, ${STATUS_COLORS[j.status]} 18%, transparent)`,
                            }}
                          >
                            {STATUS_LABEL[j.status]}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm text-right font-mono text-white">
                          {fmtCents(j.total_cents)}
                        </td>
                        <td className="px-5 py-3 text-sm text-right font-mono text-[var(--amber)]">
                          {j.invoice_rollup && j.invoice_rollup.sent + j.invoice_rollup.paid > 0
                            ? fmtCents(j.invoice_rollup.sent + j.invoice_rollup.paid)
                            : "--"}
                        </td>
                        <td className="px-5 py-3 text-sm text-right font-mono text-[var(--green)]">
                          {j.invoice_rollup && j.invoice_rollup.paid > 0
                            ? fmtCents(j.invoice_rollup.paid)
                            : "--"}
                        </td>
                        <td className="px-5 py-3 text-xs text-right text-[var(--gray-muted)]">
                          {timeAgo(j.created_at)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-white/[0.015] border-b border-[var(--border-glass)]">
                          <td colSpan={6} className="px-5 py-4">
                            <RetailJobDetail jobId={j.id} onChanged={load} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Settings modal — mounted once at page level so the button works
            from any of the loading / empty / populated states. */}
        <RetailSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="glass-card p-4 text-center">
      <p className="font-mono text-xl font-bold" style={{ color }}>
        {value}
      </p>
      <p className="text-xs text-[var(--gray-muted)] mt-1">{label}</p>
    </div>
  );
}

function RetailJobDetail({
  jobId,
  onChanged,
}: {
  jobId: string;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<RetailJob | null>(null);
  const [invoices, setInvoices] = useState<RetailInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/retail/${jobId}`);
      if (res.ok) {
        const json = await res.json();
        setJob(json.job as RetailJob);
        setInvoices((json.invoices as RetailInvoice[]) || []);
      }
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const sendInvoice = useCallback(
    async (invoiceId: string) => {
      setSendingId(invoiceId);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/retail/${jobId}/invoices/${invoiceId}/send`,
          { method: "POST" }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        await load();
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed");
      } finally {
        setSendingId(null);
      }
    },
    [jobId, load, onChanged]
  );

  if (loading || !job) {
    return <div className="h-24 bg-white/[0.02] rounded animate-shimmer" />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--gray-muted)] font-bold mb-1">
            Customer
          </p>
          <p className="text-white">{job.customer_name}</p>
          {job.customer_email && (
            <p className="text-[var(--gray)]">{job.customer_email}</p>
          )}
          {job.customer_phone && (
            <p className="text-[var(--gray)]">{job.customer_phone}</p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--gray-muted)] font-bold mb-1">
            Job
          </p>
          <p className="text-white">
            {[job.address, job.city_state_zip].filter(Boolean).join(", ") || "—"}
          </p>
          {job.scope_description && (
            <p className="text-[var(--gray)] mt-1 italic">
              {job.scope_description}
            </p>
          )}
        </div>
      </div>

      {/* Line items */}
      {job.line_items && job.line_items.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--gray-muted)] font-bold mb-2">
            Line items
          </p>
          <div className="rounded-lg border border-[var(--border-glass)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/[0.02] text-left">
                  <th className="px-3 py-2 text-[var(--gray-muted)] font-medium">Description</th>
                  <th className="px-3 py-2 text-[var(--gray-muted)] font-medium text-right">Qty</th>
                  <th className="px-3 py-2 text-[var(--gray-muted)] font-medium text-right">Unit $</th>
                  <th className="px-3 py-2 text-[var(--gray-muted)] font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {job.line_items.map((li, i) => (
                  <tr key={i} className="border-t border-[var(--border-glass)]">
                    <td className="px-3 py-2 text-white">{li.description}</td>
                    <td className="px-3 py-2 text-right text-[var(--gray)] font-mono">
                      {li.qty} {li.unit}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--gray)] font-mono">
                      ${li.unit_price.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-white font-mono">
                      ${li.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--border-glass)] bg-white/[0.02] font-semibold">
                  <td colSpan={3} className="px-3 py-2 text-right text-[var(--gray-muted)]">
                    Subtotal
                  </td>
                  <td className="px-3 py-2 text-right text-white font-mono">
                    {fmtCents(job.subtotal_cents)}
                  </td>
                </tr>
                {job.tax_cents > 0 && (
                  <tr className="bg-white/[0.02]">
                    <td colSpan={3} className="px-3 py-2 text-right text-[var(--gray-muted)]">
                      Tax
                    </td>
                    <td className="px-3 py-2 text-right text-white font-mono">
                      {fmtCents(job.tax_cents)}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-[var(--border-glass)] bg-[var(--cyan)]/[0.05] font-bold">
                  <td colSpan={3} className="px-3 py-2 text-right text-white">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--cyan)] font-mono">
                    {fmtCents(job.total_cents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoices */}
      <div>
        <p className="text-[10px] uppercase tracking-wide text-[var(--gray-muted)] font-bold mb-2">
          Invoices
        </p>
        {invoices.length === 0 ? (
          <p className="text-xs text-[var(--gray-dim)]">
            None yet. Ask Richard: <em>&quot;invoice $X deposit for {job.customer_name}&quot;</em>.
          </p>
        ) : (
          <div className="space-y-1">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] border border-[var(--border-glass)] text-xs"
              >
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
                  style={{
                    color:
                      inv.status === "paid"
                        ? "var(--green)"
                        : inv.status === "sent"
                          ? "var(--cyan)"
                          : "var(--gray-muted)",
                    background: `color-mix(in srgb, ${
                      inv.status === "paid"
                        ? "var(--green)"
                        : inv.status === "sent"
                          ? "var(--cyan)"
                          : "var(--gray-muted)"
                    } 18%, transparent)`,
                  }}
                >
                  {inv.status}
                </span>
                <span className="text-[var(--gray)]">{inv.kind}</span>
                <span className="flex-1 text-white truncate">
                  {inv.description || "—"}
                </span>
                {inv.payment_link && (
                  <a
                    href={inv.payment_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--cyan)] hover:underline"
                  >
                    Link
                  </a>
                )}
                <span className="font-mono text-white font-semibold">
                  {fmtCents(inv.amount_cents)}
                </span>
                {inv.status === "draft" && (
                  <button
                    type="button"
                    onClick={() => sendInvoice(inv.id)}
                    disabled={sendingId === inv.id}
                    className="bg-gradient-to-r from-[var(--green)] to-[var(--cyan)] hover:shadow-[var(--shadow-glow-cyan)] disabled:opacity-40 text-white px-3 py-1 rounded-lg text-[10px] font-semibold transition-all"
                  >
                    {sendingId === inv.id ? "Sending…" : "Send"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-[var(--gray-dim)]">
        Created {timeAgo(job.created_at)}
        {job.proposal_sent_at && ` · Proposal sent ${timeAgo(job.proposal_sent_at)}`}
        {job.accepted_at && ` · Accepted ${timeAgo(job.accepted_at)}`}
        {job.intro_email_sent_at && ` · Intro emailed ${timeAgo(job.intro_email_sent_at)}`}
      </p>
    </div>
  );
}
