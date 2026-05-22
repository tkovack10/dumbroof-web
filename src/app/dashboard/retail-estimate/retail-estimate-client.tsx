"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { evaluateFormula } from "@/lib/retail/evaluator";
import type {
  RetailTemplate,
  RetailTemplateAddon,
} from "@/lib/retail/templates-types";

interface Measurements {
  roof_area_sq: number;
  eave_lf: number;
  rake_lf: number;
  ridge_lf: number;
  hip_lf: number;
  valley_lf: number;
  ridge_lf_vented: number;
  pipe_count_standard: number;
  step_flash_lf: number;
  counter_flash_lf: number;
}

const DEFAULT_MEASUREMENTS: Measurements = {
  roof_area_sq: 30,
  eave_lf: 120,
  rake_lf: 80,
  ridge_lf: 40,
  hip_lf: 0,
  valley_lf: 20,
  ridge_lf_vented: 40,
  pipe_count_standard: 3,
  step_flash_lf: 20,
  counter_flash_lf: 12,
};

const MEASUREMENT_LABELS: Record<keyof Measurements, string> = {
  roof_area_sq: "Roof area (SQ)",
  eave_lf: "Eave (LF)",
  rake_lf: "Rake (LF)",
  ridge_lf: "Ridge (LF)",
  hip_lf: "Hip (LF)",
  valley_lf: "Valley (LF)",
  ridge_lf_vented: "Ridge vented (LF)",
  pipe_count_standard: "Standard pipes (EA)",
  step_flash_lf: "Step flashing (LF)",
  counter_flash_lf: "Counter flashing (LF)",
};

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function RetailEstimateClient() {
  const router = useRouter();
  const [templates, setTemplates] = useState<RetailTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurements>(DEFAULT_MEASUREMENTS);
  const [addonQtys, setAddonQtys] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [loadedExisting, setLoadedExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentMarker, setSentMarker] = useState(false);
  const [signLinking, setSignLinking] = useState(false);
  const [signLink, setSignLink] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [markupPct, setMarkupPct] = useState(0);
  const [status, setStatus] = useState<string>("draft");
  const [importing, setImporting] = useState(false);
  const [importMeta, setImportMeta] = useState<{ vendor?: string; confidence?: string; filename?: string } | null>(null);
  const [invoicing, setInvoicing] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);

  useEffect(() => {
    // Detect ?id= in the URL to load an existing estimate into the builder.
    const params = new URLSearchParams(window.location.search);
    const existingId = params.get("id");

    async function init() {
      try {
        const [tplRes, estRes] = await Promise.all([
          fetch("/api/retail-templates").then((r) => r.json()),
          existingId
            ? fetch(`/api/retail-estimates/${existingId}`).then((r) => r.json())
            : Promise.resolve(null),
        ]);
        const tpls: RetailTemplate[] = tplRes.templates || [];
        setTemplates(tpls);

        if (estRes?.estimate) {
          const e = estRes.estimate as {
            id: string;
            template_id: string;
            customer_name: string | null;
            customer_address: string | null;
            customer_email: string | null;
            measurements: Partial<Measurements>;
            addon_qtys: Record<string, number>;
            status?: string;
          };
          setEstimateId(e.id);
          setSelectedId(e.template_id);
          setCustomerName(e.customer_name || "");
          setCustomerAddress(e.customer_address || "");
          setCustomerEmail(e.customer_email || "");
          setMeasurements((m) => ({ ...m, ...e.measurements }));
          setAddonQtys(e.addon_qtys || {});
          setMarkupPct(Number((e as unknown as { markup_pct?: number }).markup_pct ?? 0));
          setStatus(e.status || "draft");
          setLoadedExisting(true);
          if (e.status === "sent") setSentMarker(true);
        } else if (tpls[0]) {
          setSelectedId(tpls[0]._meta.template_id);
        }
      } catch {
        // non-fatal — just don't pre-populate
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const selected = useMemo(
    () => templates.find((t) => t._meta.template_id === selectedId) || null,
    [templates, selectedId],
  );

  const vars = useMemo(
    () => ({ ...measurements }) as unknown as Record<string, number>,
    [measurements],
  );

  const billingLine = useMemo(() => {
    if (!selected) return null;
    return selected.items.find((i) => i.is_billing_line) || null;
  }, [selected]);

  const baseTotal = useMemo(() => {
    if (!billingLine) return 0;
    const qty = evaluateFormula(billingLine.quantity_formula, vars);
    return qty * billingLine.unit_price;
  }, [billingLine, vars]);

  const selectedAddonRows = useMemo(() => {
    if (!selected) return [] as Array<{ addon: RetailTemplateAddon; qty: number; total: number }>;
    return selected.add_ons
      .map((a) => {
        const qty = addonQtys[a.code] ?? 0;
        return { addon: a, qty, total: qty * a.unit_price };
      })
      .filter((row) => row.qty > 0);
  }, [selected, addonQtys]);

  const addonsTotal = useMemo(
    () => selectedAddonRows.reduce((acc, r) => acc + r.total, 0),
    [selectedAddonRows],
  );

  const subtotal = baseTotal + addonsTotal;
  const markupAmount = (subtotal * markupPct) / 100;
  const grandTotal = subtotal + markupAmount;

  function updateMeasurement<K extends keyof Measurements>(key: K, value: number) {
    setMeasurements((m) => ({ ...m, [key]: value }));
  }

  async function handleImportMeasurements(file: File) {
    setImporting(true);
    setStatusMsg(null);
    setImportMeta(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/retail-measurements/parse", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg({ kind: "err", text: data.error || `Parser failed (${res.status})` });
        return;
      }
      const m = data.measurements || {};
      // Populate every field that came back (0 values still overwrite — user can edit)
      const next: Partial<Measurements> = {};
      for (const k of Object.keys(DEFAULT_MEASUREMENTS) as Array<keyof Measurements>) {
        const raw = m[k];
        if (raw !== undefined && raw !== null) {
          const v = typeof raw === "number" ? raw : parseFloat(String(raw));
          if (!Number.isNaN(v)) next[k] = v;
        }
      }
      setMeasurements((prev) => ({ ...prev, ...next }));
      const meta = m._meta || {};
      setImportMeta({
        vendor: meta.vendor || "unknown",
        confidence: meta.confidence || "unknown",
        filename: file.name,
      });
      const filled = Object.values(next).filter((v) => v && v > 0).length;
      const total = Object.keys(DEFAULT_MEASUREMENTS).length;
      setStatusMsg({
        kind: meta.confidence === "low" ? "err" : "ok",
        text: `Imported ${filled}/${total} fields from ${meta.vendor || "report"} (${meta.confidence || "?"} confidence). Review and edit before saving.`,
      });
    } catch (err) {
      setStatusMsg({ kind: "err", text: `Import failed: ${String(err)}` });
    } finally {
      setImporting(false);
    }
  }

  function updateAddonQty(code: string, qty: number) {
    setAddonQtys((prev) => ({ ...prev, [code]: Math.max(0, qty) }));
  }

  async function handleSendInvoice() {
    if (!customerEmail.trim()) {
      setStatusMsg({ kind: "err", text: "Customer email required to send the invoice" });
      return;
    }
    let idForInvoice = estimateId;
    if (!idForInvoice) {
      idForInvoice = await handleSave();
      if (!idForInvoice) return;
    } else {
      await handleSave();
    }
    if (!idForInvoice) return;

    if (!confirm(`Create a Stripe invoice for ${customerEmail} for ${fmtUsd(grandTotal)}?`)) return;
    setInvoicing(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/retail-estimates/${idForInvoice}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_email: customerEmail, send_email: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 400 with needs_connect: Stripe Connect not active
        if (data.needs_connect) {
          setStatusMsg({
            kind: "err",
            text: data.error || "Stripe Connect required — connect a payout account in Settings.",
          });
        } else {
          setStatusMsg({ kind: "err", text: data.error || `Invoice failed (${res.status})` });
        }
        return;
      }
      setPaymentLink(data.payment_link_url || null);
      setStatus("sent");
      setStatusMsg({
        kind: "ok",
        text: data.already_created
          ? `Invoice resent to ${customerEmail} (link already existed)`
          : `Invoice sent to ${customerEmail}`,
      });
    } catch (err) {
      setStatusMsg({ kind: "err", text: String(err) });
    } finally {
      setInvoicing(false);
    }
  }

  async function handleGetSignLink() {
    let idForSign = estimateId;
    if (!idForSign) {
      idForSign = await handleSave();
      if (!idForSign) return;
    }
    setSignLinking(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/retail-estimates/${idForSign}/sign-token`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg({ kind: "err", text: data.error || "Could not issue sign link" });
        return;
      }
      const url = data.url as string;
      setSignLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setStatusMsg({ kind: "ok", text: "Sign link copied to clipboard" });
      } catch {
        setStatusMsg({ kind: "ok", text: "Sign link ready (clipboard blocked — copy manually below)" });
      }
    } catch (err) {
      setStatusMsg({ kind: "err", text: String(err) });
    } finally {
      setSignLinking(false);
    }
  }

  async function handleSendEmail() {
    if (!customerEmail.trim()) {
      setStatusMsg({ kind: "err", text: "Customer email required to send" });
      return;
    }
    // Auto-save before sending so the email reflects the latest state.
    let idToSend = estimateId;
    if (!idToSend) {
      idToSend = await handleSave();
      if (!idToSend) return;
    } else {
      await handleSave();
    }
    if (!idToSend) return;

    if (!confirm(`Send estimate to ${customerEmail}?`)) return;
    setSending(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/retail-estimates/${idToSend}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_email: customerEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg({ kind: "err", text: data.error || "Send failed" });
        return;
      }
      setSentMarker(true);
      setStatus("sent");
      setStatusMsg({ kind: "ok", text: `Sent to ${customerEmail}` });
    } catch (err) {
      setStatusMsg({ kind: "err", text: String(err) });
    } finally {
      setSending(false);
    }
  }

  async function handleSave(): Promise<string | null> {
    if (!selected) return null;
    setSaving(true);
    setStatusMsg(null);
    try {
      const url = estimateId
        ? `/api/retail-estimates?id=${encodeURIComponent(estimateId)}`
        : "/api/retail-estimates";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selected._meta.template_id,
          template_snapshot: selected,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_address: customerAddress,
          measurements,
          addon_qtys: addonQtys,
          base_amount: baseTotal,
          addons_amount: addonsTotal,
          subtotal_amount: subtotal,
          markup_pct: markupPct,
          markup_amount: markupAmount,
          total_amount: grandTotal,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg({ kind: "err", text: data.error || "Save failed" });
        return null;
      }
      const newId = data.estimate?.id as string | undefined;
      if (newId) {
        setEstimateId(newId);
        // Update URL without reloading so the ?id= param sticks for refresh.
        if (!estimateId) {
          const next = new URL(window.location.href);
          next.searchParams.set("id", newId);
          router.replace(`${next.pathname}?${next.searchParams.toString()}`);
        }
      }
      setStatusMsg({ kind: "ok", text: estimateId ? "Estimate updated" : "Estimate saved" });
      return newId || null;
    } catch (err) {
      setStatusMsg({ kind: "err", text: String(err) });
      return null;
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-[var(--gray-muted)] text-sm">Loading retail templates…</div>;
  }

  if (templates.length === 0) {
    return (
      <div className="p-8">
        <p className="text-[var(--white)]">No retail templates found.</p>
        <p className="text-xs text-[var(--gray-muted)] mt-2">
          Add JSON files to <code>backend/pricing/retail_templates/</code> and redeploy.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--white)]">
            {loadedExisting ? "Edit Estimate" : "Retail Estimate Builder"}
          </h1>
          <p className="text-xs text-[var(--gray-muted)] mt-1">
            {loadedExisting
              ? `Editing saved estimate · changes don't auto-save — hit Update to commit`
              : `Cash jobs · $700/SQ all-in pricing · ${templates.length} manufacturer systems`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/retail-estimates"
            className="text-xs text-[var(--gray-muted)] hover:text-[var(--white)] px-3 py-2"
          >
            ← All Estimates
          </Link>
          <Link
            href="/dashboard"
            className="text-xs text-[var(--gray-muted)] hover:text-[var(--white)] px-3 py-2"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* Template Picker */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-bold text-[var(--white)] mb-3">Shingle Line</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {templates.map((t) => {
            const isSelected = t._meta.template_id === selectedId;
            return (
              <button
                key={t._meta.template_id}
                onClick={() => setSelectedId(t._meta.template_id)}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  isSelected
                    ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08]"
                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                  {t._meta.manufacturer}
                </p>
                <p className="text-sm font-semibold text-[var(--white)] mt-1">
                  {t._meta.product_line}
                </p>
                <p className="text-[10px] text-[var(--gray-dim)] mt-2 line-clamp-2">
                  {t._meta.impact_resistance ? `Class 4 IR · ` : ""}
                  {t._meta.algae_resistance || ""}
                  {t._meta.smog_reducing_granules ? ` · Smog-reducing` : ""}
                </p>
                <p className="text-xs text-[var(--cyan)] font-mono mt-2">
                  ${t._meta.base_price_per_sq_usd}/SQ
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {!selected ? null : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Customer + Measurements */}
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-card p-6">
              <h2 className="text-sm font-bold text-[var(--white)] mb-3">Customer</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[var(--gray-muted)] mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Homeowner name"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-white/10 text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:outline-none focus:border-[var(--cyan)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[var(--gray-muted)] mb-1">
                    Property Address
                  </label>
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="123 Main St, City, ST 12345"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-white/10 text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:outline-none focus:border-[var(--cyan)]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] uppercase tracking-wider text-[var(--gray-muted)] mb-1">
                    Customer Email{" "}
                    <span className="text-[var(--gray-dim)] normal-case tracking-normal">
                      — required to email the estimate
                    </span>
                  </label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="customer@example.com"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-white/10 text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:outline-none focus:border-[var(--cyan)]"
                  />
                </div>
              </div>
            </div>

            <div className="glass-card p-6">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h2 className="text-sm font-bold text-[var(--white)]">Measurements</h2>
                <label
                  className={`relative inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                    importing
                      ? "bg-white/[0.04] border-white/10 text-[var(--gray-dim)] cursor-wait"
                      : "bg-[var(--cyan)]/[0.10] border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/[0.18] hover:border-[var(--cyan)] text-[var(--cyan)]"
                  }`}
                >
                  {importing ? (
                    <>
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                      </svg>
                      Parsing PDF…
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Import Measurements (PDF)
                    </>
                  )}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={importing}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) handleImportMeasurements(f);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait"
                  />
                </label>
              </div>
              <p className="text-[10px] text-[var(--gray-muted)] mb-3">
                Upload an EagleView, HOVER, GAF QuickMeasure, or Roofr PDF — we&apos;ll auto-fill the 10 measurement fields below. Or enter manually.
              </p>
              {importMeta && (
                <div className="text-[10px] text-[var(--cyan)]/80 mb-3 px-3 py-2 rounded bg-[var(--cyan)]/[0.06] border border-[var(--cyan)]/20">
                  Imported from <strong>{importMeta.filename}</strong> — vendor: <strong>{importMeta.vendor}</strong> · confidence: <strong>{importMeta.confidence}</strong>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {(Object.keys(MEASUREMENT_LABELS) as Array<keyof Measurements>).map((key) => (
                  <div key={key}>
                    <label className="block text-[10px] uppercase tracking-wider text-[var(--gray-muted)] mb-1">
                      {MEASUREMENT_LABELS[key]}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={measurements[key]}
                      onChange={(e) => updateMeasurement(key, parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-white/10 text-[var(--white)] focus:outline-none focus:border-[var(--cyan)] font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Bundled items */}
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[var(--white)]">
                  Included in {fmtUsd(selected._meta.base_price_per_sq_usd)}/SQ
                </h2>
                <span className="text-[10px] text-[var(--gray-dim)]">Bundled — no extra charge</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                    <th className="px-2 py-2 font-semibold">Item</th>
                    <th className="px-2 py-2 font-semibold text-right">Qty</th>
                    <th className="px-2 py-2 font-semibold">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items
                    .filter((i) => i.bundled_in_base)
                    .map((i) => {
                      const qty = evaluateFormula(i.quantity_formula, vars);
                      return (
                        <tr key={i.code} className="border-t border-white/[0.04]">
                          <td className="px-2 py-2 text-[var(--white)]">{i.description}</td>
                          <td className="px-2 py-2 text-right font-mono text-[var(--gray)]">
                            {qty.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-2 py-2 text-[var(--gray-dim)]">{i.unit}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Add-ons */}
            <div className="glass-card p-6">
              <h2 className="text-sm font-bold text-[var(--white)] mb-3">Add-ons</h2>
              <p className="text-[10px] text-[var(--gray-muted)] mb-4">
                Items beyond the base scope. Enter quantity to include.
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                    <th className="px-2 py-2 font-semibold">Add-on</th>
                    <th className="px-2 py-2 font-semibold text-right">Unit Price</th>
                    <th className="px-2 py-2 font-semibold text-right">Qty</th>
                    <th className="px-2 py-2 font-semibold text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.add_ons.map((a) => {
                    const qty = addonQtys[a.code] ?? 0;
                    const subtotal = qty * a.unit_price;
                    return (
                      <tr key={a.code} className="border-t border-white/[0.04]" title={a.notes || ""}>
                        <td className="px-2 py-2">
                          <p className="text-[var(--white)]">{a.description}</p>
                          <p className="text-[10px] text-[var(--gray-dim)] mt-0.5">{a.notes}</p>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[var(--gray)]">
                          {fmtUsd(a.unit_price)}/{a.unit}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={qty}
                            onChange={(e) => updateAddonQty(a.code, parseFloat(e.target.value) || 0)}
                            className="w-20 px-2 py-1 text-xs rounded bg-white/[0.03] border border-white/10 text-[var(--white)] focus:outline-none focus:border-[var(--cyan)] font-mono text-right"
                          />
                        </td>
                        <td className={`px-2 py-2 text-right font-mono ${qty > 0 ? "text-[var(--cyan)]" : "text-[var(--gray-dim)]"}`}>
                          {subtotal > 0 ? fmtUsd(subtotal) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT: Live Total */}
          <div className="lg:col-span-1 space-y-4">
            <div className="glass-card p-6 sticky top-4">
              <h2 className="text-sm font-bold text-[var(--white)] mb-1">
                {selected._meta.product_line}
              </h2>
              <p className="text-[10px] text-[var(--gray-muted)] mb-4">
                {selected._meta.manufacturer} · {selected._meta.system_warranty.name}
              </p>

              <div className="space-y-2 mb-4 pb-4 border-b border-white/10">
                <div className="flex justify-between items-baseline text-xs">
                  <span className="text-[var(--gray-muted)]">
                    Base ({measurements.roof_area_sq} SQ × ${selected._meta.base_price_per_sq_usd})
                  </span>
                  <span className="font-mono text-[var(--white)]">{fmtUsd(baseTotal)}</span>
                </div>
                {selectedAddonRows.map((row) => (
                  <div key={row.addon.code} className="flex justify-between items-baseline text-xs">
                    <span className="text-[var(--gray-muted)] truncate" title={row.addon.description}>
                      + {row.addon.description.split("—")[0].trim()} ({row.qty} {row.addon.unit})
                    </span>
                    <span className="font-mono text-[var(--cyan)] whitespace-nowrap ml-2">
                      {fmtUsd(row.total)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mb-4 pb-4 border-b border-white/10">
                <div className="flex justify-between items-baseline text-xs mb-2">
                  <span className="text-[var(--gray-muted)]">Subtotal</span>
                  <span className="font-mono text-[var(--white)]">{fmtUsd(subtotal)}</span>
                </div>

                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                    {markupPct >= 0 ? "Markup" : "Discount"}
                  </label>
                  <span
                    className={`text-xs font-mono font-semibold ${
                      markupPct > 0
                        ? "text-amber-400"
                        : markupPct < 0
                          ? "text-red-400"
                          : "text-[var(--gray-muted)]"
                    }`}
                  >
                    {markupPct > 0 ? "+" : ""}
                    {markupPct.toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={-25}
                  max={25}
                  step={1}
                  value={markupPct}
                  onChange={(e) => setMarkupPct(Number(e.target.value))}
                  className="w-full accent-[var(--cyan)]"
                />
                <div className="flex justify-between text-[9px] text-[var(--gray-dim)] mt-0.5">
                  <span>-25%</span>
                  <button
                    type="button"
                    onClick={() => setMarkupPct(0)}
                    className="hover:text-[var(--white)] underline"
                  >
                    reset
                  </button>
                  <span>+25%</span>
                </div>
                {markupPct !== 0 && (
                  <div className="flex justify-between items-baseline text-xs mt-2">
                    <span className="text-[var(--gray-muted)]">
                      {markupPct > 0 ? "Markup amount" : "Discount amount"}
                    </span>
                    <span
                      className={`font-mono ${
                        markupPct > 0 ? "text-amber-400" : "text-red-400"
                      }`}
                    >
                      {markupPct > 0 ? "+" : ""}
                      {fmtUsd(markupAmount)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-baseline mb-4">
                <span className="text-sm font-bold text-[var(--white)]">Total</span>
                <span className="text-2xl font-bold text-[var(--cyan)] font-mono">
                  {fmtUsd(grandTotal)}
                </span>
              </div>

              <div className="mb-4 pb-4 border-b border-white/10">
                <label className="block text-[10px] uppercase tracking-wider text-[var(--gray-muted)] mb-2">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-white/[0.03] border border-white/10 text-[var(--white)] focus:outline-none focus:border-[var(--cyan)]"
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="accepted">Accepted</option>
                  <option value="declined">Declined</option>
                  <option value="expired">Expired</option>
                </select>
                <p className="text-[10px] text-[var(--gray-dim)] mt-1">
                  Auto-set to <strong>Sent</strong> when you email. Update on customer reply.
                </p>
              </div>

              {(customerName || customerAddress) && (
                <div className="text-xs text-[var(--gray)] mb-4 pb-4 border-b border-white/10">
                  {customerName && <p className="text-[var(--white)]">{customerName}</p>}
                  {customerAddress && (
                    <p className="text-[var(--gray-dim)] text-[10px]">{customerAddress}</p>
                  )}
                </div>
              )}

              {selected._meta.documents?.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)] mb-2">
                    Manufacturer Docs
                  </p>
                  <ul className="space-y-1">
                    {selected._meta.documents.map((d) => (
                      <li key={d.url}>
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[var(--cyan)] hover:text-white underline truncate block"
                          title={d.label}
                        >
                          ↗ {d.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected._meta.insurance_discount_note && (
                <p className="text-[10px] text-amber-300 bg-amber-500/[0.06] border border-amber-500/[0.15] rounded p-2 mb-2">
                  💡 {selected._meta.insurance_discount_note}
                </p>
              )}
              {selected._meta.environmental_note && (
                <p className="text-[10px] text-green-300 bg-green-500/[0.06] border border-green-500/[0.15] rounded p-2 mb-2">
                  🌱 {selected._meta.environmental_note}
                </p>
              )}

              <details className="mt-4">
                <summary className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)] cursor-pointer hover:text-[var(--white)]">
                  Warranty Disclosure
                </summary>
                <p className="text-[10px] text-[var(--gray-dim)] mt-2 leading-relaxed">
                  {selected.warranty_disclosure}
                </p>
              </details>

              <div className="mt-4 pt-4 border-t border-white/[0.04] space-y-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || sending}
                  className="w-full text-sm font-semibold px-4 py-3 rounded-lg bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving…" : estimateId ? "Update Estimate" : "Save Estimate"}
                </button>

                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={sending || saving || !customerEmail.trim()}
                  className="w-full text-sm font-semibold px-4 py-3 rounded-lg bg-[var(--cyan)]/[0.10] border border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/[0.18] hover:border-[var(--cyan)] text-[var(--cyan)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!customerEmail.trim() ? "Enter customer email above to enable" : ""}
                >
                  {sending
                    ? "Sending…"
                    : sentMarker
                      ? "Re-send to Customer"
                      : "Email to Customer"}
                </button>

                <button
                  type="button"
                  onClick={handleGetSignLink}
                  disabled={signLinking || saving || sending}
                  className="w-full text-sm font-semibold px-4 py-3 rounded-lg bg-purple-500/[0.10] border border-purple-500/40 hover:bg-purple-500/[0.18] hover:border-purple-500 text-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {signLinking ? "Issuing…" : signLink ? "Get New Sign Link" : "Get Signature Link"}
                </button>

                {signLink && (
                  <div className="text-[10px] bg-purple-500/[0.06] border border-purple-500/30 rounded-lg p-2">
                    <p className="text-purple-200 mb-1 font-semibold">Send this URL to the customer:</p>
                    <input
                      type="text"
                      readOnly
                      value={signLink}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="w-full px-2 py-1 text-[10px] rounded bg-black/40 border border-white/10 text-purple-100 font-mono"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSendInvoice}
                  disabled={invoicing || saving || sending || signLinking || !customerEmail.trim() || grandTotal <= 0}
                  className="w-full text-sm font-semibold px-4 py-3 rounded-lg bg-green-500/[0.10] border border-green-500/40 hover:bg-green-500/[0.18] hover:border-green-500 text-green-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={
                    !customerEmail.trim()
                      ? "Enter customer email above to enable"
                      : grandTotal <= 0
                        ? "Total must be greater than $0"
                        : "Creates a Stripe payment link on your company's connected account and emails it"
                  }
                >
                  {invoicing
                    ? "Creating invoice…"
                    : paymentLink
                      ? "Re-send Invoice"
                      : "Send Stripe Invoice"}
                </button>

                {paymentLink && (
                  <div className="text-[10px] bg-green-500/[0.06] border border-green-500/30 rounded-lg p-2">
                    <p className="text-green-200 mb-1 font-semibold">Payment link (also emailed to customer):</p>
                    <input
                      type="text"
                      readOnly
                      value={paymentLink}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="w-full px-2 py-1 text-[10px] rounded bg-black/40 border border-white/10 text-green-100 font-mono"
                    />
                  </div>
                )}

                {sentMarker && (
                  <p className="text-[10px] text-[var(--cyan)]/80 text-center">
                    Sent · status updated to <strong>Sent</strong>
                  </p>
                )}

                {statusMsg && (
                  <div
                    className={`text-[11px] px-3 py-2 rounded-lg border ${
                      statusMsg.kind === "ok"
                        ? "bg-green-500/[0.08] border-green-500/30 text-green-300"
                        : "bg-red-500/[0.08] border-red-500/30 text-red-300"
                    }`}
                  >
                    {statusMsg.text}
                  </div>
                )}
                <p className="text-[10px] text-[var(--gray-dim)] pt-1">
                  PDF estimate auto-attaches on email + invoice sends.
                  Stripe Connect must be active on the company account.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
