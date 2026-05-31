/**
 * Catalog of the /compare comparison pages. Mirrors LEARN_GUIDES in shape so
 * the compare hub, sitemap (via PUBLIC_ROUTES), and llms.txt all read from one
 * source and can never drift. One entry per page; `slug` maps to
 * src/app/compare/<slug>/page.tsx.
 *
 * `category` drives the hub's section grouping. `breadcrumb` is the leaf label
 * reused for BreadcrumbList structured data. `summary` powers the hub cards +
 * llms.txt one-liners.
 */
export const COMPARISONS = [
  // --- Category / approach comparisons ---
  {
    slug: "dumbroof-vs-hiring-a-public-adjuster",
    title:
      "DumbRoof vs Hiring a Public Adjuster: Which Is Right for Roofing Claims? (2026)",
    breadcrumb: "vs Public Adjuster",
    category: "Approaches",
    summary:
      "Software you run yourself vs a licensed professional you hire on contingency — cost, control, and when each makes sense.",
  },
  {
    slug: "dumbroof-vs-diy-roof-claim-supplement",
    title:
      "DumbRoof vs DIY Roof Claim Supplement: Build It Yourself or Automate It? (2026)",
    breadcrumb: "vs DIY Supplement",
    category: "Approaches",
    summary:
      "Hand-building a supplement in spreadsheets and Word vs AI-generating a forensic, code-cited package in minutes.",
  },
  {
    slug: "best-xactimate-alternative-for-roofers",
    title:
      "Best Xactimate Alternative for Roofers: Xactimate-Style Estimates Without the Learning Curve (2026)",
    breadcrumb: "Best Xactimate Alternative",
    category: "Approaches",
    summary:
      "Xactimate is the carrier-side estimating standard. Here is how roofers produce Xactimate-style supplement estimates without mastering the software.",
  },
  // --- Named competitors / adjacent tools ---
  {
    slug: "dumbroof-vs-roofr",
    title:
      "DumbRoof vs Roofr: Which Is Right for Roofing Insurance Claims? (2026)",
    breadcrumb: "vs Roofr",
    category: "Tools",
    summary:
      "Roofr is a roofing sales/measurement and proposal platform; DumbRoof is insurance-supplement software. Where each fits and how they overlap.",
  },
  {
    slug: "dumbroof-vs-acculynx",
    title:
      "DumbRoof vs AccuLynx: CRM vs Insurance Supplement Software (2026)",
    breadcrumb: "vs AccuLynx",
    category: "Tools",
    summary:
      "AccuLynx is a roofing CRM that runs the whole business; DumbRoof builds the carrier-ready supplement. Use them together, not instead.",
  },
  {
    slug: "dumbroof-vs-jobnimbus",
    title:
      "DumbRoof vs JobNimbus: CRM vs Insurance Supplement Software (2026)",
    breadcrumb: "vs JobNimbus",
    category: "Tools",
    summary:
      "JobNimbus is a roofing CRM and project pipeline; DumbRoof generates the forensic supplement. How the two complement each other.",
  },
  {
    slug: "dumbroof-vs-companycam",
    title:
      "DumbRoof vs CompanyCam: Photo Documentation vs Supplement Generation (2026)",
    breadcrumb: "vs CompanyCam",
    category: "Tools",
    summary:
      "CompanyCam captures and organizes job-site photos; DumbRoof turns those photos plus the carrier scope into a supplement. Better together.",
  },
  {
    slug: "dumbroof-vs-eagleview",
    title:
      "DumbRoof vs EagleView: Aerial Measurements vs Supplement Software (2026)",
    breadcrumb: "vs EagleView",
    category: "Tools",
    summary:
      "EagleView delivers aerial roof measurements; DumbRoof uses measurements (from EagleView or elsewhere) to build the estimate and supplement.",
  },
  {
    slug: "dumbroof-vs-hover",
    title:
      "DumbRoof vs Hover: 3D Property Measurements vs Supplement Software (2026)",
    breadcrumb: "vs Hover",
    category: "Tools",
    summary:
      "Hover builds 3D measurement models from phone photos; DumbRoof consumes measurements to generate the forensic supplement package.",
  },
  {
    slug: "dumbroof-vs-symbility",
    title:
      "DumbRoof vs Symbility: Carrier Estimating Platform vs Supplement Software (2026)",
    breadcrumb: "vs Symbility",
    category: "Tools",
    summary:
      "Symbility is a claims-estimating platform used on the carrier side; DumbRoof is contractor-side software that builds the supplement to send back.",
  },
  {
    slug: "dumbroof-vs-servicetitan",
    title:
      "DumbRoof vs ServiceTitan: Field-Service Platform vs Roofing Supplement Software (2026)",
    breadcrumb: "vs ServiceTitan",
    category: "Tools",
    summary:
      "ServiceTitan is a broad field-service management platform; DumbRoof is purpose-built for roofing insurance supplements. Where each belongs.",
  },
] as const;

export type Comparison = (typeof COMPARISONS)[number];
