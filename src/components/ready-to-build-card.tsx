"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type FlagStatus = "ok" | "over_minor" | "over_major" | "partial" | "not_paid";

interface ValidationRow {
  trade: string;
  scope_qty: number;
  eagleview_qty: number | null;
  requested_qty: number;
  unit: string;
  status: FlagStatus;
  message: string;
}

interface ClaimSelections {
  roof_manufacturer?: string | null;
  roof_product?: string | null;
  roof_color?: string | null;
  drip_edge_color?: string | null;
  flashing_color?: string | null;
  gutter_color?: string | null;
  siding_manufacturer?: string | null;
  siding_product?: string | null;
  siding_color?: string | null;
  skylights_keep?: boolean | null;
  gate_code?: string | null;
  pets?: string | null;
  driveway_access?: string | null;
  site_notes?: string | null;
}

interface RequestedQty {
  qty: number;
  unit: string;
  full: boolean;
}

const TRADES: Array<{ key: string; label: string; defaultUnit: string }> = [
  { key: "roof",       label: "Roof",       defaultUnit: "SQ" },
  { key: "gutters",    label: "Gutters",    defaultUnit: "LF" },
  { key: "downspouts", label: "Downspouts", defaultUnit: "LF" },
  { key: "siding",     label: "Siding",     defaultUnit: "SQ" },
  { key: "flashing",   label: "Flashing",   defaultUnit: "LF" },
  { key: "skylights",  label: "Skylights",  defaultUnit: "EA" },
];

const STATUS_STYLES: Record<FlagStatus, { bg: string; text: string; dot: string; label: string }> = {
  ok:         { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-300", dot: "bg-emerald-400", label: "OK" },
  over_minor: { bg: "bg-amber-500/10 border-amber-500/30",     text: "text-amber-300",   dot: "bg-amber-400",   label: "Minor overage" },
  over_major: { bg: "bg-red-500/10 border-red-500/30",         text: "text-red-300",     dot: "bg-red-500",     label: "Major overage" },
  partial:    { bg: "bg-blue-500/10 border-blue-500/30",       text: "text-blue-300",    dot: "bg-blue-400",    label: "Partial scope" },
  not_paid:   { bg: "bg-red-500/10 border-red-500/30",         text: "text-red-300",     dot: "bg-red-500",     label: "Not paid" },
};

export function ReadyToBuildCard({
  claimId,
  claimOutcome,
  hasForensicWin,
}: {
  claimId: string;
  claimOutcome: string | null;
  hasForensicWin: boolean;
}) {
  const supabase = createClient();
  const [selections, setSelections] = useState<ClaimSelections>({});
  const [requested, setRequested] = useState<Record<string, RequestedQty>>({});
  const [validation, setValidation] = useState<ValidationRow[] | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [hasBlocker, setHasBlocker] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlocked = claimOutcome === "won" || hasForensicWin;

  const fetchSelections = useCallback(async () => {
    const { data } = await supabase
      .from("claim_selections")
      .select("*")
      .eq("claim_id", claimId)
      .maybeSingle();
    if (data) setSelections(data as ClaimSelections);
  }, [claimId, supabase]);

  useEffect(() => {
    if (unlocked) fetchSelections();
  }, [unlocked, fetchSelections]);

  const patch = (field: keyof ClaimSelections, value: string | boolean | null) =>
    setSelections((prev) => ({ ...prev, [field]: value }));

  const saveSelections = async () => {
    setSaving(true);
    try {
      await supabase
        .from("claim_selections")
        .upsert(
          {
            claim_id: claimId,
            ...selections,
            selected_at: new Date().toISOString(),
            selected_by: "rep_manual",
          },
          { onConflict: "claim_id" }
        );
    } catch (e) {
      console.warn("[ready-to-build] save failed", e);
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    setError(null);
    setValidating(true);
    try {
      const res = await fetch(`/api/production/validate/${claimId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requested }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Validation failed");
        return;
      }
      setValidation(data.validation || []);
      setSummary(data.summary || "");
      setHasBlocker(!!data.has_blocker);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setValidating(false);
    }
  };

  if (!unlocked) {
    return (
      <div className="glass-card p-6 opacity-70">
        <h2 className="text-base font-bold text-[var(--white)] mb-1">Ready to Build</h2>
        <p className="text-sm text-[var(--gray-muted)]">
          Unlocks when the claim is approved (first scope received or claim marked won).
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-base font-bold text-[var(--white)]">Ready to Build → Send to Production</h2>
          <p className="text-xs text-[var(--gray-muted)] mt-1">
            Pick colors, set quantities, validate against approved scope, then generate the production packet.
          </p>
        </div>
      </div>

      {/* Color / selection form */}
      <div className="mb-6">
        <p className="text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wide mb-3">
          Homeowner selections
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <LabeledInput label="Roof manufacturer" value={selections.roof_manufacturer || ""} onChange={(v) => patch("roof_manufacturer", v)} placeholder="GAF / OC / Atlas…" />
          <LabeledInput label="Roof product" value={selections.roof_product || ""} onChange={(v) => patch("roof_product", v)} placeholder="Timberline HDZ" />
          <LabeledInput label="Roof color" value={selections.roof_color || ""} onChange={(v) => patch("roof_color", v)} placeholder="Charcoal" />
          <LabeledInput label="Drip edge color" value={selections.drip_edge_color || ""} onChange={(v) => patch("drip_edge_color", v)} placeholder="Brown" />
          <LabeledInput label="Flashing color" value={selections.flashing_color || ""} onChange={(v) => patch("flashing_color", v)} placeholder="Brown" />
          <LabeledInput label="Gutter color" value={selections.gutter_color || ""} onChange={(v) => patch("gutter_color", v)} placeholder="White" />
          <LabeledInput label="Siding manufacturer" value={selections.siding_manufacturer || ""} onChange={(v) => patch("siding_manufacturer", v)} placeholder="James Hardie" />
          <LabeledInput label="Siding product" value={selections.siding_product || ""} onChange={(v) => patch("siding_product", v)} placeholder="HardiePlank Select" />
          <LabeledInput label="Siding color" value={selections.siding_color || ""} onChange={(v) => patch("siding_color", v)} placeholder="Arctic White" />
        </div>
        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[var(--gray)]">
            <input
              type="checkbox"
              checked={!!selections.skylights_keep}
              onChange={(e) => patch("skylights_keep", e.target.checked)}
              className="rounded"
            />
            Keep existing skylights
          </label>
          <button
            onClick={saveSelections}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--gray)] hover:text-[var(--white)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save selections"}
          </button>
        </div>
      </div>

      {/* Quantity form */}
      <div className="mb-5 pt-5 border-t border-[var(--border-glass)]">
        <p className="text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wide mb-3">
          Production quantities
        </p>
        <div className="space-y-2">
          {TRADES.map((t) => {
            const req = requested[t.key] || { qty: 0, unit: t.defaultUnit, full: false };
            return (
              <div key={t.key} className="grid grid-cols-[100px_1fr_80px_auto] gap-2 items-center">
                <span className="text-xs font-medium text-[var(--gray)]">{t.label}</span>
                <input
                  type="number"
                  step="0.1"
                  value={req.qty}
                  onChange={(e) =>
                    setRequested((prev) => ({
                      ...prev,
                      [t.key]: { ...req, qty: Number(e.target.value) || 0 },
                    }))
                  }
                  className="px-2 py-1.5 rounded bg-white/[0.04] border border-[var(--border-glass)] text-sm text-[var(--white)]"
                  placeholder="0"
                />
                <span className="text-xs text-[var(--gray-dim)]">{req.unit}</span>
                <label className="flex items-center gap-1 text-[10px] text-[var(--gray-dim)] whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={req.full}
                    onChange={(e) =>
                      setRequested((prev) => ({
                        ...prev,
                        [t.key]: { ...req, full: e.target.checked },
                      }))
                    }
                  />
                  Full replace
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={validate}
          disabled={validating}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--cyan)]/15 hover:bg-[var(--cyan)]/25 border border-[var(--cyan)]/40 text-[var(--cyan)] transition-colors disabled:opacity-50"
        >
          {validating ? "Validating…" : "Validate Scope"}
        </button>
        <button
          disabled={!validation || hasBlocker || validating}
          title={hasBlocker ? "Resolve red flags before sending" : "Generate production packet PDF"}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Send to Production
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {/* Validation results */}
      {validation && (
        <div>
          {summary && (
            <p
              className={`text-sm font-semibold mb-3 ${
                hasBlocker
                  ? "text-red-300"
                  : validation.some((v) => v.status === "over_minor")
                  ? "text-amber-300"
                  : "text-emerald-300"
              }`}
            >
              {summary}
            </p>
          )}
          <div className="space-y-2">
            {validation.map((row) => {
              const style = STATUS_STYLES[row.status];
              return (
                <div
                  key={row.trade}
                  className={`p-3 rounded-lg border ${style.bg} text-sm`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="flex items-center gap-2 font-medium text-[var(--white)]">
                      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                      {TRADES.find((t) => t.key === row.trade)?.label || row.trade}
                    </span>
                    <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
                  </div>
                  <p className={`text-xs ${style.text}`}>{row.message}</p>
                  <div className="mt-1 flex items-center gap-4 text-[10px] text-[var(--gray-dim)]">
                    <span>Scope: {row.scope_qty.toFixed(1)} {row.unit}</span>
                    {row.eagleview_qty !== null && (
                      <span>EagleView: {row.eagleview_qty.toFixed(1)} {row.unit}</span>
                    )}
                    <span>Requested: {row.requested_qty.toFixed(1)} {row.unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-[var(--gray-dim)] mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded bg-white/[0.04] border border-[var(--border-glass)] text-sm text-[var(--white)] focus:border-[var(--cyan)] focus:outline-none"
      />
    </div>
  );
}
