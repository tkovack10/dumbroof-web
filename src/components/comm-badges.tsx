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
};

export const EMPTY_COMM: CommStatus = {
  forensic_to_homeowner: false,
  forensic_to_carrier: false,
  supplement_sent: false,
  coc_sent: false,
  engagement_active: false,
};

// Compact 5-icon strip showing whether each communication milestone has fired.
// Dim/grayscale = not yet, full opacity = sent. Hover for tooltip.
export function CommBadges({ status }: { status?: CommStatus }) {
  const s = status || EMPTY_COMM;
  const items: { on: boolean; icon: string; title: string }[] = [
    { on: s.forensic_to_homeowner, icon: "🖼️", title: s.forensic_to_homeowner ? "Forensic sent to homeowner" : "Forensic not yet sent to homeowner" },
    { on: s.forensic_to_carrier,   icon: "📄", title: s.forensic_to_carrier   ? "Forensic sent to insurance" : "Forensic not yet sent to insurance" },
    { on: s.supplement_sent,       icon: "📋", title: s.supplement_sent       ? "Supplement sent to insurance" : "Supplement not yet sent to insurance" },
    { on: s.coc_sent,              icon: "🏅", title: s.coc_sent              ? "Certificate of Completion sent" : "COC not yet sent" },
    { on: s.engagement_active,     icon: "📧", title: s.engagement_active     ? "Homeowner engagement sequence active" : "Homeowner engagement sequence not started" },
  ];
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="Communication status">
      {items.map((it) => (
        <span
          key={it.icon}
          title={it.title}
          className={`text-[11px] leading-none ${it.on ? "opacity-100" : "opacity-25 grayscale"}`}
        >
          {it.icon}
        </span>
      ))}
    </span>
  );
}
