/**
 * Shared commission constants + formatters.
 *
 * Single source of truth for the commission rate and the flat AOB amount so the
 * number a rep is SHOWN (client preview) can never drift from the number we
 * actually FILE (server). Imported by the check/AOB/commission modals, the rep
 * Commissions page, the admin Commissions page, and the upload-check +
 * commission-request API routes.
 */

/** Rep commission on a collected check. */
export const COMMISSION_RATE = 0.1; // 10%
/** Flat commission for a signed AOB, in cents. */
export const AOB_COMMISSION_CENTS = 10_000; // $100

export type CommissionType = "check_10pct" | "aob_100" | "other";

/** 10% of a check amount (cents in → cents out), consistently rounded. */
export function commissionCentsForCheck(amountCents: number): number {
  return Math.round(amountCents * COMMISSION_RATE);
}

export function fmtMoneyCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function fmtCommissionType(t: string): string {
  if (t === "check_10pct") return "10% of check";
  if (t === "aob_100") return "$100 AOB";
  return "Custom";
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
