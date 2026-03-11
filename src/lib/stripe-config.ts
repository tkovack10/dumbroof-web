export type PlanId = "starter" | "pro" | "growth" | "enterprise";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: number; // monthly $ (0 for free)
  claimsPerMonth: number; // 0 = lifetime cap for starter
  lifetimeCap?: number; // only starter
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
      "Full 5-document package",
      "AI photo analysis",
      "Company branding on PDFs",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 499,
    claimsPerMonth: 10,
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || "",
    features: [
      "10 claims / month",
      "Full 5-document package",
      "AI photo analysis",
      "Company branding on PDFs",
      "Priority processing",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 999,
    claimsPerMonth: 30,
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_GROWTH_PRICE_ID || "",
    features: [
      "30 claims / month",
      "Everything in Pro",
      "Email forwarding (team members)",
      "Carrier intelligence playbooks",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: 2999,
    claimsPerMonth: 100,
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID || "",
    features: [
      "100 claims / month",
      "Everything in Growth",
      "Dedicated support",
      "Custom integrations",
      "Inspector network access",
    ],
  },
};

export function getPlanByPriceId(priceId: string): PlanDefinition | undefined {
  return Object.values(PLANS).find((p) => p.stripePriceId === priceId);
}
