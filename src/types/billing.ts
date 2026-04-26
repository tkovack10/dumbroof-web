export interface BillingQuota {
  planId: string;
  planName: string;
  allowed: boolean;
  remaining: number;
  periodUsed: number;
  lifetimeUsed: number;
  limit: number | null;
  status: string;
  reason?: string | null;
  companyShared?: boolean;
}
