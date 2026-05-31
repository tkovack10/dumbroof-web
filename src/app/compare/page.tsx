import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbList, webPage } from "@/lib/seo/schema";
import { absoluteUrl } from "@/lib/seo/site";
import { COMPARISONS } from "@/lib/seo/comparisons";

export const metadata: Metadata = {
  title: "DumbRoof Comparisons — Supplement Software vs Alternatives",
  description:
    "How DumbRoof compares to public adjusters, DIY supplements, Xactimate, and tools like Roofr, AccuLynx, JobNimbus, CompanyCam, EagleView, Hover, Symbility, and ServiceTitan. Honest, factual breakdowns of where each tool fits in a roofing insurance claim.",
  alternates: { canonical: absoluteUrl("/compare") },
  keywords: [
    "DumbRoof comparison",
    "best Xactimate alternative for roofers",
    "roofing supplement software comparison",
    "DumbRoof vs Roofr",
    "DumbRoof vs AccuLynx",
    "DumbRoof vs JobNimbus",
    "DumbRoof vs CompanyCam",
    "DumbRoof vs EagleView",
    "DumbRoof vs public adjuster",
    "roofing claim software comparison",
  ],
  openGraph: {
    title: "DumbRoof Comparisons — Supplement Software vs Alternatives",
    description:
      "Honest, factual comparisons of DumbRoof against public adjusters, DIY supplements, Xactimate, and adjacent roofing software.",
    type: "website",
  },
};

const collectionSchema = {
  ...webPage({
    name: "DumbRoof Comparisons",
    description:
      "Comparisons of DumbRoof against public adjusters, DIY supplements, Xactimate, and adjacent roofing and claims software.",
    path: "/compare",
  }),
  "@type": "CollectionPage",
  hasPart: COMPARISONS.map((c) => ({
    "@type": "WebPage",
    name: c.title,
    url: absoluteUrl(`/compare/${c.slug}`),
    description: c.summary,
  })),
};

const breadcrumbSchema = breadcrumbList([
  { name: "Home", path: "/" },
  { name: "Compare", path: "/compare" },
]);

const CATEGORY_ORDER = ["Approaches", "Tools"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  Approaches: "Approaches to a Supplement",
  Tools: "DumbRoof vs Other Roofing & Claims Tools",
};
const CATEGORY_BLURB: Record<string, string> = {
  Approaches:
    "Different ways to get a roof claim supplemented — and where AI software fits among them.",
  Tools:
    "Many of these are complementary: measurements and photos feed into DumbRoof, and a CRM can sit alongside it. Here is what each tool is actually built to do.",
};

export default function CompareIndex() {
  return (
    <main className="min-h-screen">
      <JsonLd data={collectionSchema} />
      <JsonLd data={breadcrumbSchema} />

      <section className="pt-16 pb-10 px-6 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--white)] mb-4">
          DumbRoof Comparisons
        </h1>
        <p className="text-[var(--gray-muted)] max-w-2xl mx-auto text-lg leading-relaxed">
          DumbRoof is AI software that turns roof inspection photos,
          measurements, and the carrier&apos;s estimate into a carrier-ready
          insurance <strong className="text-[var(--gray)]">supplement</strong>{" "}
          package — a forensic causation report, an Xactimate-style line-item
          estimate, a scope comparison, and building-code citations. These
          guides compare that job honestly against public adjusters, the DIY
          route, Xactimate itself, and the other tools roofers already use.
          Many of them aren&apos;t competitors at all — they feed into DumbRoof.
        </p>
      </section>

      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto space-y-12">
          {CATEGORY_ORDER.map((cat) => {
            const items = COMPARISONS.filter((c) => c.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <h2 className="text-xl font-bold text-[var(--white)] mb-1">
                  {CATEGORY_LABEL[cat]}
                </h2>
                <p className="text-sm text-[var(--gray-muted)] mb-4 max-w-2xl leading-relaxed">
                  {CATEGORY_BLURB[cat]}
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  {items.map((c) => (
                    <a
                      key={c.slug}
                      href={`/compare/${c.slug}`}
                      className="block glass-card p-6 hover:border-white/30 transition-colors group"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                        {c.breadcrumb}
                      </span>
                      <h3 className="text-base font-bold text-[var(--white)] mt-1 group-hover:text-[var(--cyan)] transition-colors leading-snug">
                        {c.title}
                      </h3>
                      <p className="text-sm text-[var(--gray-muted)] mt-2 leading-relaxed">
                        {c.summary}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Cross-link to Learn */}
      <section className="pb-12 px-6 text-center">
        <p className="text-sm text-[var(--gray-muted)]">
          Want the underlying claims knowledge instead of a head-to-head?{" "}
          <a
            href="/learn"
            className="text-[var(--cyan)] hover:underline font-medium"
          >
            Browse the Learn guides &rarr;
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
