"use client";

import { useState } from "react";

const BACKEND = "https://dumbroof-backend-production.up.railway.app";

/**
 * Surgical-edit card for report fields that can drift from reality
 * (inspection date, date of loss, etc.). Saves patch into claims.claim_config
 * JSONB + top-level columns via POST /api/regen/{claim_id} which triggers
 * a forensic re-generation without re-running photo analysis (~30-90 sec).
 *
 * Intentionally narrow — contact fields live in the Contact Registry card,
 * and scope/estimate edits live in the Estimate View. This card handles
 * the "facts on page 1 of the forensic report" that QA auditor flags.
 */
export function EditReportFieldsCard({
  claimId,
  initial,
}: {
  claimId: string;
  initial: {
    date_of_loss?: string | null;
    inspection_date?: string | null;
    homeowner_name?: string | null;
    address?: string | null;
  };
}) {
  const [dateOfLoss, setDateOfLoss] = useState(initial.date_of_loss || "");
  const [inspectionDate, setInspectionDate] = useState(initial.inspection_date || "");
  const [homeownerName, setHomeownerName] = useState(initial.homeowner_name || "");
  const [address, setAddress] = useState(initial.address || "");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changed =
    dateOfLoss !== (initial.date_of_loss || "") ||
    inspectionDate !== (initial.inspection_date || "") ||
    homeownerName !== (initial.homeowner_name || "") ||
    address !== (initial.address || "");

  const save = async () => {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const configPatch: Record<string, unknown> = {};
      const topLevel: Record<string, unknown> = {};
      const dates: Record<string, string> = {};
      const claim: Record<string, string> = {};

      if (dateOfLoss && dateOfLoss !== (initial.date_of_loss || "")) {
        dates.date_of_loss = dateOfLoss;
        topLevel.date_of_loss = dateOfLoss;
      }
      if (inspectionDate && inspectionDate !== (initial.inspection_date || "")) {
        dates.inspection_date = inspectionDate;
        topLevel.inspection_date = inspectionDate;
      }
      if (homeownerName && homeownerName !== (initial.homeowner_name || "")) {
        claim.homeowner_name = homeownerName;
        topLevel.homeowner_name = homeownerName;
      }
      if (address && address !== (initial.address || "")) {
        claim.address = address;
        topLevel.address = address;
      }

      if (Object.keys(dates).length) configPatch.dates = dates;
      if (Object.keys(claim).length) configPatch.claim = claim;

      const res = await fetch(`${BACKEND}/api/regen/${claimId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config_patch: configPatch, top_level: topLevel }),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setMessage("Regenerating report — refresh in ~60 seconds to see the updated PDFs.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-[var(--white)]">Edit report fields</h3>
          <p className="text-xs text-[var(--gray-muted)] mt-0.5">
            Fix inspection date, date of loss, homeowner name, or address. Triggers a fast forensic re-generation.
          </p>
        </div>
        <svg
          className={`w-4 h-4 text-[var(--gray-muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--border-glass)] space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Date of loss" type="date" value={dateOfLoss} onChange={setDateOfLoss} />
            <Field label="Inspection date" type="date" value={inspectionDate} onChange={setInspectionDate} />
            <Field label="Homeowner name" value={homeownerName} onChange={setHomeownerName} />
            <Field label="Address" value={address} onChange={setAddress} />
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {message && (
            <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              {message}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--gray-dim)]">
              Re-uses cached photo analysis — only the forensic narrative is regenerated.
            </p>
            <button
              onClick={save}
              disabled={!changed || saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Regenerating…" : "Save & regenerate report"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date";
}) {
  return (
    <div>
      <label className="block text-xs text-[var(--gray-dim)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 rounded bg-white/[0.04] border border-[var(--border-glass)] text-sm text-[var(--white)] focus:border-[var(--cyan)] focus:outline-none"
      />
    </div>
  );
}
