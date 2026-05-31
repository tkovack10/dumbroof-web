import type { Metadata } from "next";

import { Footer } from "@/components/footer";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbList, webPage } from "@/lib/seo/schema";
import { absoluteUrl } from "@/lib/seo/site";
import {
  LOCATION_REGION_ORDER,
  LOCATIONS,
  locationsByRegion,
  locationPath,
} from "@/lib/seo/locations";

const HUB_PATH = "/roof-insurance-claim-help";

const TITLE =
  "Roof Insurance Claim Help by State: Storms, Deadlines & Supplements (2026)";
const DESCRIPTION =
  "State-by-state roof insurance claim guides for the top storm, hail, and wind states. Verified building-code, claim-deadline, matching, and Department of Insurance facts — plus how DumbRoof builds a carrier-ready supplement.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(HUB_PATH) },
  keywords: [
    "roof insurance claim help by state",
    "hail damage roof claim",
    "hurricane roof insurance claim",
    "roof claim deadline by state",
    "roof insurance supplement",
    "wind and hail deductible",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
  },
};

const collectionSchema = {
  ...webPage({
    name: "Roof Insurance Claim Help by State",
    description: DESCRIPTION,
    path: HUB_PATH,
  }),
  "@type": "CollectionPage",
  hasPart: LOCATIONS.map((loc) => ({
    "@type": "WebPage",
    name: `Roof Insurance Claim Help in ${loc.state}`,
    url: absoluteUrl(locationPath(loc.slug)),
    description: loc.summary,
  })),
};

const breadcrumbSchema = breadcrumbList([
  { name: "Home", path: "/" },
  { name: "Roof Insurance Claim Help", path: HUB_PATH },
]);

const REGION_BLURBS: Record<string, string> = {
  "Hail Alley":
    "Texas, Oklahoma, Kansas, and Nebraska sit in the core of 'hail alley' — the most hail-battered region in the United States — and the Colorado Front Range is one of its costliest hail corridors.",
  "Gulf & Hurricane Coast":
    "Florida, Louisiana, and Alabama face the nation's heaviest hurricane and named-storm exposure, often with percentage hurricane and wind deductibles.",
  Southeast:
    "Georgia and the Carolinas combine coastal hurricane risk with active inland severe-thunderstorm, wind, and hail seasons.",
  "Midwest & Great Lakes":
    "Missouri, Minnesota, Illinois, and Ohio see severe hail and damaging straight-line wind — and several have notable matching rules or short suit-limitation clauses.",
  Northeast:
    "New York and Pennsylvania face wind, hail, nor'easters, and tropical-storm remnants, often with short policy suit-limitation deadlines.",
};

export default function RoofInsuranceClaimHelpHub() {
  const grouped = locationsByRegion();

  return (
    <main className="min-h-screen">
      <JsonLd data={collectionSchema} />
      <JsonLd data={breadcrumbSchema} />

      {/* Breadcrumb */}
      <div className="max-w-4xl mx-auto px-6 pt-10">
        <nav className="text-sm text-[var(--gray-muted)]">
          <a href="/" className="hover:text-white transition-colors">
            Home
          </a>
          <span className="mx-2">/</span>
          <span className="text-[var(--gray)]">Roof Insurance Claim Help</span>
        </nav>
      </div>

      <section className="pt-8 pb-10 px-6 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--white)] mb-4">
          Roof Insurance Claim Help by State
        </h1>
        <p className="text-[var(--gray-muted)] max-w-2xl mx-auto text-lg leading-relaxed">
          Storm damage, claim deadlines, and what your insurer owes you vary by
          state. These guides cover the top hail, wind, and hurricane states —
          with the building-code basis, claim-deadline norms, any matching rules,
          hurricane and wind deductibles, and the Department of Insurance
          complaint path for each. Where a fact could not be verified to current
          detail, we keep it general and true rather than risk being specific and
          wrong.
        </p>
        <p className="text-sm text-[var(--gray-muted)] max-w-2xl mx-auto mt-4 leading-relaxed">
          DumbRoof is AI software (operated by USA Roof Masters) that turns a
          roof inspection, photos, measurements, and the carrier&apos;s estimate
          into a carrier-ready supplement package in minutes. It is not a public
          adjuster or law firm, and these pages are general information, not legal
          advice.
        </p>
      </section>

      <section className="pb-16 px-6">
        <div className="max-w-4xl mx-auto space-y-12">
          {LOCATION_REGION_ORDER.map((region) => (
            <div key={region}>
              <h2 className="text-xl font-bold text-[var(--white)] mb-1">
                {region}
              </h2>
              {REGION_BLURBS[region] && (
                <p className="text-sm text-[var(--gray-muted)] mb-4 max-w-2xl leading-relaxed">
                  {REGION_BLURBS[region]}
                </p>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                {grouped[region].map((loc) => (
                  <a
                    key={loc.slug}
                    href={locationPath(loc.slug)}
                    className="block glass-card p-6 hover:border-white/30 transition-colors group"
                  >
                    <h3 className="text-base font-bold text-[var(--white)] group-hover:text-[var(--cyan)] transition-colors">
                      {loc.state}
                    </h3>
                    <p className="text-sm text-[var(--gray-muted)] mt-2 leading-relaxed">
                      {loc.summary}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Cross-links to other hubs */}
      <section className="pb-12 px-6 text-center">
        <p className="text-sm text-[var(--gray-muted)]">
          Want the underlying claims knowledge?{" "}
          <a
            href="/learn"
            className="text-[var(--cyan)] hover:underline font-medium"
          >
            Browse the Learn guides &rarr;
          </a>{" "}
          or{" "}
          <a
            href="/compare"
            className="text-[var(--cyan)] hover:underline font-medium"
          >
            see the DumbRoof comparisons &rarr;
          </a>
        </p>
      </section>

      {/* CTA */}
      <section className="pb-20 px-6 text-center">
        <div className="glass-card max-w-2xl mx-auto p-10">
          <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
            See What DumbRoof Produces
          </h2>
          <p className="text-[var(--gray-muted)] mb-6">
            Upload your photos, measurements, and the carrier estimate. Get a
            forensic supplement package in minutes — no Xactimate license
            required.
          </p>
          <a
            href="/sample"
            className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
          >
            View a Sample Report
          </a>
          <p className="text-xs text-[var(--gray-dim)] mt-3">
            Or start free — no credit card required
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
