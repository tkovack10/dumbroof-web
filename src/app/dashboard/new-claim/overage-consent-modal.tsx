"use client";

interface OverageConsentModalProps {
  open: boolean;
  planName: string;
  monthlyLimit: number | null;
  overageUnitPriceCents: number;
  overageThisPeriod: number;
  nextTierName: string | null;
  nextTierPriceCents: number | null;
  nextTierMonthlyCap: number | null;
  currentPeriodEnd: string | null;
  onContinue: () => void;
  onUpgrade: () => void;
  onCancel: () => void;
}

function formatRenewalDate(iso: string | null): string {
  if (!iso) return "next renewal";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
  } catch {
    return "next renewal";
  }
}

/**
 * Shown the FIRST time a paid-plan user tries to submit a claim past their
 * monthly cap in a billing cycle. After they accept, overage_acknowledged_at
 * is set and the modal stays hidden until the next renewal resets it.
 *
 * Two CTAs (or one if the user is already on enterprise — no auto-upsell):
 * - Continue at $75/claim: marks ack and proceeds
 * - Upgrade to {nextTier}: bounces to /pricing?tier={...}
 */
export function OverageConsentModal({
  open,
  planName,
  monthlyLimit,
  overageUnitPriceCents,
  overageThisPeriod,
  nextTierName,
  nextTierPriceCents,
  nextTierMonthlyCap,
  currentPeriodEnd,
  onContinue,
  onUpgrade,
  onCancel,
}: OverageConsentModalProps) {
  if (!open) return null;

  const overageDollars = (overageUnitPriceCents / 100).toFixed(0);
  const renewalDate = formatRenewalDate(currentPeriodEnd);
  const nextTierDollars = nextTierPriceCents != null ? Math.round(nextTierPriceCents / 100) : null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-[var(--navy)] border border-[var(--border-glass)] rounded-2xl max-w-lg w-full p-8 text-white shadow-2xl">
        <h2 className="text-xl font-bold mb-2">
          You&apos;ve hit your {planName} monthly cap
        </h2>
        <p className="text-sm text-[var(--gray-muted)] mb-6 leading-relaxed">
          You&apos;ve used {monthlyLimit ?? "all"} of your {monthlyLimit ?? "monthly"} included
          claims this cycle{overageThisPeriod > 0 ? ` plus ${overageThisPeriod} overage` : ""}.
          Keep submitting at <span className="font-semibold text-white">${overageDollars} per claim</span>{" "}
          (billed on your {renewalDate} invoice), or upgrade your plan to lower
          your per-claim cost.
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onContinue}
            className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-3 rounded-xl font-bold text-sm transition-all"
          >
            Continue at ${overageDollars}/claim
          </button>

          {nextTierName && nextTierDollars != null && nextTierMonthlyCap != null ? (
            <button
              type="button"
              onClick={onUpgrade}
              className="w-full bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors border border-white/20"
            >
              Upgrade to {nextTierName} — ${nextTierDollars}/mo ({nextTierMonthlyCap} claims)
            </button>
          ) : (
            <a
              href="mailto:tom@dumbroof.ai?subject=Custom%20enterprise%20plan"
              className="w-full bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors border border-white/20 text-center inline-block"
            >
              Talk to sales for higher limits
            </a>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[var(--gray-dim)] hover:text-white transition-colors mt-1"
          >
            Cancel
          </button>
        </div>

        <p className="text-[10px] text-[var(--gray-dim)] mt-5 text-center leading-relaxed">
          You&apos;ll only see this prompt once per billing cycle. After accepting,
          subsequent overage claims are billed automatically until {renewalDate}.
        </p>
      </div>
    </div>
  );
}
