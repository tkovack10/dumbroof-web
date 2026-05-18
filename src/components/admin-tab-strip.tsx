"use client";

interface Tab<T extends string> {
  key: T;
  label: string;
  count?: number | null;
}

/**
 * Phase 6 Slice 6 — small reusable tab strip for admin pages.
 *
 * Same shape as the per-claim page's tabs (Overview / Documents / Scope /
 * Photos / Comms / Closeout). Visual: underline-on-active, dimmed-on-
 * inactive, optional count badge per tab. Carries no state — host page
 * passes active + onChange.
 */
export function AdminTabStrip<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab<T>[];
  active: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-[var(--border-glass)] mb-5">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              isActive
                ? "border-[var(--cyan)] text-white"
                : "border-transparent text-[var(--gray-muted)] hover:text-white"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              {t.label}
              {t.count !== undefined && t.count !== null && (
                <span
                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                    isActive
                      ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                      : "bg-white/[0.06] text-[var(--gray-dim)]"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
