export type PlanId = "starter" | "pro" | "growth" | "enterprise" | "sales_rep";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: number; // monthly $ (0 for free)
  claimsPerMonth: number; // 0 = lifetime cap for starter
  lifetimeCap?: number; // only starter
  includedUsers?: number; // users included in base price
  extraUserPrice?: number; // $/mo per additional user
  stripePriceId: string | null; // null for free tier
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 0,
    claimsPerMonth: 0,
    lifetimeCap: 3,
    stripePriceId: null,
    features: [
      "3 lifetime claims",
      "Full 6-document package",
      "AI photo analysis",
      "Company branding on PDFs",
    ],
  },
  sales_rep: {
    id: "sales_rep",
    name: "Sales Rep",
    price: 99,
    claimsPerMonth: 0, // pay per claim
    includedUsers: 1,
    stripePriceId: (process.env.NEXT_PUBLIC_STRIPE_SALES_REP_PRICE_ID || "").trim(),
    features: [
      "$25 per claim",
      "Full 6-document package",
      "AI automations & training",
      "Company branding on PDFs",
      "Limited time offer",
    ],
  },
  pro: {
    id: "pro",
    name: "Company",
    price: 499,
    claimsPerMonth: 8,
    includedUsers: 2,
    extraUserPrice: 99,
    stripePriceId: (process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || "").trim(),
    features: [
      "8 claims / month",
      "2 users included",
      "Full dashboard & automation access",
      "Full 6-document package",
      "AI photo analysis",
      "Company branding on PDFs",
      "$99 / additional user",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 999,
    claimsPerMonth: 20,
    includedUsers: 2,
    extraUserPrice: 99,
    stripePriceId: (process.env.NEXT_PUBLIC_STRIPE_GROWTH_PRICE_ID || "").trim(),
    features: [
      "20 claims / month",
      "2 users included",
      "Full automation & intelligence",
      "Everything in Company",
      "Carrier intelligence playbooks",
      "$99 / additional user",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Max",
    price: 2999,
    claimsPerMonth: 100,
    includedUsers: 5,
    extraUserPrice: 99,
    stripePriceId: (process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID || "").trim(),
    features: [
      "100 claims / month",
      "5 users included",
      "Everything in Growth",
      "Dedicated support",
      "Custom integrations",
      "Inspector network access",
      "$99 / additional user",
    ],
  },
};

export function getPlanByPriceId(priceId: string): PlanDefinition | undefined {
  return Object.values(PLANS).find((p) => p.stripePriceId === priceId);
}
