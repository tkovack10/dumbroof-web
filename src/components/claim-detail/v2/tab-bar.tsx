"use client";

import { V2_DESKTOP_TABS, V2_MOBILE_TABS, V2_TAB_ICONS, V2_TAB_LABELS, type V2TabKey } from "./types";

interface TabBarProps {
  active: V2TabKey;
  onChange: (k: V2TabKey) => void;
  badges?: Partial<Record<V2TabKey, number>>;
}

/**
 * Renders TWO tab strips in the same component:
 *   - Desktop (≥sm): horizontal top tab bar under the highlights panel.
 *   - Mobile (<sm): bottom tab bar with label-on-active-only (Apple Music
 *     pattern), thumb-reachable. Richard floats bottom-right separately.
 *
 * Active-tab transition is a 180ms ease-out on color + label + filter glow.
 */
export function TabBar({ active, onChange, badges }: TabBarProps) {
  return (
    <>
      {/* Desktop top tabs — sits below the highlights panel which itself sits
          below the dashboard top nav. Stack: nav (top:0, z:50) → highlights
          (top:60, z:20) → tab bar (top:140, z:10). */}
      <div className="hidden sm:flex sticky top-[140px] z-10 bg-[var(--navy)]/95 backdrop-blur-xl border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto w-full px-6 flex items-center gap-1 overflow-x-auto">
          {V2_DESKTOP_TABS.map((k) => {
            const isActive = active === k;
            const badge = badges?.[k];
            return (
              <button
                key={k}
                onClick={() => onChange(k)}
                className={`relative px-4 py-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                  isActive
                    ? "text-white"
                    : "text-[var(--gray-muted)] hover:text-[var(--gray)]"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-sm" aria-hidden="true">{V2_TAB_ICONS[k]}</span>
                  {V2_TAB_LABELS[k]}
                  {badge != null && badge > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold bg-[var(--pink)]/20 text-[var(--pink)] border border-[var(--pink)]/40">
                      {badge}
                    </span>
                  )}
                </span>
                {/* Active underline — animated via transform-origin scaleX trick */}
                <span
                  className={`absolute left-2 right-2 bottom-0 h-[2px] bg-[var(--cyan)] rounded-full transition-transform duration-200 origin-center ${
                    isActive ? "scale-x-100" : "scale-x-0"
                  }`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        className="sm:hidden fixed left-0 right-0 bottom-0 z-30 bg-[var(--navy)]/95 backdrop-blur-xl border-t border-white/[0.08]"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
        aria-label="Claim navigation"
      >
        <div
          className="grid items-stretch"
          style={{ gridTemplateColumns: `repeat(${V2_MOBILE_TABS.length}, 1fr)` }}
        >
          {V2_MOBILE_TABS.map((k) => {
            const isActive = active === k;
            const badge = badges?.[k];
            return (
              <button
                key={k}
                onClick={() => onChange(k)}
                className={`relative flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors ${
                  isActive ? "text-[var(--cyan)]" : "text-[var(--gray-muted)]"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <span
                  className={`text-[20px] leading-none transition-transform duration-200 ${
                    isActive ? "scale-110 [filter:drop-shadow(0_0_6px_rgba(34,216,255,0.55))]" : ""
                  }`}
                  aria-hidden="true"
                >
                  {V2_TAB_ICONS[k]}
                </span>
                <span
                  className={`overflow-hidden transition-all duration-200 leading-none ${
                    isActive ? "max-h-[14px] opacity-100 text-[10px] font-semibold mt-0.5" : "max-h-0 opacity-0 text-[0px]"
                  }`}
                >
                  {V2_TAB_LABELS[k]}
                </span>
                {badge != null && badge > 0 && (
                  <span
                    className="absolute top-1.5 right-[28%] w-[7px] h-[7px] rounded-full bg-[var(--pink)] shadow-[0_0_6px_var(--pink)]"
                    aria-label={`${badge} pending`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
