"use client";

import { useEffect, useState, useCallback } from "react";

interface PriceItem {
  description: string;
  qty?: number;
  unit?: string;
  unit_price: number;
  category?: string;
}

interface RetailSettings {
  price_list: PriceItem[];
  default_tax_rate: number;
  default_deposit_pct: number;
  default_terms: string;
  default_payment_schedule: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = ["roofing", "gutters", "siding", "labor", "misc"] as const;
type Category = (typeof CATEGORIES)[number];

export function RetailSettingsModal({ open, onClose }: Props) {
  const [data, setData] = useState<RetailSettings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"items" | "terms">("items");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  // QA Phase 4.5 patch: track in-flight unsaved edits so we don't silently
  // overwrite them on reopen, and warn the user on close-with-edits.
  const [isDirty, setIsDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/retail/settings");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.settings as RetailSettings);
      setCanEdit(!!json.can_edit);
      setIsDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // QA Phase 4.5 fix: don't clobber unsaved edits on reopen. If the user
    // already has dirty data (closed the modal without saving), keep it
    // and let them either save or explicitly discard.
    if (isDirty && data) {
      return;
    }
    load();
    setActiveTab("items");
    setCategoryFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = useCallback(() => {
    if (saving || seeding) return;
    if (isDirty) {
      if (!window.confirm("You have unsaved changes. Discard them?")) {
        return;
      }
      setIsDirty(false);
      // Force a refetch on next open
      setData(null);
    }
    onClose();
  }, [saving, seeding, isDirty, onClose]);

  const save = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/retail/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.settings as RetailSettings);
      setIsDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [data]);

  const seedDefaults = useCallback(async () => {
    const willOverwrite = (data?.price_list?.length ?? 0) > 0;
    const prompt = willOverwrite
      ? "Replace the current price list with the 21-item starter set? Your current list will be snapshotted as previous_price_list (one-step undo)."
      : "Seed your price list with 21 starter items?";
    if (!window.confirm(prompt)) {
      return;
    }
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/retail/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "seed_defaults",
          // Server requires force:true to overwrite a non-empty list.
          ...(willOverwrite ? { force: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.settings as RetailSettings);
      setIsDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seed failed");
    } finally {
      setSeeding(false);
    }
  }, [data]);

  const updateItem = useCallback(
    (i: number, patch: Partial<PriceItem>) => {
      setIsDirty(true);
      setData((prev) => {
        if (!prev) return prev;
        const next = [...prev.price_list];
        next[i] = { ...next[i], ...patch };
        return { ...prev, price_list: next };
      });
    },
    []
  );

  const removeItem = useCallback((i: number) => {
    setIsDirty(true);
    setData((prev) => {
      if (!prev) return prev;
      const next = prev.price_list.filter((_, idx) => idx !== i);
      return { ...prev, price_list: next };
    });
  }, []);

  const addItem = useCallback(() => {
    setIsDirty(true);
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        price_list: [
          ...prev.price_list,
          { description: "", unit: "EA", unit_price: 0, category: "misc" },
        ],
      };
    });
  }, []);

  if (!open) return null;

  const items = data?.price_list ?? [];
  const filteredIndexes = items
    .map((_, i) => i)
    .filter(
      (i) =>
        categoryFilter === "all" ||
        (items[i].category ?? "misc") === categoryFilter
    );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={handleClose}
    >
      <div
        className="w-full sm:max-w-3xl bg-[rgb(15,18,35)] sm:rounded-2xl rounded-t-2xl border border-[var(--border-glass)] max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[var(--border-glass)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Retail prices &amp; terms</h2>
            <p className="text-xs text-[var(--gray-muted)] mt-0.5">
              Richard uses this list when you say{" "}
              <em>&quot;make a retail estimate&quot;</em> without specifying line items.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="text-[var(--gray-muted)] hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-[var(--border-glass)]">
          {(["items", "terms"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t
                  ? "border-[var(--cyan)] text-white"
                  : "border-transparent text-[var(--gray-muted)] hover:text-white"
              }`}
            >
              {t === "items" ? `Price list (${items.length})` : "Terms & defaults"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
              {error}
            </div>
          )}
          {!canEdit && !loading && (
            <div className="rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-4 py-3 text-sm text-[var(--amber)] mb-4">
              Read-only — only company admins can edit retail prices.
            </div>
          )}

          {loading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-white/[0.03] rounded animate-shimmer" />
              ))}
            </div>
          ) : activeTab === "items" ? (
            <div className="space-y-3">
              {/* Category filter + seed button */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-1 flex-wrap">
                  {(["all", ...CATEGORIES] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategoryFilter(c as Category | "all")}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border uppercase tracking-wide transition-colors ${
                        categoryFilter === c
                          ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08] text-white"
                          : "border-[var(--border-glass)] bg-white/[0.02] text-[var(--gray)] hover:bg-white/[0.04]"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {items.length === 0 && canEdit && (
                  <button
                    type="button"
                    onClick={seedDefaults}
                    disabled={seeding}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[var(--cyan)]/50 text-[var(--cyan)] hover:bg-[var(--cyan)]/10 font-semibold transition-colors"
                  >
                    {seeding ? "Seeding…" : "Seed 21-item starter set"}
                  </button>
                )}
              </div>

              {/* Items table */}
              <div className="rounded-xl border border-[var(--border-glass)] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/[0.02] text-left">
                      <th className="px-3 py-2 text-[var(--gray-muted)] font-medium">Description</th>
                      <th className="px-3 py-2 text-[var(--gray-muted)] font-medium w-20">Unit</th>
                      <th className="px-3 py-2 text-[var(--gray-muted)] font-medium w-24 text-right">$ / unit</th>
                      <th className="px-3 py-2 text-[var(--gray-muted)] font-medium w-28">Category</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIndexes.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-[var(--gray-dim)]">
                          {items.length === 0
                            ? "Empty price list. Add items or click 'Seed starter set'."
                            : "No items in this category."}
                        </td>
                      </tr>
                    ) : (
                      filteredIndexes.map((i) => {
                        const it = items[i];
                        return (
                          <tr key={i} className="border-t border-[var(--border-glass)]">
                            <td className="px-3 py-1.5">
                              <input
                                type="text"
                                value={it.description}
                                onChange={(e) => updateItem(i, { description: e.target.value })}
                                disabled={!canEdit}
                                className="w-full bg-transparent text-white text-xs focus:outline-none disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                type="text"
                                value={it.unit ?? ""}
                                onChange={(e) => updateItem(i, { unit: e.target.value.toUpperCase() })}
                                disabled={!canEdit}
                                className="w-full bg-transparent text-white text-xs font-mono focus:outline-none disabled:opacity-60"
                                placeholder="EA"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={it.unit_price}
                                onChange={(e) => updateItem(i, { unit_price: parseFloat(e.target.value) || 0 })}
                                disabled={!canEdit}
                                className="w-20 bg-transparent text-white text-xs font-mono text-right focus:outline-none disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <select
                                value={it.category ?? "misc"}
                                onChange={(e) => updateItem(i, { category: e.target.value })}
                                disabled={!canEdit}
                                className="w-full bg-transparent text-white text-xs focus:outline-none disabled:opacity-60"
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c} className="bg-[rgb(15,18,35)]">
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => removeItem(i)}
                                  className="text-[var(--gray-muted)] hover:text-[var(--red-accent)]"
                                  aria-label="Remove"
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {canEdit && (
                <button
                  type="button"
                  onClick={addItem}
                  className="w-full text-xs text-[var(--cyan)] hover:text-white py-2 border border-dashed border-[var(--border-glass)] rounded-lg transition-colors"
                >
                  + Add item
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                    Default tax rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="50"
                    value={(data.default_tax_rate * 100).toFixed(2)}
                    onChange={(e) => {
                      setIsDirty(true);
                      setData((prev) =>
                        prev
                          ? { ...prev, default_tax_rate: (parseFloat(e.target.value) || 0) / 100 }
                          : prev
                      );
                    }}
                    disabled={!canEdit}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)] disabled:opacity-60"
                  />
                  <p className="text-[10px] text-[var(--gray-dim)] mt-1">
                    Applied to every retail estimate (e.g. 8 for 8% NY sales tax).
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                    Default deposit (%)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={data.default_deposit_pct}
                    onChange={(e) => {
                      setIsDirty(true);
                      setData((prev) =>
                        prev
                          ? { ...prev, default_deposit_pct: parseFloat(e.target.value) || 0 }
                          : prev
                      );
                    }}
                    disabled={!canEdit}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)] disabled:opacity-60"
                  />
                  <p className="text-[10px] text-[var(--gray-dim)] mt-1">
                    e.g. 25 for 25% down at signing.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                  Default terms
                </label>
                <textarea
                  value={data.default_terms}
                  onChange={(e) => {
                    setIsDirty(true);
                    setData((prev) => (prev ? { ...prev, default_terms: e.target.value } : prev));
                  }}
                  disabled={!canEdit}
                  rows={4}
                  placeholder="e.g. Estimate valid 30 days. Workmanship warranty 5 years on labor. Materials carry mfr warranty."
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                  Default payment schedule
                </label>
                <textarea
                  value={data.default_payment_schedule}
                  onChange={(e) => {
                    setIsDirty(true);
                    setData((prev) => (prev ? { ...prev, default_payment_schedule: e.target.value } : prev));
                  }}
                  disabled={!canEdit}
                  rows={3}
                  placeholder="e.g. 25% deposit at signing, 50% on material delivery, 25% on completion."
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)] disabled:opacity-60"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[var(--border-glass)] flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm text-[var(--gray)] hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            {isDirty ? "Discard" : "Close"}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="bg-gradient-to-r from-[var(--green)] to-[var(--cyan)] hover:shadow-[var(--shadow-glow-cyan)] disabled:opacity-40 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
