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

/**
 * Single price ID for team seat overage. Charged at $99/seat/month above
 * each plan's includedUsers count. Set STRIPE_EXTRA_SEAT_PRICE_ID in env.
 * The price is shared across Pro/Growth/Max so seat sync can use one ID
 * regardless of which paid plan a company is on.
 */
export const EXTRA_SEAT_PRICE_ID = (process.env.STRIPE_EXTRA_SEAT_PRICE_ID || "").trim();

/** One-time purchasable add-ons (not subscriptions) */
export interface AddOnDefinition {
  id: string;
  name: string;
  price: number;
  stripePriceId: string;
  description: string;
  features: string[];
}

export const ADD_ONS: AddOnDefinition[] = [
  {
    id: "haag_inspection",
    name: "HAAG Inspection + 6-Doc Package",
    price: 500,
    stripePriceId: (process.env.NEXT_PUBLIC_STRIPE_HAAG_PRICE_ID || "").trim(),
    description: "In-person HAAG-certified roof inspection by a DumbRoof Inspection Club member",
    features: [
      "HAAG-certified inspector on-site",
      "Full 6-document forensic package",
      "AI photo analysis + annotations",
      "Forensic causation report",
      "Xactimate-style estimate",
      "Code compliance report",
    ],
  },
];

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
      "Everything in Company",
      "AOB & contingency e-signatures",
      "Sequenced carrier document delivery",
      "Certificate of completion automation",
      "Payment follow-up email cadence",
      "Stripe direct invoicing to homeowners",
      "Install supplement builder",
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
      "AOB & contingency e-signatures",
      "Sequenced carrier document delivery",
      "Certificate of completion automation",
      "Payment follow-up email cadence",
      "Stripe direct invoicing to homeowners",
      "Install supplement builder",
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
