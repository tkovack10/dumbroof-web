// Per-campaign landing page config for Meta paid social.
// Each variant tunes the hero copy to match the ad message that brought the user here.
// Reduces ad-to-page-mismatch bounce that was killing conversion at $4.5K/day on Apr 26.

export type FbVariant = "default" | "hail" | "whoops" | "leads";

export interface VariantConfig {
  badge: string;
  headlineLead: string;
  headlineEmphasis: string;
  subhead: string;
  finalHeadline: string;
  finalSubcopy: string;
  metaTitle: string;
  metaDescription: string;
}

export const FB_VARIANTS: Record<FbVariant, VariantConfig> = {
  default: {
    badge: "3 Free Claims — No Credit Card",
    headlineLead: "Roofing claims,",
    headlineEmphasis: "without the busywork.",
    subhead:
      "AI writes your inspection report, your estimate, and your supplement letter. Your reps stay on the roof, selling.",
    finalHeadline: "Start with photos. Go as far as you want.",
    finalSubcopy: "First 3 claims are on us. No card. Cancel anytime.",
    metaTitle: "DumbRoof — Roofing claims without the busywork",
    metaDescription:
      "AI writes your inspection report, estimate, and supplement letter from photos. 3 free claims, no card.",
  },

  // Match: "Stop Wasting a Storm Season on Training" — Hail Zones (Chicago + NW Ohio)
  hail: {
    badge: "Hail Season • 3 Free Claims",
    headlineLead: "Stop wasting a storm season",
    headlineEmphasis: "training reps.",
    subhead:
      "Get every rep claim-ready in 5 minutes. AI writes the inspection report, the estimate, and the supplement letter. Your reps stay on the roof, selling.",
    finalHeadline: "Hail's coming. Be ready.",
    finalSubcopy: "First 3 claims are on us. No card. Cancel anytime.",
    metaTitle: "Stop wasting a storm season training reps — DumbRoof",
    metaDescription:
      "Get every rep claim-ready in 5 minutes. AI writes inspection reports, estimates, and supplement letters. 3 free claims, no card.",
  },

  // Match: "Try DumbRoof Free / Whoops — we're about to break the roofing industry"
  whoops: {
    badge: "Try DumbRoof Free • No Card",
    headlineLead: "Whoops —",
    headlineEmphasis: "we're about to break the roofing industry.",
    subhead:
      "AI writes your inspection reports, estimates, and supplement letters. Your first 3 claims are on us. No card. Cancel anytime.",
    finalHeadline: "Try it. No card.",
    finalSubcopy: "First 3 claims are on us. Cancel anytime.",
    metaTitle: "Whoops — we're about to break the roofing industry — DumbRoof",
    metaDescription:
      "AI writes your inspection reports, estimates, and supplement letters. 3 free claims, no card.",
  },

  // Match: "This isn't a demo. This is a competitive advantage."
  leads: {
    badge: "Real Claims • Real Carrier Movement",
    headlineLead: "This isn't a demo.",
    headlineEmphasis: "It's your competitive advantage.",
    subhead:
      "Upload damage photos, get a forensic report in 5 minutes. Add measurements, get an estimate. Add the carrier scope, get a supplement letter. Automatically.",
    finalHeadline: "Get the advantage.",
    finalSubcopy: "First 3 claims are on us. No card. Cancel anytime.",
    metaTitle: "Real claims. Real carrier movement. — DumbRoof",
    metaDescription:
      "Upload photos → forensic report. Add measurements → estimate. Add carrier scope → supplement letter. 3 free claims, no card.",
  },
};

export function isValidVariant(slug: string): slug is FbVariant {
  return slug in FB_VARIANTS;
}
