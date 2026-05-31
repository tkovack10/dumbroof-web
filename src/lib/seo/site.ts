/**
 * Single source of truth for site-wide SEO/AEO constants, the learn-guide
 * catalog, and the public route registry. robots.ts, sitemap.ts, the
 * JSON-LD builders, and llms.txt all read from here so they can never drift.
 *
 * Canonical host: https://www.dumbroof.ai — matches metadataBase in
 * src/app/layout.tsx. All other files (robots/sitemap/canonicals/llms.txt)
 * are standardized on this host.
 */

import { COMPARISONS } from "./comparisons";

export const SITE = {
  url: "https://www.dumbroof.ai",
  /** Marketing brand name. */
  name: "DumbRoof",
  /** Legal entity behind the product (used in Organization.legalName). */
  legalName: "USA Roof Masters",
  /** Operating company name used historically in layout JSON-LD. */
  publisher: "Dumb Roof Technologies",
  tagline: "AI insurance claim supplements for roofers",
  shortDescription:
    "AI-powered insurance claim supplement software for roofing contractors.",
  longDescription:
    "DumbRoof turns roof inspection photos and carrier scopes into forensic causation reports, Xactimate-style estimates, and supplement packages — in minutes, not days.",
  founder: "Tom Kovack Jr.",
  founderTitle: "CEO",
  email: "TKovack@USARoofMasters.com",
  /** Existing brand mark that actually ships in /public. */
  logo: "https://www.dumbroof.ai/icon.svg",
  /** Verified public social profiles (Organization.sameAs). */
  sameAs: [
    "https://x.com/DumbRoofAI",
    "https://www.linkedin.com/company/dumbroofai",
    "https://www.instagram.com/dumbroofai",
    "https://www.tiktok.com/@dumbroofai",
    "https://www.youtube.com/@DumbRoofAI",
    "https://www.facebook.com/DumbRoofAI",
  ],
  twitterHandle: "@DumbRoofAI",
  address: {
    streetAddress: "3070 Bristol Pike, Building 1, Suite 122",
    addressLocality: "Bensalem",
    addressRegion: "PA",
    postalCode: "19020",
    addressCountry: "US",
  },
} as const;

/** Absolute URL helper anchored on the canonical host. */
export function absoluteUrl(pathname = "/"): string {
  if (!pathname || pathname === "/") return SITE.url;
  return `${SITE.url}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

/**
 * The 16 long-form learn guides. One entry per guide; `slug` maps to
 * src/app/learn/<slug>/page.tsx. `breadcrumb` is the leaf label that already
 * appears in each guide's visible breadcrumb nav (reused for BreadcrumbList
 * structured data). `summary` powers the learn hub + llms.txt.
 *
 * Generated from the live guide metadata — keep in sync with the pages.
 */
export const LEARN_GUIDES = [
  {
    slug: "what-is-hail-damage",
    title:
      "What Is Hail Damage? Identification, Insurance Claims & Documentation",
    breadcrumb: "Hail Damage",
    summary:
      "What hail damage is, how it shows up on shingles, metal, slate, and membrane roofs, and how to document it for a claim.",
  },
  {
    slug: "what-is-wind-damage",
    title:
      "What Is Wind Damage? How to Identify, Document & File Insurance Claims",
    breadcrumb: "Wind Damage",
    summary:
      "How to recognize creased, lifted, and missing shingles from wind, and document the loss carriers respect.",
  },
  {
    slug: "hail-damage-to-asphalt-shingles",
    title: "What Does Hail Damage Look Like on Asphalt Shingles?",
    breadcrumb: "Hail Damage: Asphalt Shingles",
    summary:
      "Identifying circular bruises, granule loss, and exposed mat on asphalt shingles, with real claim photos.",
  },
  {
    slug: "hail-damage-to-metal-roofing",
    title: "Hail Damage to Metal Roofing: Identification & Insurance Claims",
    breadcrumb: "Hail Damage: Metal",
    summary:
      "The functional-vs-cosmetic debate on metal roofs, how to document dents, and how to win the claim.",
  },
  {
    slug: "hail-damage-to-slate-roofs",
    title: "Hail Damage to Slate Roofs: Identification, Repair & Insurance Claims",
    breadcrumb: "Hail Damage: Slate",
    summary:
      "Why slate fractures rather than bruises, how to spot fresh breaks, and the unique insurance challenges.",
  },
  {
    slug: "hail-damage-to-tpo-roofing",
    title:
      "Hail Damage to TPO Roofing: Identification Signs & Commercial Claim Guide",
    breadcrumb: "Hail Damage: TPO",
    summary:
      "Reading concentric fractures and star cracks in TPO membrane and supplementing commercial claims.",
  },
  {
    slug: "hail-damage-to-epdm-roofing",
    title:
      "Hail Damage to EPDM Roofing: Detection, Documentation & Insurance Claims",
    breadcrumb: "Hail Damage: EPDM",
    summary:
      "Detecting hidden EPDM membrane and insulation damage and building the commercial claim.",
  },
  {
    slug: "how-to-file-roof-insurance-claim",
    title: "How to File a Roof Insurance Claim After a Storm (Step-by-Step)",
    breadcrumb: "How to File a Claim",
    summary:
      "A step-by-step path from documenting damage to meeting the adjuster to collecting your check.",
  },
  {
    slug: "how-long-to-file-roof-insurance-claim",
    title: "How Long Do I Have to File a Roof Insurance Claim?",
    breadcrumb: "Claim Filing Deadlines",
    summary:
      "Filing windows by state and carrier, exceptions, and how to avoid deadline-related denials.",
  },
  {
    slug: "what-is-a-roofing-supplement",
    title: "What Is a Roofing Supplement and Why Do I Need One?",
    breadcrumb: "Roofing Supplement",
    summary:
      "What a supplement is, why first estimates run low, what gets missed, and how to file one.",
  },
  {
    slug: "insurance-denied-my-roof-claim",
    title: "My Insurance Company Denied My Roof Claim — Now What?",
    breadcrumb: "Denied Roof Claim",
    summary:
      "How to read the denial, gather evidence, and reopen a claim with documentation the carrier can't ignore.",
  },
  {
    slug: "insurance-didnt-pay-enough-for-roof",
    title: "Insurance Didn't Pay Enough to Replace My Roof — What to Do",
    breadcrumb: "Underpaid Roof Claim",
    summary:
      "Supplements, missing line items, and code upgrades to recover what an underpaid roof claim owes you.",
  },
  {
    slug: "adjuster-missed-damage-on-my-roof",
    title: "Adjuster Missed Damage on My Roof — What to Do Next",
    breadcrumb: "Adjuster Missed Damage",
    summary:
      "What adjusters commonly miss, how to request a re-inspection, and how to document overlooked damage.",
  },
  {
    slug: "contractor-says-hail-damage-but-i-dont-see-it",
    title: "Contractor Says I Have Hail Damage But I Don't See It",
    breadcrumb: "Hail Damage Not Visible",
    summary:
      "What inspectors look for that's invisible from the ground, and how independent analysis confirms damage.",
  },
  {
    slug: "what-is-aob-assignment-of-benefits-roofing",
    title: "What Is an AOB (Assignment of Benefits) for Roofing?",
    breadcrumb: "AOB Explained",
    summary:
      "How AOBs work, the pros and cons, state laws, and how digital signing streamlines them.",
  },
  {
    slug: "how-to-automate-insurance-invoicing",
    title: "How to Automate Insurance Invoicing for Roofing Contractors",
    breadcrumb: "Automate Insurance Invoicing",
    summary:
      "Automating insurance invoicing with CRM integrations, QuickBooks syncing, and AI documentation.",
  },
] as const;

export type LearnGuide = (typeof LEARN_GUIDES)[number];

/** Private/transactional path prefixes crawlers must avoid. */
export const DISALLOWED_PATHS = [
  "/api/",
  "/admin/",
  "/dashboard/",
  "/auth/",
  "/login/",
  "/signup/",
  "/onboarding/",
  "/welcome/",
  "/unsubscribe/",
  "/invite/",
  "/sign/",
  "/r/",
] as const;

type ChangeFreq = "daily" | "weekly" | "monthly" | "yearly";
type RouteEntry = {
  path: string;
  changeFrequency: ChangeFreq;
  priority: number;
};

/**
 * Every PUBLIC, indexable route. Private/app/auth/funnel routes are
 * intentionally absent. sitemap.ts is generated directly from this list.
 */
export const PUBLIC_ROUTES: RouteEntry[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/learn", changeFrequency: "weekly", priority: 0.8 },
  ...LEARN_GUIDES.map((g) => ({
    path: `/learn/${g.slug}`,
    changeFrequency: "monthly" as ChangeFreq,
    priority: 0.7,
  })),
  { path: "/compare", changeFrequency: "weekly", priority: 0.8 },
  ...COMPARISONS.map((c) => ({
    path: `/compare/${c.slug}`,
    changeFrequency: "monthly" as ChangeFreq,
    priority: 0.7,
  })),
  { path: "/integrations", changeFrequency: "monthly", priority: 0.6 },
  { path: "/sample", changeFrequency: "monthly", priority: 0.6 },
  // NOTE: /instant-forensic and /instant-supplement are intentionally
  // noindex (paid-funnel landing pages) → excluded from the sitemap.
  { path: "/inspection-club", changeFrequency: "monthly", priority: 0.6 },
  { path: "/pa-club", changeFrequency: "monthly", priority: 0.6 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];
