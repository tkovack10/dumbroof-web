export type QuotaMode = "normal" | "overage" | "blocked";

export interface BillingQuota {
  planId: string;
  planName: string;
  allowed: boolean;
  mode: QuotaMode;
  remaining: number;
  periodUsed: number;
  lifetimeUsed: number;
  limit: number | null;
  status: string;
  reason?: string | null;
  companyShared?: boolean;

  // Overage fields (paid plans only — undefined / 0 / false for starter & sales_rep)
  overageThisPeriod: number;
  overageUnitPriceCents: number;
  ackRequired: boolean;

  // Upsell hints (null when there's no automatic next tier — i.e. enterprise)
  nextTier: string | null;
  nextTierName: string | null;
  nextTierPriceCents: number | null;
  nextTierMonthlyCap: number | null;

  currentPeriodEnd: string | null;
}
