export interface BillingQuota {
  planId: string;
  planName: string;
  allowed: boolean;
  remaining: number;
  periodUsed: number;
  lifetimeUsed: number;
  limit: number;
  status: string;
}
