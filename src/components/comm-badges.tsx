"use client";

// Per-claim communication-status snapshot. Powers the per-row badge strip on
// the company dashboard + admin dashboard, and the "true" supplement-win %
// denominator (only counts claims where a supplement was actually shipped,
// not every claim in the system — forensic-only leads and pre-supplement
// claims no longer depress the rate).
export type CommStatus = {
  forensic_to_homeowner: boolean;
  forensic_to_carrier: boolean;
  supplement_sent: boolean;
  coc_sent: boolean;
  engagement_active: boolean;
  /** At least one check_uploads row exists for this claim (≥ deposit collected). */
  payment_received: boolean;
};

export const EMPTY_COMM: CommStatus = {
  forensic_to_homeowner: false,
  forensic_to_carrier: false,
  supplement_sent: false,
  coc_sent: false,
  engagement_active: false,
  payment_received: false,
};

// Compact icon strip showing whether each communication milestone has fired.
// Dim/grayscale = not yet, full opacity = sent. Hover for tooltip.
// The $ icon is green-highlighted (not just grayscale-on) because payment is
// the only milestone that means MONEY IN — Tom's rule: $ means at least a
// deposit was collected. Per his 2026-05-22 directive, every claim with $
// must also appear in production (calendar entry OR Needs Install bucket).
export function CommBadges({ status }: { status?: CommStatus }) {
  const s = status || EMPTY_COMM;
  const items: { on: boolean; icon: string; title: string; money?: boolean }[] = [
    { on: s.forensic_to_homeowner, icon: "🖼️", title: s.forensic_to_homeowner ? "Forensic sent to homeowner" : "Forensic not yet sent to homeowner" },
    { on: s.forensic_to_carrier,   icon: "📄", title: s.forensic_to_carrier   ? "Forensic sent to insurance" : "Forensic not yet sent to insurance" },
    { on: s.supplement_sent,       icon: "📋", title: s.supplement_sent       ? "Supplement sent to insurance" : "Supplement not yet sent to insurance" },
    { on: s.coc_sent,              icon: "🏅", title: s.coc_sent              ? "Certificate of Completion sent" : "COC not yet sent" },
    { on: s.engagement_active,     icon: "📧", title: s.engagement_active     ? "Homeowner engagement sequence active" : "Homeowner engagement sequence not started" },
    { on: s.payment_received,      icon: "$",  title: s.payment_received      ? "Payment received (≥ deposit)" : "No payment recorded yet", money: true },
  ];
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="Communication status">
      {items.map((it, i) => (
        <span
          key={i}
          title={it.title}
          className={
            it.money
              ? `text-[11px] leading-none font-bold inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm ${
                  it.on
                    ? "text-[var(--green)] bg-[var(--green)]/15"
                    : "text-[var(--gray-muted)] opacity-30"
                }`
              : `text-[11px] leading-none ${it.on ? "opacity-100" : "opacity-25 grayscale"}`
          }
        >
          {it.icon}
        </span>
      ))}
    </span>
  );
}
