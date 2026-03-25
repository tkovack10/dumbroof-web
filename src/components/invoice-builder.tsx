"use client";

import { useState, useEffect, useCallback } from "react";
import type { Invoice } from "@/types/invoice";

interface Props {
  claimId: string;
  claimAddress: string;
  carrierName: string;
  userId: string;
}

const INVOICE_TYPES = [
  { value: "carrier_supplement", label: "Carrier Supplement", desc: "Full scope sent to insurance carrier" },
  { value: "homeowner_deductible", label: "Homeowner Deductible", desc: "Deductible amount owed by homeowner" },
  { value: "homeowner_balance", label: "Homeowner Balance", desc: "Balance after insurance payment" },
  { value: "custom", label: "Custom", desc: "Fully editable invoice" },
] as const;

export function InvoiceBuilder({ claimId, claimAddress, carrierName, userId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [creating, setCreating] = useState(false);
  const [invoiceType, setInvoiceType] = useState<string>("carrier_supplement");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [sendEmail, setSendEmail] = useState("");

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices?claim_id=${claimId}`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [claimId]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const createInvoice = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          invoice_type: invoiceType,
          recipient_email: recipientEmail || null,
          notes: notes || null,
        }),
      });

      if (res.ok) {
        await fetchInvoices();
        setNotes("");
        setRecipientEmail("");
      }
    } catch { /* ignore */ }
    setCreating(false);
  };

  const markStatus = async (invoiceId: string, status: "sent" | "paid") => {
    setSending(invoiceId);
    try {
      const body: Record<string, unknown> = { id: invoiceId, status };
      if (status === "sent" && sendEmail) {
        body.recipient_email = sendEmail;
      }
      const res = await fetch("/api/invoices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await fetchInvoices();
        setSendEmail("");
      }
    } catch { /* ignore */ }
    setSending(null);
  };

  if (loading) return null;

  const latestInvoice = invoices[0];
  const hasInvoice = invoices.length > 0;

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-[var(--white)]">Invoicing</h3>
            <p className="text-xs text-[var(--gray-muted)]">
              Generate and send invoices to carrier or homeowner
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {latestInvoice && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
              latestInvoice.status === "paid"
                ? "bg-green-500/10 text-green-400"
                : latestInvoice.status === "sent"
                ? "bg-blue-500/10 text-blue-400"
                : "bg-white/5 text-[var(--gray-muted)]"
            }`}>
              {latestInvoice.status === "paid" ? "Paid" : latestInvoice.status === "sent" ? "Sent" : "Draft"}
              {latestInvoice.amount_due > 0 && ` — $${latestInvoice.amount_due.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            </span>
          )}
          <svg className={`w-5 h-5 text-[var(--gray-muted)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-white/[0.06]">
          {/* Create new invoice */}
          {!hasInvoice && (
            <div className="mt-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)]">Create Invoice</p>

              {/* Type selector */}
              <div className="grid sm:grid-cols-2 gap-2">
                {INVOICE_TYPES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setInvoiceType(type.value)}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      invoiceType === type.value
                        ? "border-green-500/30 bg-green-500/[0.06]"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                  >
                    <p className={`text-sm font-semibold ${invoiceType === type.value ? "text-green-400" : "text-[var(--white)]"}`}>
                      {type.label}
                    </p>
                    <p className="text-[10px] text-[var(--gray-muted)] mt-0.5">{type.desc}</p>
                  </button>
                ))}
              </div>

              {/* Recipient + notes */}
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  placeholder="Recipient email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
                <input
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
              </div>

              <button
                onClick={createInvoice}
                disabled={creating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-green-500/20 transition-all disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Invoice"}
              </button>
            </div>
          )}

          {/* Existing invoices */}
          {invoices.map((inv) => (
            <div key={inv.id} className="mt-4 rounded-xl bg-white/[0.03] border border-white/10 p-5">
              {/* Invoice header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-bold text-[var(--white)]">{inv.invoice_number}</p>
                  <p className="text-[10px] text-[var(--gray-dim)]">
                    {INVOICE_TYPES.find((t) => t.value === inv.invoice_type)?.label || inv.invoice_type}
                    {inv.due_date && ` · Due ${new Date(inv.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                  </p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                  inv.status === "paid" ? "bg-green-500/10 text-green-400"
                    : inv.status === "sent" ? "bg-blue-500/10 text-blue-400"
                    : inv.status === "overdue" ? "bg-red-500/10 text-red-400"
                    : "bg-white/5 text-[var(--gray-muted)]"
                }`}>
                  {inv.status.toUpperCase()}
                </span>
              </div>

              {/* Line items */}
              <div className="mb-4 max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="pb-2 text-left text-[var(--gray-muted)] font-medium">Description</th>
                      <th className="pb-2 text-right text-[var(--gray-muted)] font-medium w-16">Qty</th>
                      <th className="pb-2 text-right text-[var(--gray-muted)] font-medium w-20">Price</th>
                      <th className="pb-2 text-right text-[var(--gray-muted)] font-medium w-20">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inv.line_items || []).map((li, i) => (
                      <tr key={i} className="border-b border-white/[0.03]">
                        <td className="py-1.5 text-[var(--gray)]">{li.description}</td>
                        <td className="py-1.5 text-right text-[var(--gray-muted)]">{li.qty} {li.unit}</td>
                        <td className="py-1.5 text-right text-[var(--gray-muted)]">${li.unit_price.toFixed(2)}</td>
                        <td className="py-1.5 text-right text-[var(--white)] font-medium">${li.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial summary */}
              <div className="space-y-1 mb-4 border-t border-white/[0.06] pt-3">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--gray-muted)]">Subtotal</span>
                  <span className="text-[var(--gray)]">${inv.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {inv.tax > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--gray-muted)]">Tax</span>
                    <span className="text-[var(--gray)]">${inv.tax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {inv.o_and_p > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--gray-muted)]">O&amp;P (21%)</span>
                    <span className="text-[var(--gray)]">${inv.o_and_p.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs font-semibold border-t border-white/[0.06] pt-1">
                  <span className="text-[var(--white)]">Total</span>
                  <span className="text-[var(--white)]">${inv.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {inv.deductible_applied > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--gray-muted)]">Less: Deductible</span>
                    <span className="text-red-400">-${inv.deductible_applied.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold pt-1">
                  <span className="text-green-400">Amount Due</span>
                  <span className="text-green-400">${inv.amount_due.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* Actions */}
              {inv.status === "draft" && (
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <input
                      placeholder="Recipient email"
                      value={sendEmail}
                      onChange={(e) => setSendEmail(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                    />
                    <button
                      onClick={() => markStatus(inv.id, "sent")}
                      disabled={!sendEmail || sending === inv.id}
                      className="px-4 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm font-semibold hover:bg-green-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {sending === inv.id ? "Sending..." : "Send Invoice"}
                    </button>
                  </div>
                </div>
              )}

              {inv.status === "sent" && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-[var(--gray-dim)]">
                    Sent {inv.sent_at ? new Date(inv.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                    {inv.recipient_email && ` to ${inv.recipient_email}`}
                  </p>
                  <button
                    onClick={() => markStatus(inv.id, "paid")}
                    disabled={sending === inv.id}
                    className="px-4 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm font-semibold hover:bg-green-500/20 transition-colors disabled:opacity-30"
                  >
                    {sending === inv.id ? "..." : "Mark as Paid"}
                  </button>
                </div>
              )}

              {inv.status === "paid" && (
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-green-400 font-semibold">
                    Paid {inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                  </p>
                </div>
              )}
            </div>
          ))}

          {/* Create another if one exists */}
          {hasInvoice && (
            <button
              onClick={() => {
                setInvoices([]);
                setLoading(false);
              }}
              className="mt-4 text-xs text-[var(--gray-muted)] hover:text-[var(--white)] transition-colors"
            >
              + Create another invoice
            </button>
          )}
        </div>
      )}
    </div>
  );
}
