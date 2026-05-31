// Location (state-level) catalog for Answer Engine Optimization (AEO).
//
// Mirrors the shape of `comparisons.ts`: a typed catalog that drives a shared
// server-component renderer (`src/components/location-page.tsx`) plus the hub
// (`src/app/roof-insurance-claim-help/page.tsx`) and 18 thin leaf pages.
//
// ANTI-FABRICATION CONTRACT
// -------------------------
// Every per-state legal/code fact in this file was verified against an
// authoritative source (state statute, state Department of Insurance, or state
// building-code authority) during authoring. Where a fact could not be verified
// to current, accurate detail, the field is left intentionally GENERAL and true
// ("deadlines vary by policy and state law — check your policy's suit-limitation
// clause and your state DOI"). It is always better to be general-but-true than
// specific-but-wrong. NO fabricated statistics, dollar figures, storm counts,
// customer counts, win rates, or ratings appear anywhere here or downstream.
//
// DumbRoof is AI software for roofing contractors (and helpful to homeowners),
// operated by USA Roof Masters, serving nationally. It is NOT a per-state
// office, NOT a public adjuster, and NOT a law firm. Pages render a plain
// "general information, not legal advice" line wherever legal facts appear.

export type LocationRegion =
  | "Hail Alley"
  | "Gulf & Hurricane Coast"
  | "Southeast"
  | "Midwest & Great Lakes"
  | "Northeast";

export interface LocationFaq {
  question: string;
  answer: string;
}

export interface LocationCrossLink {
  /** Path relative to site root, e.g. "/learn/hail-damage-to-asphalt-shingles". */
  href: string;
  label: string;
}

export interface Location {
  /** URL slug, e.g. "texas". */
  slug: string;
  /** Full state name, e.g. "Texas". */
  state: string;
  /** Two-letter postal abbreviation, e.g. "TX". */
  abbr: string;
  region: LocationRegion;
  /** <title>-grade headline. */
  title: string;
  /** Meta description (~150-160 chars). */
  description: string;
  /** One-line summary used on the hub grid. */
  summary: string;

  // ---- Narrative blocks (intro + storm profile) -------------------------
  /** 1-2 sentence lede under the H1. */
  intro: string;
  /** Accurate NOAA/SPC-grade climatology + common damage. No invented stats. */
  stormProfile: string;

  // ---- Verified-or-general per-state fact fields ------------------------
  /** Prevailing residential building / roofing code basis. */
  codeBasis: string;
  /** Statute-of-limitations / suit-limitation / claim-deadline norms. */
  deadlineNorms: string;
  /**
   * Matching ("like kind and quality") regulation or case-law posture.
   * Only names a statute/reg where verified; otherwise general framing.
   */
  matchingRule: string;
  /** Hurricane / named-storm / wind-hail deductible norms, if applicable. */
  deductibleNorms: string;
  /** State Department of Insurance name + complaint path. */
  doi: { name: string; complaintNote: string };

  /** 4-5 FAQ entries, rendered visibly AND as FAQPage JSON-LD. */
  faqs: LocationFaq[];

  /** 2-3 /learn guides + 1-2 /compare pages to cross-link. */
  crossLinks: LocationCrossLink[];
  /** Neighboring / thematically related state slugs. */
  relatedStates: string[];
}

// Region display order + labels for the hub grouping.
export const LOCATION_REGION_ORDER: LocationRegion[] = [
  "Hail Alley",
  "Gulf & Hurricane Coast",
  "Southeast",
  "Midwest & Great Lakes",
  "Northeast",
];

const NOT_LEGAL_ADVICE =
  "This page is general information for homeowners and contractors, not legal advice. " +
  "Deadlines and coverage turn on your specific policy and current state law — read your " +
  "policy's suit-limitation clause and confirm details with your state Department of Insurance " +
  "or a licensed professional.";

export const LOCATION_DISCLAIMER = NOT_LEGAL_ADVICE;

// Shared cross-link helpers. Each href is a real /learn or /compare route that
// exists in this repo (verified against the learn + comparisons catalogs).
const LX = {
  hailShingles: {
    href: "/learn/hail-damage-to-asphalt-shingles",
    label: "Hail damage to asphalt shingles",
  },
  notEnough: {
    href: "/learn/insurance-didnt-pay-enough-for-roof",
    label: "Insurance didn't pay enough for my roof",
  },
  howToFile: {
    href: "/learn/how-to-file-roof-insurance-claim",
    label: "How to file a roof insurance claim",
  },
  howLong: {
    href: "/learn/how-long-to-file-roof-insurance-claim",
    label: "How long do I have to file a roof claim?",
  },
  denied: {
    href: "/learn/insurance-denied-my-roof-claim",
    label: "What to do if your roof claim is denied",
  },
  windDamage: {
    href: "/learn/what-is-wind-damage",
    label: "What is wind damage?",
  },
  supplement: {
    href: "/learn/what-is-a-roofing-supplement",
    label: "What is a roofing supplement?",
  },
  vsPA: {
    href: "/compare/dumbroof-vs-hiring-a-public-adjuster",
    label: "DumbRoof vs. hiring a public adjuster",
  },
  vsXact: {
    href: "/compare/best-xactimate-alternative-for-roofers",
    label: "Best Xactimate alternative for roofers",
  },
} as const;

export const LOCATIONS: Location[] = [
  // ===================== HAIL ALLEY =====================
  {
    slug: "texas",
    state: "Texas",
    abbr: "TX",
    region: "Hail Alley",
    title:
      "Roof Insurance Claim Help in Texas: Storms, Deadlines & Supplements (2026)",
    description:
      "Texas roof insurance claim guide: hail and wind damage, suit-limitation deadlines, hurricane deductibles, the TDI complaint path, and how DumbRoof builds a carrier-ready supplement.",
    summary:
      "Hail, wind, and Gulf hurricanes — short policy suit-limitation deadlines and percentage hurricane deductibles make documentation critical.",
    intro:
      "Texas sees some of the most intense hail and windstorm activity in the country, and its coast faces Gulf hurricanes. If your carrier's roof estimate came in low, a well-documented supplement is often what closes the gap.",
    stormProfile:
      "Texas straddles the southern end of 'hail alley' and also faces Gulf of Mexico hurricanes, so roofs here take both large hail and high straight-line and hurricane winds. According to NOAA and the NWS Storm Prediction Center climatology, Texas regularly leads the nation in hail-event reports. Common storm damage to Texas roofs includes bruised and fractured asphalt shingles, granule loss, cracked or displaced shingles from wind uplift, damaged ridge and hip caps, and collateral damage to soft metals like vents, flashing, and gutters.",
    codeBasis:
      "Texas residential roofing work is generally governed by the International Residential Code (IRC) as adopted and amended by local jurisdictions; many Texas cities and counties enforce a recent IRC edition. Confirm the exact edition and any local amendments with your municipal building department.",
    deadlineNorms:
      "Texas's general statute of limitations for breach of a written contract is four years, but property insurance policies typically contain a contractual 'suit-limitation' clause that sets a shorter window — Texas law recognizes a minimum of two years and one day, and many policies use that period measured from the date of loss. Because these vary by policy, read your policy's suit-limitation clause and act promptly.",
    matchingRule:
      "Texas does not have a single, well-known statewide 'matching' statute that guarantees full like-kind-and-quality replacement across undamaged areas; matching outcomes generally turn on your specific policy language and the facts. Document why a partial repair cannot reasonably match the existing roof.",
    deductibleNorms:
      "Many Texas homeowners policies — especially near the coast — carry a separate windstorm/hail or named-storm/hurricane deductible expressed as a percentage of the dwelling coverage (commonly 1%-5%) rather than a flat dollar amount. Check your declarations page so you know your true out-of-pocket exposure before you file.",
    doi: {
      name: "Texas Department of Insurance (TDI)",
      complaintNote:
        "If you believe your claim was underpaid or mishandled, you can file a consumer complaint with the Texas Department of Insurance.",
    },
    faqs: [
      {
        question: "How long do I have to file a roof insurance claim in Texas?",
        answer:
          "It depends on your policy. Texas's general breach-of-contract limitations period is four years, but most homeowners policies include a shorter contractual suit-limitation clause (Texas recognizes a minimum of two years and one day). File and document promptly, and read your policy's suit-limitation language. This is general information, not legal advice.",
      },
      {
        question: "Why is my Texas hurricane or windstorm deductible so high?",
        answer:
          "Many Texas policies use a percentage windstorm/hail or named-storm deductible (a percentage of your dwelling coverage) instead of a flat dollar deductible. On a higher-value home that can be a large number. Check your declarations page for the exact deductible that applies.",
      },
      {
        question: "My Texas carrier underpaid my roof — what can I do?",
        answer:
          "Compare the carrier's estimate line-by-line against what your roof actually needs (correct measurements, all damaged components, code-required items). A documented supplement with photos, measurements, and code citations is the usual path. You can also file a complaint with the Texas Department of Insurance.",
      },
      {
        question: "Does DumbRoof handle Texas claims for me?",
        answer:
          "DumbRoof is software, not a public adjuster or law firm. It turns your inspection photos, measurements, and the carrier's estimate into a carrier-ready supplement package — a forensic causation report, an Xactimate-style estimate, a scope comparison, and code citations — in minutes. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.notEnough, LX.howToFile, LX.vsPA],
    relatedStates: ["oklahoma", "louisiana", "kansas"],
  },
  {
    slug: "oklahoma",
    state: "Oklahoma",
    abbr: "OK",
    region: "Hail Alley",
    title:
      "Roof Insurance Claim Help in Oklahoma: Hail, Wind & Supplements (2026)",
    description:
      "Oklahoma roof insurance claim guide: hail-alley storms, claim deadlines, the Oklahoma Insurance Department complaint path, and how DumbRoof builds a carrier-ready supplement.",
    summary:
      "Core hail-alley state with frequent large hail and tornadic wind; documentation and code-required items often drive supplements.",
    intro:
      "Oklahoma sits in the heart of hail alley and tornado-prone country, so roof damage from hail and wind is common. If your carrier's estimate is light, a documented supplement usually makes the difference.",
    stormProfile:
      "Oklahoma is one of the most active severe-weather states in the U.S., squarely inside 'hail alley' and the central tornado corridor. NOAA/SPC climatology consistently ranks Oklahoma among the top states for large hail and damaging wind events. Typical roof damage includes hail bruising and fractures on asphalt shingles, accelerated granule loss, wind-lifted and creased shingles, and damaged ridge caps, vents, and flashing.",
    codeBasis:
      "Oklahoma adopts the International Residential Code (IRC) as the statewide minimum residential code through the Oklahoma Uniform Building Code Commission, with state amendments, and local jurisdictions enforce it. Confirm the current edition and any local amendments with your municipal building department.",
    deadlineNorms:
      "Oklahoma's statute of limitations for an action on a written contract is generally five years, but Oklahoma law allows property insurance policies to shorten the time to sue — the standard fire policy commonly limits suit to one year from the loss. Read your policy's suit-limitation clause and file promptly rather than relying on the longer statutory period.",
    matchingRule:
      "Oklahoma does not have a single widely known statewide 'matching' statute guaranteeing full like-kind-and-quality replacement; matching disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Many Oklahoma homeowners policies carry a separate wind/hail deductible — often a percentage of the dwelling coverage — rather than the flat all-peril deductible. Check your declarations page so you know what actually applies to a storm claim.",
    doi: {
      name: "Oklahoma Insurance Department",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Oklahoma Insurance Department.",
    },
    faqs: [
      {
        question: "Is hail damage covered on my Oklahoma roof?",
        answer:
          "Most Oklahoma homeowners policies cover sudden hail and wind damage, subject to your deductible and policy terms. The dispute is usually about scope and amount, not whether the peril is covered — which is why documentation matters.",
      },
      {
        question: "How long do I have to file a roof claim in Oklahoma?",
        answer:
          "Oklahoma's written-contract limitations period is generally five years, but Oklahoma policies can shorten the time to sue — the standard fire policy often limits it to one year from the loss. Read your policy and file promptly. This is general information, not legal advice.",
      },
      {
        question: "What is a wind/hail deductible in Oklahoma?",
        answer:
          "It's a separate, often percentage-based deductible that applies specifically to wind and hail losses. On a storm claim it can be larger than your standard deductible — check your declarations page.",
      },
      {
        question: "How does DumbRoof help with an Oklahoma claim?",
        answer:
          "DumbRoof is software. It converts your inspection photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations — that you or your contractor submit.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.howLong, LX.howToFile, LX.vsXact],
    relatedStates: ["texas", "kansas", "missouri"],
  },
  {
    slug: "kansas",
    state: "Kansas",
    abbr: "KS",
    region: "Hail Alley",
    title:
      "Roof Insurance Claim Help in Kansas: Hail Alley Claims & Supplements (2026)",
    description:
      "Kansas roof insurance claim guide: hail-alley storms, claim deadlines, the Kansas Insurance Department complaint path, and how DumbRoof builds a carrier-ready supplement.",
    summary:
      "Central hail-alley state with intense large-hail and wind events; scope and code items frequently justify a supplement.",
    intro:
      "Kansas sits in the center of hail alley, so large hail and damaging wind regularly hit roofs across the state. A documented supplement is often the path to a fully paid claim.",
    stormProfile:
      "Kansas is one of the core 'hail alley' states, alongside Texas, Oklahoma, and Nebraska, with frequent large-hail and severe-wind events documented by NOAA and the NWS Storm Prediction Center. Common roof damage includes hail bruising and granule loss on asphalt shingles, fractured shingle mats, wind-creased shingles, and damage to ridge caps, vents, and metal flashing.",
    codeBasis:
      "Kansas residential roofing is generally governed by the International Residential Code (IRC) as adopted at the local level; Kansas leaves much building-code adoption to municipalities and counties. Confirm the current edition and amendments with your local building department.",
    deadlineNorms:
      "Kansas's statute of limitations on a written contract is generally five years, but Kansas allows policies to contractually shorten that period, and most property policies require suit within one or two years of the loss. Rely on your policy's suit-limitation clause and file promptly.",
    matchingRule:
      "Kansas does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a repair cannot reasonably match the undamaged roof.",
    deductibleNorms:
      "Many Kansas homeowners policies include a separate wind/hail deductible, often expressed as a percentage of dwelling coverage. Check your declarations page so you understand your real out-of-pocket cost on a storm claim.",
    doi: {
      name: "Kansas Insurance Department",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Kansas Insurance Department.",
    },
    faqs: [
      {
        question: "Does my Kansas policy cover hail damage to my roof?",
        answer:
          "Most Kansas homeowners policies cover sudden hail and wind damage subject to your deductible and terms. The common fight is over the amount and scope of repair, not whether hail is covered.",
      },
      {
        question: "How long do I have to file a roof claim in Kansas?",
        answer:
          "Kansas's written-contract limitations period is generally five years, but policies can shorten the time to sue (often to one or two years from the loss). Document and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Why is my Kansas wind/hail deductible separate?",
        answer:
          "Insurers in hail-prone states often apply a distinct, frequently percentage-based deductible to wind and hail losses. Review your declarations page to see exactly what applies.",
      },
      {
        question: "What does DumbRoof do for a Kansas claim?",
        answer:
          "DumbRoof is software that turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement package — forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.notEnough, LX.howToFile, LX.vsPA],
    relatedStates: ["nebraska", "oklahoma", "missouri"],
  },
  {
    slug: "nebraska",
    state: "Nebraska",
    abbr: "NE",
    region: "Hail Alley",
    title:
      "Roof Insurance Claim Help in Nebraska: Hail, Wind & Supplements (2026)",
    description:
      "Nebraska roof insurance claim guide: hail-alley storms, claim deadlines, the Nebraska Department of Insurance complaint path, and how DumbRoof builds a carrier-ready supplement.",
    summary:
      "Northern hail-alley state with severe hail and derecho-type wind; a 5-year written-contract limitations period that policies cannot shorten below the statutory minimum.",
    intro:
      "Nebraska sits at the northern end of hail alley and sees both large hail and powerful straight-line wind. When a carrier's estimate is light, a documented supplement is usually what closes the gap.",
    stormProfile:
      "Nebraska is one of the core 'hail alley' states and is also prone to derecho-type straight-line wind events. NOAA/SPC climatology shows Nebraska among the leading states for large hail. Typical roof damage includes hail bruising and granule loss on asphalt shingles, mat fractures, wind-lifted and torn shingles, and damaged ridge caps, vents, and flashing.",
    codeBasis:
      "Nebraska residential roofing is generally governed by the International Residential Code (IRC) as adopted by the state and local jurisdictions. Confirm the current edition and any local amendments with your municipal building department.",
    deadlineNorms:
      "Nebraska's statute of limitations on a written contract is generally five years, and Nebraska law bars insurers from issuing policies that set a shorter limitations period than state law prescribes — so for a property loss the period is generally five years from the date of loss. Still, read your policy and file promptly.",
    matchingRule:
      "Nebraska does not have a single widely known statewide 'matching' statute; like-kind-and-quality outcomes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Many Nebraska homeowners policies apply a separate wind/hail deductible, often a percentage of dwelling coverage rather than a flat amount. Check your declarations page before you file.",
    doi: {
      name: "Nebraska Department of Insurance",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Nebraska Department of Insurance.",
    },
    faqs: [
      {
        question: "Is hail damage to my Nebraska roof covered?",
        answer:
          "Most Nebraska homeowners policies cover sudden hail and wind damage subject to your deductible and terms. Disputes usually center on the scope and amount of repair.",
      },
      {
        question: "How long do I have to file a roof claim in Nebraska?",
        answer:
          "Nebraska's written-contract limitations period is generally five years, and Nebraska law prohibits policies from setting a shorter period than state law allows — so a property loss generally runs five years from the date of loss. File and document promptly. This is general information, not legal advice.",
      },
      {
        question: "What is a percentage wind/hail deductible?",
        answer:
          "It's a deductible calculated as a percentage of your dwelling coverage that applies to wind and hail losses, common in hail-prone states. Check your declarations page for the figure that applies to you.",
      },
      {
        question: "How does DumbRoof help with a Nebraska claim?",
        answer:
          "DumbRoof is software. It turns your inspection photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations — for you or your contractor to submit.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.windDamage, LX.howToFile, LX.vsXact],
    relatedStates: ["kansas", "missouri", "minnesota"],
  },
  {
    slug: "colorado",
    state: "Colorado",
    abbr: "CO",
    region: "Hail Alley",
    title:
      "Roof Insurance Claim Help in Colorado: Hail, Matching Law & Supplements (2026)",
    description:
      "Colorado roof insurance claim guide: Front Range hail, the Colorado matching statute, claim deadlines, the Division of Insurance complaint path, and DumbRoof supplements.",
    summary:
      "Front Range hail capital with a specific statutory matching protection (C.R.S. 10-4-110.8) for like-kind-and-quality replacement.",
    intro:
      "Colorado's Front Range is one of the most hail-battered corridors in the country, and the state has an unusually homeowner-friendly matching statute. Both facts shape how Colorado roof claims should be documented.",
    stormProfile:
      "The Colorado Front Range — Denver, Colorado Springs, Fort Collins and the surrounding metro corridor — is among the most hail-prone regions in the United States, frequently producing costly hail seasons in NOAA/SPC climatology. Common roof damage includes hail bruising and fractures on asphalt shingles, heavy granule loss, cracked tiles, and damage to soft metals, vents, and flashing.",
    codeBasis:
      "Colorado residential roofing is generally governed by the International Residential Code (IRC) as adopted by local jurisdictions; Colorado leaves residential code adoption largely to municipalities and counties. Confirm the current edition and amendments with your local building department.",
    deadlineNorms:
      "Colorado law sets limitations periods for contract actions, and your homeowners policy contains a contractual suit-limitation clause that may be shorter. Read your policy's clause and file promptly rather than relying on the general statutory period.",
    matchingRule:
      "Colorado has a specific statutory protection: under C.R.S. 10-4-110.8, when replacement of damaged property is necessary, insurers must consider matching of the repaired or replaced items to undamaged adjacent areas for certain residential property claims. This is a meaningful tool when a partial roof repair would not reasonably match — confirm the current statutory language and how it applies to your loss.",
    deductibleNorms:
      "Many Colorado homeowners policies apply a separate wind/hail deductible, frequently a percentage of dwelling coverage, given the state's hail exposure. Check your declarations page before you file.",
    doi: {
      name: "Colorado Division of Insurance",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Colorado Division of Insurance.",
    },
    faqs: [
      {
        question: "Does Colorado have a roof 'matching' law?",
        answer:
          "Yes. Colorado's matching statute (C.R.S. 10-4-110.8) requires insurers to consider matching repaired or replaced items to undamaged adjacent areas for certain residential property claims. It can support a full replacement argument when a partial repair would not reasonably match. Confirm the current language; this is general information, not legal advice.",
      },
      {
        question: "How long do I have to file a roof claim in Colorado?",
        answer:
          "Your homeowners policy contains a contractual suit-limitation clause that may be shorter than the general statutory period. Read your policy and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Why is my Colorado wind/hail deductible separate?",
        answer:
          "Because of the Front Range's heavy hail exposure, many insurers apply a distinct, often percentage-based wind/hail deductible. Check your declarations page for the figure that applies.",
      },
      {
        question: "How does DumbRoof help with a Colorado claim?",
        answer:
          "DumbRoof is software. It builds a carrier-ready supplement — forensic causation report, Xactimate-style estimate, scope comparison, and code citations — from your photos, measurements, and the carrier's estimate. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.notEnough, LX.howToFile, LX.vsPA],
    relatedStates: ["kansas", "nebraska", "oklahoma"],
  },

  // ===================== GULF & HURRICANE COAST =====================
  {
    slug: "florida",
    state: "Florida",
    abbr: "FL",
    region: "Gulf & Hurricane Coast",
    title:
      "Roof Insurance Claim Help in Florida: Hurricanes, Deadlines & Supplements (2026)",
    description:
      "Florida roof insurance claim guide: hurricane and wind damage, the tightened notice and supplemental-claim deadlines, hurricane deductibles, DFS/OIR help, and DumbRoof supplements.",
    summary:
      "Hurricane-exposed state with a statewide building code and tightened post-2022 claim-notice deadlines (1 year to report, 18 months for supplemental claims) — timing is critical.",
    intro:
      "Florida faces the nation's heaviest hurricane and tropical-storm exposure, has a uniquely strict statewide building code, and tightened its insurance claim deadlines in 2022. All three make timing and documentation especially important.",
    stormProfile:
      "Florida is the most hurricane-exposed state in the country and also sees frequent severe thunderstorms with damaging wind. Hurricane and high-wind events drive roof losses including lifted, torn, and missing shingles or tiles, exposed underlayment, ridge and hip damage, and water intrusion. Wind-driven debris and pressure cycling are common causes of progressive roof failure.",
    codeBasis:
      "Florida uses the statewide Florida Building Code (FBC), one of the most stringent wind-resistance codes in the nation, with the High-Velocity Hurricane Zone provisions applying in Miami-Dade and Broward. Roof repairs and replacements must meet current FBC requirements; confirm the applicable edition for your jurisdiction.",
    deadlineNorms:
      "Florida tightened its property-insurance deadlines with the 2022 reforms (SB 2-A). Under current law (Fla. Stat. 627.70132), a property insurance claim or reopened claim must be reported within one year of the date of loss, and a supplemental claim within 18 months of the date of loss. These shortened windows apply to policies issued or renewed after the reform — confirm the current statute for your loss date; do not assume the older, longer periods apply.",
    matchingRule:
      "Florida does not have a single widely known statewide 'matching' statute equivalent to some other states; like-kind-and-quality outcomes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Florida policies carry a separate hurricane deductible (typically 2%, 5%, or 10% of dwelling coverage) that applies during a declared hurricane, in addition to a standard all-other-perils deductible. This can be a very large number on a higher-value home — check your declarations page.",
    doi: {
      name: "Florida Department of Financial Services (DFS) and Office of Insurance Regulation (OIR)",
      complaintNote:
        "Florida homeowners can seek help and file a complaint through the Department of Financial Services; the Office of Insurance Regulation oversees insurers.",
    },
    faqs: [
      {
        question:
          "How long do I have to file a hurricane roof claim in Florida?",
        answer:
          "Florida shortened its claim-notice deadlines in 2022. Under Fla. Stat. 627.70132, a claim or reopened claim must be reported within one year of the date of loss, and a supplemental claim within 18 months. Check your policy and the current statute for your loss date; do not assume older, longer periods. This is general information, not legal advice.",
      },
      {
        question: "What is a hurricane deductible in Florida?",
        answer:
          "It's a separate deductible (commonly 2%, 5%, or 10% of dwelling coverage) that applies to losses from a declared hurricane, instead of your flat all-other-perils deductible. On a higher-value home it can be tens of thousands of dollars — check your declarations page.",
      },
      {
        question: "Does the Florida Building Code affect my roof claim?",
        answer:
          "Yes. The Florida Building Code is among the strictest in the nation, and a compliant repair or replacement may require code-driven items. Documenting code-required work is often part of a complete claim.",
      },
      {
        question: "How does DumbRoof help with a Florida claim?",
        answer:
          "DumbRoof is software — not a public adjuster or law firm. It turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement with a forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.windDamage, LX.notEnough, LX.howLong, LX.vsPA],
    relatedStates: ["louisiana", "georgia", "alabama"],
  },
  {
    slug: "louisiana",
    state: "Louisiana",
    abbr: "LA",
    region: "Gulf & Hurricane Coast",
    title:
      "Roof Insurance Claim Help in Louisiana: Hurricanes, Deadlines & Supplements (2026)",
    description:
      "Louisiana roof insurance claim guide: hurricane and wind damage, the two-year prescriptive period for first-party claims, named-storm deductibles, the LDI complaint path, and DumbRoof supplements.",
    summary:
      "Heavily hurricane-exposed Gulf state; Louisiana law sets a two-year minimum prescriptive period for first-party claims and uses annual named-storm deductibles.",
    intro:
      "Louisiana takes repeated direct hits from Gulf hurricanes, and its legal deadlines run on Louisiana's unique 'prescription' system. Both shape how a roof claim should be documented and timed.",
    stormProfile:
      "Louisiana is one of the most hurricane-exposed states in the nation, with the entire coast and much of the interior vulnerable to landfalling storms and severe wind. Hurricane and high-wind damage to Louisiana roofs commonly includes lifted, torn, and missing shingles, exposed and damaged underlayment, ridge and flashing damage, and resulting water intrusion.",
    codeBasis:
      "Louisiana residential roofing is governed by the Louisiana State Uniform Construction Code, which is based on the International Residential Code (IRC) with state amendments, including wind provisions reflecting the state's hurricane exposure. Confirm the applicable edition for your jurisdiction.",
    deadlineNorms:
      "Louisiana uses a 'prescription' (liberative-prescription) deadline rather than a typical statute of limitations. Under La. R.S. 22:868, a property insurance contract cannot limit the right of action against the insurer to less than 24 months from the inception of the loss for a first-party claim — so two years from the loss is the floor. Because the applicable period depends on your loss date and policy, confirm the current rules and act promptly.",
    matchingRule:
      "Louisiana does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Many Louisiana policies carry a separate named-storm or hurricane deductible (commonly a percentage of dwelling coverage); by statute it is applied on an annual basis across named-storm/hurricane losses in a calendar year. Check your declarations page so you know your true out-of-pocket exposure.",
    doi: {
      name: "Louisiana Department of Insurance (LDI)",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Louisiana Department of Insurance.",
    },
    faqs: [
      {
        question: "How long do I have to file a roof claim in Louisiana?",
        answer:
          "Louisiana uses 'prescription' deadlines. Under La. R.S. 22:868, a property policy cannot limit a first-party claimant to less than 24 months from the inception of the loss — so two years from the loss is the minimum. Confirm the current rules and your policy terms and act promptly. This is general information, not legal advice.",
      },
      {
        question: "What is a named-storm deductible in Louisiana?",
        answer:
          "It's a separate, often percentage-based deductible that applies when a named storm (like a hurricane) causes your loss, instead of your standard deductible. By Louisiana law it is applied annually across named-storm losses in a calendar year. Check your declarations page for the figure.",
      },
      {
        question: "Does the Louisiana building code affect my roof repair?",
        answer:
          "Yes. The Louisiana State Uniform Construction Code (IRC-based with wind amendments) governs roof work, and code-required items can be part of a complete claim. Confirm the applicable edition for your area.",
      },
      {
        question: "How does DumbRoof help with a Louisiana claim?",
        answer:
          "DumbRoof is software. It builds a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations — from your photos, measurements, and the carrier's estimate. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.windDamage, LX.notEnough, LX.howToFile, LX.vsPA],
    relatedStates: ["texas", "florida", "alabama"],
  },
  {
    slug: "alabama",
    state: "Alabama",
    abbr: "AL",
    region: "Gulf & Hurricane Coast",
    title:
      "Roof Insurance Claim Help in Alabama: Storms, Deadlines & Supplements (2026)",
    description:
      "Alabama roof insurance claim guide: Gulf-coast hurricanes and inland storms, the six-year contract limitations period, the Alabama Department of Insurance complaint path, and DumbRoof supplements.",
    summary:
      "Gulf-coast hurricane exposure plus inland tornado/wind risk; a six-year written-contract limitations period that policies generally cannot shorten.",
    intro:
      "Alabama faces Gulf-coast hurricanes in the south and tornado and wind events inland. A documented supplement is often the difference when a carrier's roof estimate falls short.",
    stormProfile:
      "Alabama's Gulf coast is exposed to landfalling hurricanes, while the rest of the state sits in an active severe-thunderstorm and tornado corridor (sometimes called 'Dixie Alley'). Common roof damage includes wind-lifted and missing shingles, hail bruising and granule loss, ridge and flashing damage, and water intrusion after high-wind events.",
    codeBasis:
      "Alabama residential roofing is generally governed by the International Residential Code (IRC) as adopted by the state and local jurisdictions, with enhanced wind provisions along the coast. Confirm the current edition and amendments with your local building department.",
    deadlineNorms:
      "Alabama's statute of limitations for breach of a written contract is six years, and Alabama law generally voids policy provisions that try to shorten that period — so a property-insurance breach claim generally runs six years from the breach. Bad-faith claims have a shorter (two-year) period. Read your policy and act promptly.",
    matchingRule:
      "Alabama does not have a single widely known statewide 'matching' statute; like-kind-and-quality outcomes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Many coastal Alabama policies carry a separate wind/hail or named-storm deductible, often a percentage of dwelling coverage. Check your declarations page so you understand your real out-of-pocket cost.",
    doi: {
      name: "Alabama Department of Insurance",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Alabama Department of Insurance.",
    },
    faqs: [
      {
        question: "How long do I have to file a roof claim in Alabama?",
        answer:
          "Alabama's written-contract limitations period is six years, and Alabama law generally voids policy terms that try to shorten it — so a breach-of-policy claim generally runs six years from the breach (bad-faith claims have a shorter two-year period). Document and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Is wind and hail damage covered on my Alabama roof?",
        answer:
          "Most Alabama homeowners policies cover sudden wind and hail damage subject to your deductible and terms. Coastal policies may apply a separate wind/hail deductible — check your declarations page.",
      },
      {
        question: "Does the building code matter for my Alabama roof claim?",
        answer:
          "Yes. IRC-based requirements (with coastal wind provisions) can drive code-required items on a compliant repair or replacement, which may be part of a complete claim.",
      },
      {
        question: "How does DumbRoof help with an Alabama claim?",
        answer:
          "DumbRoof is software. It turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.windDamage, LX.notEnough, LX.howToFile, LX.vsXact],
    relatedStates: ["florida", "georgia", "louisiana"],
  },

  // ===================== SOUTHEAST =====================
  {
    slug: "georgia",
    state: "Georgia",
    abbr: "GA",
    region: "Southeast",
    title:
      "Roof Insurance Claim Help in Georgia: Storms, Deadlines & Supplements (2026)",
    description:
      "Georgia roof insurance claim guide: severe storms and coastal wind, claim deadlines, the Georgia insurance commissioner complaint path, and how DumbRoof builds a supplement.",
    summary:
      "Active severe-storm state with coastal hurricane exposure; the IRC (with Georgia amendments) governs roof work and policies may shorten the suit deadline to two years.",
    intro:
      "Georgia sees frequent severe thunderstorms statewide and hurricane exposure along the coast. When a carrier's roof estimate comes in low, a documented supplement is usually the path forward.",
    stormProfile:
      "Georgia experiences frequent severe thunderstorms with damaging wind and hail across the interior and Piedmont, plus tropical-storm and hurricane exposure along the Atlantic coast. Common roof damage includes wind-lifted and missing shingles, hail bruising and granule loss, ridge and flashing damage, and water intrusion.",
    codeBasis:
      "Georgia residential roofing is governed by the Georgia State Minimum Standard Codes, which adopt the International Residential Code (IRC) with Georgia amendments (the 2024 IRC with Georgia amendments took effect January 1, 2026). Confirm the current edition and amendments with your local building department.",
    deadlineNorms:
      "Georgia's general statute of limitations for breach of an insurance contract is six years, but Georgia allows a property policy to shorten the time to sue to no less than the two-year period in the standard Georgia fire policy. Read your policy's suit-limitation clause and file promptly. (Georgia also requires plaintiffs to send the Insurance Commissioner a copy of the demand and complaint within 20 days of filing certain claims.)",
    matchingRule:
      "Georgia does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Many Georgia policies — especially along the coast — carry a separate wind/hail or named-storm deductible, often a percentage of dwelling coverage. Check your declarations page before you file.",
    doi: {
      name: "Georgia Office of Insurance and Safety Fire Commissioner",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Georgia Office of Insurance and Safety Fire Commissioner.",
    },
    faqs: [
      {
        question: "Is storm damage to my Georgia roof covered?",
        answer:
          "Most Georgia homeowners policies cover sudden wind and hail damage subject to your deductible and terms. Coastal policies may apply a separate wind/hail deductible. Disputes usually concern scope and amount.",
      },
      {
        question: "How long do I have to file a roof claim in Georgia?",
        answer:
          "Georgia's breach-of-insurance-contract limitations period is six years, but a property policy can shorten the time to sue to no less than two years (the standard Georgia fire-policy period). Read your policy and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Does the Georgia building code affect my roof repair?",
        answer:
          "Yes. The Georgia State Minimum Standard Codes adopt the IRC with state amendments, and code-required items can be part of a complete claim. Confirm the applicable edition with your local building department.",
      },
      {
        question: "How does DumbRoof help with a Georgia claim?",
        answer:
          "DumbRoof is software. It turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.windDamage, LX.howToFile, LX.vsPA],
    relatedStates: ["alabama", "south-carolina", "florida"],
  },
  {
    slug: "north-carolina",
    state: "North Carolina",
    abbr: "NC",
    region: "Southeast",
    title:
      "Roof Insurance Claim Help in North Carolina: Storms, Deadlines & Supplements (2026)",
    description:
      "North Carolina roof insurance claim guide: hurricanes and severe storms, the three-year limitations period, the NC Department of Insurance complaint path, and how DumbRoof builds a supplement.",
    summary:
      "Coastal hurricane exposure plus inland severe storms; a three-year insurance-contract limitations period that policy clauses generally cannot shorten below state law.",
    intro:
      "North Carolina faces hurricanes along its coast and severe thunderstorms inland. A documented supplement is often what closes the gap when a carrier underpays a roof.",
    stormProfile:
      "North Carolina's coast and Outer Banks are exposed to landfalling and brushing hurricanes, while the Piedmont and mountains see frequent severe thunderstorms with damaging wind and hail. Common roof damage includes wind-lifted and missing shingles, hail bruising and granule loss, ridge and flashing damage, and water intrusion.",
    codeBasis:
      "North Carolina residential roofing is governed by the North Carolina State Building Code; the residential code is based on the International Residential Code with North Carolina amendments. Confirm the current edition and amendments with your local building department.",
    deadlineNorms:
      "North Carolina treats an insurance policy as a contract subject to a three-year statute of limitations (for a fire policy, generally running from the date of loss). North Carolina courts have generally not allowed policies to shorten the limitations period below the statutory three years. Read your policy and file promptly.",
    matchingRule:
      "North Carolina does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Many coastal North Carolina policies carry a separate wind/hail or named-storm/hurricane deductible, often a percentage of dwelling coverage. Check your declarations page so you understand your out-of-pocket exposure.",
    doi: {
      name: "North Carolina Department of Insurance",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the North Carolina Department of Insurance.",
    },
    faqs: [
      {
        question: "How long do I have to file a roof claim in North Carolina?",
        answer:
          "North Carolina treats a policy as a contract with a three-year limitations period (for a fire policy, generally from the date of loss), and courts have generally not enforced shorter policy deadlines. Document and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Is hurricane and wind damage covered on my NC roof?",
        answer:
          "Most North Carolina homeowners policies cover sudden wind and hail damage subject to your deductible and terms. Coastal policies may apply a separate wind/hail or hurricane deductible — check your declarations page.",
      },
      {
        question: "Does the NC building code affect my roof claim?",
        answer:
          "Yes. The North Carolina State Building Code (IRC-based residential code) governs roof work, and code-required items can be part of a complete claim. Confirm the applicable edition with your local building department.",
      },
      {
        question: "How does DumbRoof help with a North Carolina claim?",
        answer:
          "DumbRoof is software. It builds a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations — from your photos, measurements, and the carrier's estimate. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.windDamage, LX.notEnough, LX.howToFile, LX.vsPA],
    relatedStates: ["south-carolina", "georgia", "tennessee"],
  },
  {
    slug: "south-carolina",
    state: "South Carolina",
    abbr: "SC",
    region: "Southeast",
    title:
      "Roof Insurance Claim Help in South Carolina: Storms, Deadlines & Supplements (2026)",
    description:
      "South Carolina roof insurance claim guide: coastal hurricanes and inland storms, the three-year limitations period, the SC Department of Insurance complaint path, and DumbRoof supplements.",
    summary:
      "Atlantic hurricane exposure with regulated coastal wind/hail and hurricane deductibles; a three-year limitations period for actions on an insurance policy.",
    intro:
      "South Carolina's coast is squarely in the Atlantic hurricane track, and the interior sees frequent severe storms. When a carrier's roof estimate is light, a documented supplement is usually the answer.",
    stormProfile:
      "South Carolina's Lowcountry and coast are exposed to landfalling hurricanes and tropical storms, while the Midlands and Upstate see severe thunderstorms with damaging wind and hail. Common roof damage includes wind-lifted and missing shingles, hail bruising and granule loss, ridge and flashing damage, and water intrusion.",
    codeBasis:
      "South Carolina residential roofing is governed by the South Carolina building codes, which adopt the International Residential Code (IRC) with state amendments and enhanced coastal wind provisions. Confirm the current edition with your local building department.",
    deadlineNorms:
      "South Carolina applies a three-year statute of limitations to an action on a policy of insurance (S.C. Code 15-3-530), generally running from the earliest date the insurer could be said to have denied the claim. Your policy may also contain a suit-limitation clause — read it and file promptly.",
    matchingRule:
      "South Carolina does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "South Carolina regulates separate hurricane, named-storm, and wind/hail deductibles (S.C. regulation requires specific disclosures and a warning on the policy face). These deductibles are often a percentage of dwelling coverage — check your declarations page before you file.",
    doi: {
      name: "South Carolina Department of Insurance",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the South Carolina Department of Insurance.",
    },
    faqs: [
      {
        question: "Is hurricane damage to my South Carolina roof covered?",
        answer:
          "Most South Carolina homeowners policies cover sudden wind and hail damage subject to your deductible and terms. Coastal policies often apply a separate, regulated wind/hail or hurricane deductible — check your declarations page.",
      },
      {
        question: "How long do I have to file a roof claim in South Carolina?",
        answer:
          "South Carolina applies a three-year limitations period to actions on an insurance policy (S.C. Code 15-3-530), and your policy may add its own suit-limitation clause. Read your policy and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Does the SC building code affect my roof repair?",
        answer:
          "Yes. South Carolina adopts the IRC with state amendments and coastal wind provisions, and code-required items can be part of a complete claim. Confirm the applicable edition locally.",
      },
      {
        question: "How does DumbRoof help with a South Carolina claim?",
        answer:
          "DumbRoof is software. It turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.windDamage, LX.notEnough, LX.howToFile, LX.vsXact],
    relatedStates: ["north-carolina", "georgia", "florida"],
  },
  {
    slug: "tennessee",
    state: "Tennessee",
    abbr: "TN",
    region: "Southeast",
    title:
      "Roof Insurance Claim Help in Tennessee: Storms, Deadlines & Supplements (2026)",
    description:
      "Tennessee roof insurance claim guide: severe storms and hail, the six-year contract limitations period, the Tennessee Department of Commerce and Insurance complaint path, and DumbRoof supplements.",
    summary:
      "Active severe-storm and 'Dixie Alley' wind/hail risk; a six-year breach-of-contract period that policies can shorten to a reasonable shorter window.",
    intro:
      "Tennessee sits in an active severe-storm corridor with frequent wind and hail. When a carrier's roof estimate falls short, a documented supplement is usually the path to full payment.",
    stormProfile:
      "Tennessee experiences frequent severe thunderstorms, large hail, and tornadoes — parts of the state fall within the 'Dixie Alley' severe-weather corridor. Common roof damage includes hail bruising and granule loss, wind-lifted and creased shingles, missing shingles, and damage to ridge caps, vents, and flashing.",
    codeBasis:
      "Tennessee residential roofing is generally governed by the International Residential Code (IRC) as adopted by the state and local jurisdictions. Confirm the current edition and amendments with your local building department.",
    deadlineNorms:
      "Tennessee's statute of limitations for breach of an insurance contract is generally six years (Tenn. Code Ann. 28-3-109), but a policy may contractually set a shorter, reasonable suit-limitation period that controls. Read your policy's clause and file promptly.",
    matchingRule:
      "Tennessee does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Some Tennessee policies apply a separate wind/hail deductible, often a percentage of dwelling coverage, in hail-prone areas. Check your declarations page so you know what applies to a storm claim.",
    doi: {
      name: "Tennessee Department of Commerce and Insurance",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Tennessee Department of Commerce and Insurance.",
    },
    faqs: [
      {
        question: "Is hail and wind damage to my Tennessee roof covered?",
        answer:
          "Most Tennessee homeowners policies cover sudden wind and hail damage subject to your deductible and terms. Disputes usually concern the scope and amount of repair.",
      },
      {
        question: "How long do I have to file a roof claim in Tennessee?",
        answer:
          "Tennessee's breach-of-insurance-contract limitations period is generally six years, but your policy can set a shorter, reasonable suit-limitation period that controls. Read your policy and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Does the building code matter for my Tennessee roof claim?",
        answer:
          "Yes. IRC-based requirements can drive code-required items on a compliant repair or replacement, which may be part of a complete claim. Confirm the applicable edition with your local building department.",
      },
      {
        question: "How does DumbRoof help with a Tennessee claim?",
        answer:
          "DumbRoof is software. It turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.windDamage, LX.howToFile, LX.vsPA],
    relatedStates: ["north-carolina", "georgia", "missouri"],
  },

  // ===================== MIDWEST & GREAT LAKES =====================
  {
    slug: "missouri",
    state: "Missouri",
    abbr: "MO",
    region: "Midwest & Great Lakes",
    title:
      "Roof Insurance Claim Help in Missouri: Hail, Matching & Supplements (2026)",
    description:
      "Missouri roof insurance claim guide: severe hail and wind, the Missouri matching regulation, the ten-year written-contract period, the DCI complaint path, and how DumbRoof builds a supplement.",
    summary:
      "Severe hail/wind exposure plus a specific insurance matching regulation (20 CSR 100-1.050) and a ten-year written-contract limitations period.",
    intro:
      "Missouri sees frequent severe hail and wind, and it has a specific insurance regulation addressing matching of repaired areas. Both shape how a roof claim should be documented.",
    stormProfile:
      "Missouri lies in an active severe-weather region with frequent large hail, damaging straight-line wind, and tornadoes. NOAA/SPC climatology shows Missouri among the more hail-active states. Common roof damage includes hail bruising and granule loss, fractured shingle mats, wind-lifted and missing shingles, and damage to ridge caps, vents, and flashing.",
    codeBasis:
      "Missouri residential roofing is generally governed by the International Residential Code (IRC) as adopted at the local level; Missouri leaves much residential building-code adoption to municipalities and counties. Confirm the current edition and amendments with your local building department.",
    deadlineNorms:
      "Missouri's statute of limitations for an action on a written contract for the payment of money or property is generally ten years (Section 516.110(1), RSMo), and Missouri treats policy provisions that try to set a shorter period contrary to that statute as against public policy. Even so, read your policy and file promptly.",
    matchingRule:
      "Missouri has a specific insurance regulation addressing matching: 20 CSR 100-1.050 (standards for prompt, fair, and equitable settlement) addresses replacing items so a repaired area presents a reasonably uniform appearance with adjacent areas. This can support a fuller replacement when a partial repair would not reasonably match — confirm the current regulatory language and how it applies to your loss.",
    deductibleNorms:
      "Many Missouri homeowners policies apply a separate wind/hail deductible, often a percentage of dwelling coverage, given the state's hail exposure. Check your declarations page before you file.",
    doi: {
      name: "Missouri Department of Commerce and Insurance (DCI)",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Missouri Department of Commerce and Insurance.",
    },
    faqs: [
      {
        question: "Does Missouri have a roof 'matching' rule?",
        answer:
          "Missouri's claims-settlement regulation (20 CSR 100-1.050) addresses replacing items so a repaired area reasonably matches adjacent areas. It can support a fuller replacement when a partial repair would not reasonably match. Confirm the current language; this is general information, not legal advice.",
      },
      {
        question: "How long do I have to file a roof claim in Missouri?",
        answer:
          "Missouri's written-contract limitations period is generally ten years (RSMo 516.110(1)), and Missouri treats shorter policy deadlines contrary to that statute as against public policy. Document and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Is hail damage to my Missouri roof covered?",
        answer:
          "Most Missouri homeowners policies cover sudden hail and wind damage subject to your deductible and terms. A separate wind/hail deductible may apply — check your declarations page.",
      },
      {
        question: "How does DumbRoof help with a Missouri claim?",
        answer:
          "DumbRoof is software. It builds a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations — from your photos, measurements, and the carrier's estimate. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.notEnough, LX.howToFile, LX.vsPA],
    relatedStates: ["kansas", "oklahoma", "illinois"],
  },
  {
    slug: "minnesota",
    state: "Minnesota",
    abbr: "MN",
    region: "Midwest & Great Lakes",
    title:
      "Roof Insurance Claim Help in Minnesota: Hail, Matching & Supplements (2026)",
    description:
      "Minnesota roof insurance claim guide: severe hail, the Minnesota matching statute (65A.10), claim deadlines, the Commerce Department complaint path, and DumbRoof supplements.",
    summary:
      "Severe hail/wind exposure plus a specific statutory matching protection (Minn. Stat. 65A.10) for replacement-cost claims.",
    intro:
      "Minnesota sees major hail and wind events, and it has one of the clearest statutory matching protections in the country. Both shape how a roof claim should be built.",
    stormProfile:
      "Minnesota experiences frequent severe thunderstorms with large hail and damaging wind, and it has seen some of the costliest hail events in the Upper Midwest in NOAA/SPC climatology. Common roof damage includes hail bruising and granule loss, fractured shingle mats, wind-lifted and missing shingles, and damage to ridge caps, vents, and flashing.",
    codeBasis:
      "Minnesota residential roofing is governed by the Minnesota State Building Code, which adopts the International Residential Code (IRC) with Minnesota amendments (including cold-climate provisions). Confirm the current edition with your local building department.",
    deadlineNorms:
      "Minnesota's general statute of limitations for a contract action is six years, and policies commonly include a shorter, reasonable suit-limitation clause. Read your policy's clause and file promptly. Note that Minnesota's matching statute (65A.10) also governs how a replacement-cost loss is settled.",
    matchingRule:
      "Minnesota has a specific statutory matching protection: Minn. Stat. 65A.10 requires that, when a covered loss requires replacement of items and the replaced items do not match adjacent items in quality, color, or size, the insurer must replace items in adjacent areas so the property reasonably matches. This is a strong tool when a partial repair would not reasonably match — confirm the current statutory language and how it applies.",
    deductibleNorms:
      "Many Minnesota homeowners policies apply a separate wind/hail deductible, often a percentage of dwelling coverage, given the state's hail exposure. Check your declarations page before you file.",
    doi: {
      name: "Minnesota Department of Commerce",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Minnesota Department of Commerce.",
    },
    faqs: [
      {
        question: "Does Minnesota have a roof 'matching' law?",
        answer:
          "Yes. Minnesota Statute 65A.10 requires insurers to replace items in adjacent areas so the property reasonably matches when replaced items would not otherwise match in quality, color, or size. It can support a full replacement when a partial repair would not reasonably match. Confirm the current language; this is general information, not legal advice.",
      },
      {
        question: "How long do I have to file a roof claim in Minnesota?",
        answer:
          "Minnesota's general contract limitations period is six years, but your policy may contain a shorter, reasonable suit-limitation clause that controls. Read your policy and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Is hail damage to my Minnesota roof covered?",
        answer:
          "Most Minnesota homeowners policies cover sudden hail and wind damage subject to your deductible and terms. A separate wind/hail deductible may apply — check your declarations page.",
      },
      {
        question: "How does DumbRoof help with a Minnesota claim?",
        answer:
          "DumbRoof is software. It builds a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations — from your photos, measurements, and the carrier's estimate. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.notEnough, LX.howToFile, LX.vsPA],
    relatedStates: ["nebraska", "missouri", "illinois"],
  },
  {
    slug: "illinois",
    state: "Illinois",
    abbr: "IL",
    region: "Midwest & Great Lakes",
    title:
      "Roof Insurance Claim Help in Illinois: Storms, Deadlines & Supplements (2026)",
    description:
      "Illinois roof insurance claim guide: severe storms and hail, the ten-year written-contract period, the Illinois Department of Insurance complaint path, and how DumbRoof builds a supplement.",
    summary:
      "Active severe-storm and hail exposure; a ten-year written-contract period that policies usually shorten via a reasonable suit-limitation clause.",
    intro:
      "Illinois sees frequent severe thunderstorms with hail and damaging wind. When a carrier's roof estimate falls short, a documented supplement is usually the path to full payment.",
    stormProfile:
      "Illinois experiences frequent severe thunderstorms, large hail, derecho-type wind events, and tornadoes across the state. NOAA/SPC climatology shows Illinois among the more storm-active Midwestern states. Common roof damage includes hail bruising and granule loss, fractured shingle mats, wind-lifted and missing shingles, and damage to ridge caps, vents, and flashing.",
    codeBasis:
      "Illinois residential roofing is generally governed by the International Residential Code (IRC) as adopted at the local level; Illinois leaves much residential building-code adoption to municipalities (Chicago has its own code). Confirm the current edition and amendments with your local building department.",
    deadlineNorms:
      "Illinois's statute of limitations for a written contract is generally ten years (735 ILCS 5/13-206), but Illinois allows policies to contractually shorten that to a reasonable shorter period, and Illinois also tolls the deadline for the time between proof of loss and the insurer's denial. Rely on your policy's clause and file promptly.",
    matchingRule:
      "Illinois does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Some Illinois homeowners policies apply a separate wind/hail deductible, often a percentage of dwelling coverage, in hail-prone areas. Check your declarations page so you know what applies to a storm claim.",
    doi: {
      name: "Illinois Department of Insurance",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Illinois Department of Insurance.",
    },
    faqs: [
      {
        question: "Is storm damage to my Illinois roof covered?",
        answer:
          "Most Illinois homeowners policies cover sudden wind and hail damage subject to your deductible and terms. Disputes usually concern the scope and amount of repair.",
      },
      {
        question: "How long do I have to file a roof claim in Illinois?",
        answer:
          "Illinois's written-contract limitations period is generally ten years (735 ILCS 5/13-206), but policies can shorten it to a reasonable period; Illinois also tolls the clock between proof of loss and denial. Document and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Does the building code matter for my Illinois roof claim?",
        answer:
          "Yes. IRC-based requirements (or Chicago's code, where applicable) can drive code-required items on a compliant repair or replacement. Confirm the applicable edition with your local building department.",
      },
      {
        question: "How does DumbRoof help with an Illinois claim?",
        answer:
          "DumbRoof is software. It turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.windDamage, LX.howToFile, LX.vsXact],
    relatedStates: ["missouri", "minnesota", "ohio"],
  },
  {
    slug: "ohio",
    state: "Ohio",
    abbr: "OH",
    region: "Midwest & Great Lakes",
    title:
      "Roof Insurance Claim Help in Ohio: Storms, Deadlines & Supplements (2026)",
    description:
      "Ohio roof insurance claim guide: severe storms and hail, short policy suit-limitation deadlines (often one year), the Ohio Department of Insurance complaint path, and DumbRoof supplements.",
    summary:
      "Active severe-storm and hail exposure; Ohio courts uphold short (often one-year) policy suit-limitation clauses — timing matters.",
    intro:
      "Ohio sees frequent severe thunderstorms with hail and damaging wind, and many Ohio policies carry short suit-limitation deadlines. Both make prompt, thorough documentation important.",
    stormProfile:
      "Ohio experiences frequent severe thunderstorms, hail, and damaging straight-line wind (including derechos) across the state. Common roof damage includes hail bruising and granule loss, fractured shingle mats, wind-lifted and missing shingles, and damage to ridge caps, vents, and flashing.",
    codeBasis:
      "Ohio residential roofing is governed by the Residential Code of Ohio, which is based on the International Residential Code (IRC) with Ohio amendments. Confirm the current edition with your local building department.",
    deadlineNorms:
      "Ohio's general statute of limitations for a written contract is six years, but Ohio expressly allows property insurance policies to shorten the time to sue, and the Ohio Supreme Court has upheld a one-year suit-limitation clause running from the date of loss. Read your policy's suit-limitation clause carefully and act promptly; do not assume a longer window applies.",
    matchingRule:
      "Ohio does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Some Ohio homeowners policies apply a separate wind/hail deductible, often a percentage of dwelling coverage, in hail-prone areas. Check your declarations page so you know what applies to a storm claim.",
    doi: {
      name: "Ohio Department of Insurance",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Ohio Department of Insurance.",
    },
    faqs: [
      {
        question: "How long do I have to file a roof claim in Ohio?",
        answer:
          "Ohio allows policies to shorten the time to sue, and the Ohio Supreme Court has upheld a one-year suit-limitation clause from the date of loss — shorter than the six-year general contract period. Read your policy and act promptly. This is general information, not legal advice.",
      },
      {
        question: "Is hail and wind damage to my Ohio roof covered?",
        answer:
          "Most Ohio homeowners policies cover sudden hail and wind damage subject to your deductible and terms. Disputes usually concern the scope and amount of repair.",
      },
      {
        question: "Does the Residential Code of Ohio affect my roof claim?",
        answer:
          "Yes. The Residential Code of Ohio (IRC-based) governs roof work, and code-required items can be part of a complete claim. Confirm the applicable edition with your local building department.",
      },
      {
        question: "How does DumbRoof help with an Ohio claim?",
        answer:
          "DumbRoof is software. It turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.notEnough, LX.howLong, LX.vsPA],
    relatedStates: ["illinois", "pennsylvania", "missouri"],
  },

  // ===================== NORTHEAST =====================
  {
    slug: "new-york",
    state: "New York",
    abbr: "NY",
    region: "Northeast",
    title:
      "Roof Insurance Claim Help in New York: Storms, Deadlines & Supplements (2026)",
    description:
      "New York roof insurance claim guide: wind and hail storms, the two-year standard-fire-policy suit-limitation norm, the DFS complaint path, the RCNYS code basis, and DumbRoof supplements.",
    summary:
      "Wind, hail, and coastal storm exposure; New York's standard fire policy carries a two-year suit-limitation provision that courts generally enforce.",
    intro:
      "New York roofs face wind, hail, nor'easters, and coastal storms, and the state's standard fire policy sets a two-year suit-limitation norm. Both make prompt, well-documented claims important.",
    stormProfile:
      "New York sees damaging thunderstorm wind and hail upstate, plus nor'easters, tropical-storm remnants, and coastal wind events downstate and on Long Island. Common roof damage includes wind-lifted and missing shingles, hail bruising and granule loss, ridge and flashing damage, ice-related damage in cold months, and water intrusion.",
    codeBasis:
      "New York residential roofing is governed by the Residential Code of New York State (RCNYS), which is based on the International Residential Code (IRC) with New York amendments. (New York City has its own Construction Codes.) Confirm the applicable code for your jurisdiction.",
    deadlineNorms:
      "New York's general contract limitations period is six years, but New York's standard fire-insurance policy includes a two-year suit-limitation provision requiring any lawsuit to be brought within two years of the loss, and New York courts generally enforce reasonable suit-limitation clauses. Read your policy's suit-limitation clause and file promptly.",
    matchingRule:
      "New York does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts (and on the unfair-claims-practices standards in Insurance Regulation 64). Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Some New York policies — particularly downstate and on the coast — carry a separate windstorm or hurricane deductible, often a percentage of dwelling coverage, that can be triggered by named storms. Check your declarations page before you file.",
    doi: {
      name: "New York State Department of Financial Services (DFS)",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the New York State Department of Financial Services.",
    },
    faqs: [
      {
        question: "How long do I have to file a roof claim in New York?",
        answer:
          "New York's standard fire policy includes a two-year suit-limitation provision, so many policies require a lawsuit within two years of the loss, and courts generally enforce reasonable clauses. Read your policy and act promptly. This is general information, not legal advice.",
      },
      {
        question: "Is wind and hail damage to my New York roof covered?",
        answer:
          "Most New York homeowners policies cover sudden wind and hail damage subject to your deductible and terms. Downstate/coastal policies may apply a separate windstorm or hurricane deductible — check your declarations page.",
      },
      {
        question: "Does the RCNYS building code affect my roof claim?",
        answer:
          "Yes. The Residential Code of New York State (IRC-based, or NYC's Construction Codes in the city) governs roof work, and code-required items can be part of a complete claim. Confirm the applicable code for your area.",
      },
      {
        question: "How does DumbRoof help with a New York claim?",
        answer:
          "DumbRoof is software. It builds a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations — from your photos, measurements, and the carrier's estimate. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.windDamage, LX.notEnough, LX.howToFile, LX.vsPA],
    relatedStates: ["pennsylvania", "ohio"],
  },
  {
    slug: "pennsylvania",
    state: "Pennsylvania",
    abbr: "PA",
    region: "Northeast",
    title:
      "Roof Insurance Claim Help in Pennsylvania: Storms, Deadlines & Supplements (2026)",
    description:
      "Pennsylvania roof insurance claim guide: wind and hail storms, the four-year contract limitations period, the PA Insurance Department complaint path, the UCC code basis, and how DumbRoof builds a supplement.",
    summary:
      "Wind, hail, and remnant-storm exposure; a four-year breach-of-contract period that policies may shorten to a not-manifestly-unreasonable shorter window.",
    intro:
      "Pennsylvania roofs face wind, hail, and the remnants of tropical systems. When a carrier's roof estimate is light, a documented supplement is usually the path to full payment.",
    stormProfile:
      "Pennsylvania experiences damaging thunderstorm wind and hail across the state, plus flooding and wind from tropical-storm remnants and occasional nor'easters and ice events. Common roof damage includes wind-lifted and missing shingles, hail bruising and granule loss, ridge and flashing damage, and water intrusion.",
    codeBasis:
      "Pennsylvania residential roofing is governed by the Pennsylvania Uniform Construction Code (UCC), which adopts the International Residential Code (IRC) statewide (with the option for some municipalities to opt out of enforcement). Confirm the current edition and local enforcement with your municipality.",
    deadlineNorms:
      "Pennsylvania's statute of limitations for breach of a written contract is four years, but Pennsylvania allows the parties to shorten that by written agreement (42 Pa.C.S. 5501) as long as the shortened period is not 'manifestly unreasonable,' and the clock generally runs from the time of loss. Read your policy's suit-limitation clause and file promptly.",
    matchingRule:
      "Pennsylvania does not have a single widely known statewide 'matching' statute; like-kind-and-quality disputes generally turn on policy language and the facts. Document why a partial repair cannot reasonably match.",
    deductibleNorms:
      "Some Pennsylvania policies apply a separate wind/hail deductible, often a percentage of dwelling coverage, in storm-prone areas. Check your declarations page so you know what applies to a storm claim.",
    doi: {
      name: "Pennsylvania Insurance Department",
      complaintNote:
        "If your claim was underpaid or mishandled, you can file a consumer complaint with the Pennsylvania Insurance Department.",
    },
    faqs: [
      {
        question: "How long do I have to file a roof claim in Pennsylvania?",
        answer:
          "Pennsylvania's written-contract limitations period is four years, but policies may shorten it by written agreement (42 Pa.C.S. 5501) so long as the period is not manifestly unreasonable, and the clock generally runs from the loss. Document and file promptly. This is general information, not legal advice.",
      },
      {
        question: "Is wind and hail damage to my Pennsylvania roof covered?",
        answer:
          "Most Pennsylvania homeowners policies cover sudden wind and hail damage subject to your deductible and terms. A separate wind/hail deductible may apply — check your declarations page.",
      },
      {
        question: "Does the PA Uniform Construction Code affect my roof claim?",
        answer:
          "Yes. The Pennsylvania UCC (IRC-based) governs roof work, and code-required items can be part of a complete claim. Confirm the current edition and local enforcement with your municipality.",
      },
      {
        question: "How does DumbRoof help with a Pennsylvania claim?",
        answer:
          "DumbRoof is software. It turns your photos, measurements, and the carrier's estimate into a carrier-ready supplement — forensic report, Xactimate-style estimate, scope comparison, and code citations. You or your contractor submit it.",
      },
    ],
    crossLinks: [LX.hailShingles, LX.windDamage, LX.howToFile, LX.vsPA],
    relatedStates: ["new-york", "ohio"],
  },
];

// ----- Lookup helpers (mirror comparisons.ts conventions) ----------------

export function getLocation(slug: string): Location | undefined {
  return LOCATIONS.find((l) => l.slug === slug);
}

export function allLocationSlugs(): string[] {
  return LOCATIONS.map((l) => l.slug);
}

export function locationsByRegion(): Record<LocationRegion, Location[]> {
  const grouped = {} as Record<LocationRegion, Location[]>;
  for (const region of LOCATION_REGION_ORDER) {
    grouped[region] = LOCATIONS.filter((l) => l.region === region);
  }
  return grouped;
}

export function relatedLocations(slug: string): Location[] {
  const loc = getLocation(slug);
  if (!loc) return [];
  return loc.relatedStates
    .map((s) => getLocation(s))
    .filter((l): l is Location => Boolean(l));
}

/** Base path for the locations cluster (hub + all state leaves). */
export const LOCATIONS_BASE_PATH = "/roof-insurance-claim-help";

export function locationPath(slug: string): string {
  return `${LOCATIONS_BASE_PATH}/${slug}`;
}
