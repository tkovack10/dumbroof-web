"use client";

import { useMemo, useState } from "react";
import type { V2Slots } from "../types";

interface Props {
  slots: V2Slots;
  claimId: string;
  manualScopeLocked: boolean;
  currentTrades: string[];
}

const TRADE_KEYS = ["roofing", "siding", "gutters"] as const;
type TradeKey = (typeof TRADE_KEYS)[number];

function normalizeTrades(raw: string[]): Set<TradeKey> {
  const out = new Set<TradeKey>();
  for (const t of raw) {
    const lower = t.toLowerCase().trim();
    for (const k of TRADE_KEYS) {
      if (lower.includes(k)) out.add(k);
    }
  }
  return out;
}

/**
 * Scope tab — Tom's Financial-first ask is enforced inside the
 * ScopeComparison component itself (Phase 1 ship: cyan-active Financial tab
 * is the default). Below it: Supplement Composer, Estimate (read-only browse),
 * Refine Line Items (collapsible editable mode — Phase 3c-2), then config.
 *
 * Order is the workflow loop: see the variance → build the supplement →
 * browse line items → edit them inline → configure roof/gutters/siding.
 *
 * The "Refine line items" panel is collapsed by default — opening it would
 * blow up the tab height (528 LOC of editable UI). Tom asked for the editor
 * to live INSIDE the per-claim page (no /scope-review navigation), so the
 * collapsible reveal is the MVP UX. Standalone route still works for direct
 * links.
 */
export function ScopeTab({ slots, claimId, manualScopeLocked, currentTrades }: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const initialTrades = useMemo(() => normalizeTrades(currentTrades || []), [currentTrades]);

  return (
    <div className="space-y-4">
      <TradeScopeToggle
        claimId={claimId}
        initial={initialTrades}
        disabled={manualScopeLocked}
      />

      {slots.scopeComparison || (slots.lockedScopeComparison && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
          {slots.lockedScopeComparison}
        </section>
      ))}

      {slots.supplementComposer && (
        <section>{slots.supplementComposer}</section>
      )}

      {slots.estimateView || (slots.lockedEstimate && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
          {slots.lockedEstimate}
        </section>
      ))}

      {slots.estimateEditor && (
        <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl overflow-hidden">
          <div className="w-full flex items-center justify-between px-5 py-4">
            <button
              onClick={() => setEditorOpen((v) => !v)}
              className="flex-1 flex items-center justify-between text-left hover:opacity-90 transition-opacity"
              aria-expanded={editorOpen}
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white">Refine line items</p>
                  {manualScopeLocked && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--cyan)]/15 text-[var(--cyan)] border border-[var(--cyan)]/30"
                      title="You uploaded your own estimate — reprocesses will not overwrite these line items or prices."
                    >
                      Locked by you
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                  {manualScopeLocked
                    ? "Your uploaded estimate is locked. Re-upload below to replace it."
                    : "Approve, edit, remove, or add line items without leaving the claim."}
                </p>
              </div>
              <svg
                className={`w-4 h-4 text-[var(--gray-muted)] transition-transform ml-3 ${editorOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="ml-3 shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-r from-[var(--pink)]/20 to-[var(--blue)]/20 hover:from-[var(--pink)]/30 hover:to-[var(--blue)]/30 text-[var(--white)] border border-[var(--border-glass)] transition-colors"
              title="Upload your own Xactimate estimate — line items and prices won't be overwritten by reprocesses."
            >
              {manualScopeLocked ? "Re-upload estimate" : "Upload my own estimate"}
            </button>
          </div>
          {editorOpen && (
            <div className="px-4 sm:px-5 pb-5 border-t border-white/[0.08]">
              {slots.estimateEditor}
            </div>
          )}
        </section>
      )}

      {slots.estimateConfig && (
        <section>{slots.estimateConfig}</section>
      )}

      {uploadOpen && (
        <UploadEstimateModal
          claimId={claimId}
          onClose={() => setUploadOpen(false)}
          onSaved={() => {
            // Hard reload — the manual_scope_locked badge + new line items
            // come from /api/team-claims which is fetched at page mount.
            // Cheaper than threading a refetch callback through 6 layers.
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * Phase 1 MVP — JSON paste only. Users paste an array of line items, we
 * sanitize on the API side, set manual_scope_locked=true, kick a reprocess.
 * PDF / Excel parsing is Phase 2 once we see what formats people actually
 * have on hand.
 */
function UploadEstimateModal({
  claimId,
  onClose,
  onSaved,
}: {
  claimId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeholder = `[
  {
    "description": "Tear off composition shingles - 3 tab",
    "qty": 25.5,
    "unit": "SQ",
    "unit_price": 65.00,
    "category": "ROOFING",
    "trade": "roofing",
    "xactimate_code": "RFG 220"
  },
  {
    "description": "R&R 30 lb. organic felt",
    "qty": 25.5,
    "unit": "SQ",
    "unit_price": 38.00,
    "category": "ROOFING",
    "trade": "roofing"
  }
]`;

  const save = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      setError(e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON");
      return;
    }
    if (!Array.isArray(parsed)) {
      setError("Top level must be a JSON array of line items.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/claim/upload-estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim_id: claimId, line_items: parsed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4"
        style={{ maxHeight: "90vh" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Upload your own estimate</h2>
            <p className="text-xs text-[var(--gray-muted)] mt-1 max-w-md">
              Paste a JSON array of your Xactimate (or similar) line items.
              Future reprocesses will <strong>preserve</strong> these exact
              prices — the platform will not overwrite them.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--gray-dim)] hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="flex-1 min-h-[280px] rounded-lg border px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
          style={{
            backgroundColor: "rgb(28, 32, 56)",
            color: "#ffffff",
            borderColor: "rgba(255,255,255,0.18)",
          }}
        />

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-[var(--gray-dim)]">
          <span>
            Required per item: <code className="text-[var(--gray)]">description</code>,{" "}
            <code className="text-[var(--gray)]">qty</code>,{" "}
            <code className="text-[var(--gray)]">unit_price</code>.
          </span>
          <span>Max 500 items.</span>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm font-semibold px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[var(--gray)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !json.trim()}
            className="text-sm font-semibold px-5 py-2 rounded-xl bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & lock"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Trade-scope toggle — picks which trades the rebuilder emits. Drops items
 * for unchecked trades, re-seeds defaults for newly-checked ones, then kicks
 * a reprocess. Disabled when the scope is locked by an uploaded estimate
 * (manual_scope_locked) because the rebuilder is bypassed in that mode.
 *
 * Backs the Tom 2026-05-14 ask after 69 Theron: "removing all roofing items +
 * reprocess" couldn't make a claim siding-only because the rebuilder always
 * re-seeded roofing. Now the rebuilder honors estimate_request and this
 * toggle is the single UI surface for changing that.
 */
function TradeScopeToggle({
  claimId,
  initial,
  disabled,
}: {
  claimId: string;
  initial: Set<TradeKey>;
  disabled: boolean;
}) {
  // Default to roofing-only if claim has no detected trades yet (fresh claim).
  const seeded = initial.size === 0 ? new Set<TradeKey>(["roofing"]) : initial;
  const [trades, setTrades] = useState<Set<TradeKey>>(seeded);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const toggle = (k: TradeKey) => {
    setTrades((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (trades.size === 0) {
      setErr("Pick at least one trade.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/claim/set-trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim_id: claimId, trades: [...trades] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      // Hard reload — the new scope + reprocessing banner come from
      // /api/team-claims fetched at page mount.
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  };

  const LABELS: Record<TradeKey, string> = {
    roofing: "Roofing",
    siding: "Siding",
    gutters: "Gutters",
  };

  return (
    <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-white">Trade scope</p>
          <p className="text-xs text-[var(--gray-muted)] mt-0.5">
            {disabled
              ? "Locked by uploaded estimate. Re-upload or unlock to change trades."
              : "Which trades should the rebuild include? Unchecking a trade drops its items on the next reprocess."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {TRADE_KEYS.map((k) => {
            const on = trades.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k)}
                disabled={disabled || saving}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  on
                    ? "bg-[var(--cyan)]/15 text-[var(--cyan)] border-[var(--cyan)]/40"
                    : "bg-white/[0.04] text-[var(--gray)] border-white/[0.1] hover:bg-white/[0.08]"
                }`}
              >
                {on ? "✓ " : ""}
                {LABELS[k]}
              </button>
            );
          })}
        </div>
      </div>

      {err && (
        <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {err}
        </div>
      )}

      {dirty && !disabled && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setTrades(new Set(seeded));
              setDirty(false);
              setErr(null);
            }}
            disabled={saving}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.08] text-[var(--gray)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || trades.size === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white disabled:opacity-50"
            title="Updates estimate_request and reprocesses the claim."
          >
            {saving ? "Saving & reprocessing…" : "Save & reprocess"}
          </button>
        </div>
      )}
    </section>
  );
}
