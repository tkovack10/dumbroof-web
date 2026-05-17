"use client";

export type ClaimGridFilter =
  | "all"
  | "all_lit"
  | "needs_forensic"
  | "needs_supplement"
  | "needs_coc"
  | "needs_engagement"
  | "needs_check"
  | "awaiting_production";

export interface ClaimGridCounts {
  all: number;
  all_lit: number;
  needs_forensic: number;
  needs_supplement: number;
  needs_coc: number;
  needs_engagement: number;
  needs_check: number;
  awaiting_production: number;
}

const CHIPS: {
  key: ClaimGridFilter;
  label: string;
  color: string;
}[] = [
  { key: "all",                 label: "All",                color: "var(--gray)" },
  { key: "all_lit",             label: "✓ All lit",          color: "var(--green)" },
  { key: "needs_forensic",      label: "Needs forensic",     color: "var(--cyan)" },
  { key: "needs_supplement",    label: "Needs supplement",   color: "var(--amber)" },
  { key: "needs_coc",           label: "Needs COC",          color: "var(--blue)" },
  { key: "needs_engagement",    label: "Needs engagement",   color: "var(--pink)" },
  { key: "needs_check",         label: "Needs $ check",      color: "var(--green)" },
  { key: "awaiting_production", label: "Awaiting production",color: "var(--purple)" },
];

export function ClaimFilterChips({
  active,
  counts,
  onChange,
}: {
  active: ClaimGridFilter;
  counts: ClaimGridCounts | null;
  onChange: (next: ClaimGridFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {CHIPS.map((chip) => {
        const isActive = chip.key === active;
        const count = counts?.[chip.key] ?? 0;
        const isUrgent =
          (chip.key.startsWith("needs_") || chip.key === "awaiting_production") &&
          count > 0;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange(chip.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              isActive
                ? "shadow-[0_0_18px_color-mix(in_srgb,var(--cyan)_30%,transparent)]"
                : "hover:brightness-125"
            }`}
            style={{
              color: isActive ? chip.color : isUrgent ? chip.color : "var(--gray)",
              background: isActive
                ? `color-mix(in srgb, ${chip.color} 18%, transparent)`
                : "rgba(255,255,255,0.02)",
              borderColor: isActive
                ? `color-mix(in srgb, ${chip.color} 60%, transparent)`
                : "var(--border-glass)",
            }}
          >
            <span>{chip.label}</span>
            {counts && (
              <span
                className="font-mono text-[10px] px-1 rounded"
                style={{
                  background: isActive
                    ? `color-mix(in srgb, ${chip.color} 35%, transparent)`
                    : "rgba(255,255,255,0.06)",
                  color: isActive ? "#000" : "var(--gray-muted)",
                  minWidth: "18px",
                  textAlign: "center",
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
