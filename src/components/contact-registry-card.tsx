"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ContactSource = Record<string, string | undefined>;

interface ContactRegistryCardProps {
  claimId: string;
  initial: {
    homeowner_name?: string | null;
    homeowner_email?: string | null;
    homeowner_phone?: string | null;
    adjuster_name?: string | null;
    adjuster_email?: string | null;
    adjuster_phone?: string | null;
    claim_number?: string | null;
    policy_number?: string | null;
    contact_source?: ContactSource | null;
  };
  onChange?: (patch: Partial<ContactRegistryCardProps["initial"]>) => void;
}

const FIELD_LABELS: Record<string, string> = {
  homeowner_name: "Homeowner name",
  homeowner_email: "Homeowner email",
  homeowner_phone: "Homeowner phone",
  adjuster_name: "Adjuster name",
  adjuster_email: "Adjuster email",
  adjuster_phone: "Adjuster phone",
  claim_number: "Claim #",
  policy_number: "Policy #",
};

function ContactField({
  claimId,
  field,
  label,
  value,
  source,
  type = "text",
  onSave,
}: {
  claimId: string;
  field: string;
  label: string;
  value: string;
  source?: string;
  type?: "text" | "email" | "tel";
  onSave: (newValue: string) => void;
}) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === (value || "").trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      // Mark this field as manually entered in contact_source
      const { data: claimRow } = await supabase
        .from("claims")
        .select("contact_source")
        .eq("id", claimId)
        .limit(1);
      const existingSource = (claimRow?.[0]?.contact_source as ContactSource) || {};
      const newSource = { ...existingSource, [field]: "manual" };

      await supabase
        .from("claims")
        .update({
          [field]: trimmed || null,
          contact_source: newSource,
        })
        .eq("id", claimId);
      onSave(trimmed);
    } catch (e) {
      console.warn("[contact-registry] save failed", e);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const badgeText = source === "manual"
    ? "manual"
    : source?.startsWith("scope_")
    ? "from scope"
    : source === "email_extract"
    ? "from email"
    : null;
  const badgeColor = source === "manual"
    ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
    : source?.startsWith("scope_")
    ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
    : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";

  return (
    <div className="py-2.5 border-b border-white/[0.04] last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-[var(--gray-dim)] flex-shrink-0 w-[140px]">
          {label}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-2 justify-end">
          {editing ? (
            <>
              <input
                type={type}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") cancel();
                }}
                disabled={saving}
                autoFocus
                className="flex-1 min-w-0 px-2 py-1 rounded bg-white/[0.04] border border-[var(--cyan)] text-sm text-[var(--white)] focus:outline-none"
              />
              <button
                onClick={commit}
                disabled={saving}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
              >
                {saving ? "…" : "Save"}
              </button>
              <button
                onClick={cancel}
                disabled={saving}
                className="text-xs text-[var(--gray-dim)] hover:text-[var(--white)]"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setDraft(value);
                  setEditing(true);
                }}
                className="text-sm text-[var(--white)] hover:text-[var(--cyan)] text-right truncate max-w-full transition-colors"
              >
                {value || <span className="text-[var(--gray-dim)] italic">Add {label.toLowerCase()}</span>}
              </button>
              {badgeText && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badgeColor} flex-shrink-0`}>
                  {badgeText}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ContactRegistryCard({ claimId, initial, onChange }: ContactRegistryCardProps) {
  const source = (initial.contact_source as ContactSource) || {};

  const [values, setValues] = useState({
    homeowner_name: initial.homeowner_name || "",
    homeowner_email: initial.homeowner_email || "",
    homeowner_phone: initial.homeowner_phone || "",
    adjuster_name: initial.adjuster_name || "",
    adjuster_email: initial.adjuster_email || "",
    adjuster_phone: initial.adjuster_phone || "",
    claim_number: initial.claim_number || "",
    policy_number: initial.policy_number || "",
  });

  const [expanded, setExpanded] = useState(false);

  const handleSave = (field: keyof typeof values) => (v: string) => {
    setValues((prev) => ({ ...prev, [field]: v }));
    onChange?.({ [field]: v || null });
  };

  const filledCount = Object.values(values).filter((v) => v.trim()).length;
  const totalCount = Object.keys(values).length;

  return (
    <div className="glass-card p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-[var(--white)]">Contact details</h3>
          <p className="text-xs text-[var(--gray-muted)] mt-0.5">
            {filledCount}/{totalCount} fields filled · used to pre-fill every email composer
          </p>
        </div>
        <svg
          className={`w-4 h-4 text-[var(--gray-muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--border-glass)]">
          <div className="mb-1">
            <p className="text-xs font-semibold text-[var(--gray-muted)] mb-1">Homeowner</p>
            <ContactField claimId={claimId} field="homeowner_name" label={FIELD_LABELS.homeowner_name}
              value={values.homeowner_name} source={source.homeowner_name}
              onSave={handleSave("homeowner_name")} />
            <ContactField claimId={claimId} field="homeowner_email" label={FIELD_LABELS.homeowner_email}
              value={values.homeowner_email} source={source.homeowner_email} type="email"
              onSave={handleSave("homeowner_email")} />
            <ContactField claimId={claimId} field="homeowner_phone" label={FIELD_LABELS.homeowner_phone}
              value={values.homeowner_phone} source={source.homeowner_phone} type="tel"
              onSave={handleSave("homeowner_phone")} />
          </div>

          <div className="mt-4 pt-4 border-t border-white/[0.04]">
            <p className="text-xs font-semibold text-[var(--gray-muted)] mb-1">Adjuster</p>
            <ContactField claimId={claimId} field="adjuster_name" label={FIELD_LABELS.adjuster_name}
              value={values.adjuster_name} source={source.adjuster_name}
              onSave={handleSave("adjuster_name")} />
            <ContactField claimId={claimId} field="adjuster_email" label={FIELD_LABELS.adjuster_email}
              value={values.adjuster_email} source={source.adjuster_email} type="email"
              onSave={handleSave("adjuster_email")} />
            <ContactField claimId={claimId} field="adjuster_phone" label={FIELD_LABELS.adjuster_phone}
              value={values.adjuster_phone} source={source.adjuster_phone} type="tel"
              onSave={handleSave("adjuster_phone")} />
          </div>

          <div className="mt-4 pt-4 border-t border-white/[0.04]">
            <p className="text-xs font-semibold text-[var(--gray-muted)] mb-1">Claim</p>
            <ContactField claimId={claimId} field="claim_number" label={FIELD_LABELS.claim_number}
              value={values.claim_number} source={source.claim_number}
              onSave={handleSave("claim_number")} />
            <ContactField claimId={claimId} field="policy_number" label={FIELD_LABELS.policy_number}
              value={values.policy_number} source={source.policy_number}
              onSave={handleSave("policy_number")} />
          </div>
        </div>
      )}
    </div>
  );
}
