"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  const [templates, setTemplates] = useState<RetailTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurements>(DEFAULT_MEASUREMENTS);
  const [addonQtys, setAddonQtys] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/retail-templates")
      .then((r) => r.json())
      .then((d) => {
        setTemplates(d.templates || []);
        if (d.templates?.[0]) setSelectedId(d.templates[0]._meta.template_id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
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

  const grandTotal = baseTotal + addonsTotal;

  function updateMeasurement<K extends keyof Measurements>(key: K, value: number) {
    setMeasurements((m) => ({ ...m, [key]: value }));
  }

  function updateAddonQty(code: string, qty: number) {
    setAddonQtys((prev) => ({ ...prev, [code]: Math.max(0, qty) }));
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
          <h1 className="text-2xl font-bold text-[var(--white)]">Retail Estimate Builder</h1>
          <p className="text-xs text-[var(--gray-muted)] mt-1">
            Cash jobs · $700/SQ all-in pricing · {templates.length} manufacturer systems · read-only preview
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-xs text-[var(--gray-muted)] hover:text-[var(--white)] px-3 py-2"
        >
          ← Back to Dashboard
        </Link>
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
              </div>
            </div>

            <div className="glass-card p-6">
              <h2 className="text-sm font-bold text-[var(--white)] mb-3">Measurements</h2>
              <p className="text-[10px] text-[var(--gray-muted)] mb-4">
                Enter roof measurements manually. (Auto-import + Save coming in next phases.)
              </p>
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

              <div className="flex justify-between items-baseline mb-4">
                <span className="text-sm font-bold text-[var(--white)]">Total</span>
                <span className="text-2xl font-bold text-[var(--cyan)] font-mono">
                  {fmtUsd(grandTotal)}
                </span>
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

              <p className="text-[10px] text-[var(--gray-dim)] mt-4 pt-4 border-t border-white/[0.04]">
                Read-only preview. Save / Email / Print buttons ship in the next phase.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
