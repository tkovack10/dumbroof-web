/**
 * Shared layout for a single /roof-insurance-claim-help/<state> page. Server
 * component — no client state. Mirrors comparison-page.tsx in structure and
 * design tokens (var(--gray)/var(--white)/glass-card, wrapped in <main> +
 * <Footer/>) and emits Article + BreadcrumbList + FAQPage + WebPage JSON-LD via
 * the shared builders. All per-state facts come from the verified locations.ts
 * catalog; nothing is fabricated here. A plain "not legal advice" line renders
 * wherever legal facts appear. NO LocalBusiness schema — DumbRoof is national
 * software with no per-state office.
 */
import { Footer } from "@/components/footer";
import { JsonLd } from "@/components/json-ld";
import {
  type Location,
  LOCATION_DISCLAIMER,
  locationPath,
  relatedLocations,
} from "@/lib/seo/locations";
import { SITE } from "@/lib/seo/site";
import { article, breadcrumbList, faqPage, webPage } from "@/lib/seo/schema";

const HUB_PATH = "/roof-insurance-claim-help";
const HUB_LABEL = "Roof Insurance Claim Help";

export function LocationPage({ location }: { location: Location }) {
  const path = locationPath(location.slug);
  const related = relatedLocations(location.slug);

  const faqSchema = faqPage(
    location.faqs.map((f) => ({ question: f.question, answer: f.answer }))
  );
  const articleSchema = article({
    headline: location.title,
    description: location.description,
    path,
    datePublished: "2026-05-31",
    dateModified: "2026-05-31",
  });
  const breadcrumbSchema = breadcrumbList([
    { name: "Home", path: "/" },
    { name: HUB_LABEL, path: HUB_PATH },
    { name: location.state, path },
  ]);
  const webPageSchema = webPage({
    name: location.title,
    description: location.description,
    path,
  });

  return (
    <>
      <JsonLd data={faqSchema} />
      <JsonLd data={articleSchema} />
      <JsonLd data={breadcrumbSchema} />
      <JsonLd data={webPageSchema} />

      <main className="min-h-screen">
        <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
          {/* Breadcrumb */}
          <nav className="text-sm text-[var(--gray-muted)] mb-8">
            <a href="/" className="hover:text-white transition-colors">
              Home
            </a>
            <span className="mx-2">/</span>
            <a href={HUB_PATH} className="hover:text-white transition-colors">
              {HUB_LABEL}
            </a>
            <span className="mx-2">/</span>
            <span className="text-[var(--gray)]">{location.state}</span>
          </nav>

          <header className="mb-10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              {location.region}
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              Roof Insurance Claim Help in {location.state}
            </h1>
            <p className="text-lg text-[var(--gray)] leading-relaxed">
              {location.intro}
            </p>
            <p className="text-[var(--gray-muted)] text-sm mt-3">
              Updated May 31, 2026 &middot; DumbRoof state claim guide
            </p>
          </header>

          {/* Storm profile */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="storm-profile"
          >
            {location.state} storm, hail &amp; wind profile
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            {location.stormProfile}
          </p>

          {/* Claim + supplement process */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="claim-process"
          >
            The roof claim &amp; supplement process in {location.state}
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Most {location.state} roof disputes are not about whether storm
            damage is covered — they are about scope and amount. Carriers often
            issue an initial estimate that misses damaged components, uses
            incorrect measurements, or omits code-required items. The fix is a
            documented{" "}
            <strong className="text-[var(--white)]">supplement</strong>: a
            side-by-side accounting of what the roof actually needs versus what
            the carrier paid, backed by photos, accurate measurements, and code
            citations.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A strong supplement package typically includes a forensic causation
            report (tying the damage to the storm), a line-by-line
            Xactimate-style estimate at local pricing, a scope comparison against
            the carrier&apos;s estimate, and the applicable building-code
            requirements. You or your contractor submit it to the carrier for
            review.
          </p>

          {/* Verified state-specific facts */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="state-facts"
          >
            {location.state} facts that affect your roof claim
          </h2>

          <div className="space-y-5 mb-6">
            <div className="glass-card p-5">
              <p className="font-semibold text-[var(--white)] text-sm mb-2">
                Building / roofing code basis
              </p>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                {location.codeBasis}
              </p>
            </div>
            <div className="glass-card p-5">
              <p className="font-semibold text-[var(--white)] text-sm mb-2">
                Claim &amp; suit-limitation deadlines
              </p>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                {location.deadlineNorms}
              </p>
            </div>
            <div className="glass-card p-5">
              <p className="font-semibold text-[var(--white)] text-sm mb-2">
                Matching / like-kind-and-quality
              </p>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                {location.matchingRule}
              </p>
            </div>
            <div className="glass-card p-5">
              <p className="font-semibold text-[var(--white)] text-sm mb-2">
                Wind, hail &amp; storm deductibles
              </p>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                {location.deductibleNorms}
              </p>
            </div>
            <div className="glass-card p-5">
              <p className="font-semibold text-[var(--white)] text-sm mb-2">
                Department of Insurance &amp; complaints
              </p>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                Your state regulator is the{" "}
                <strong className="text-[var(--gray)]">
                  {location.doi.name}
                </strong>
                . {location.doi.complaintNote}
              </p>
            </div>
          </div>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-5 mb-6">
            <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
              {LOCATION_DISCLAIMER}
            </p>
          </div>

          {/* Where DumbRoof fits */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="where-dumbroof-fits"
          >
            Where DumbRoof fits in {location.state}
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            {SITE.name} is AI software for roofing contractors — and helpful to
            homeowners — operated by USA Roof Masters and used nationally. It is{" "}
            <strong className="text-[var(--white)]">not</strong> a public
            adjuster, not a law firm, and not a per-state office. You give it a
            roof inspection with photos, measurements, and the carrier&apos;s
            estimate, and it produces a carrier-ready supplement package — a
            forensic causation report, an Xactimate-style estimate, a scope
            comparison, and building-code citations — in minutes. An AI assistant
            named Richard guides the process. You or your contractor review and
            submit the package.
          </p>
          <div className="flex flex-wrap gap-3 mb-4">
            <a
              href="/sample"
              className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-3 rounded-xl text-sm font-semibold transition-colors"
            >
              View a sample package
            </a>
            <a
              href="/"
              className="inline-block glass-card px-6 py-3 rounded-xl text-sm font-semibold text-[var(--white)] hover:border-white/30 transition-colors"
            >
              See how DumbRoof works
            </a>
          </div>

          {/* FAQ (visible + JSON-LD) */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-6"
            id="faq"
          >
            {location.state} roof insurance claim FAQ
          </h2>
          <div className="space-y-4 mb-10">
            {location.faqs.map((faq) => (
              <div key={faq.question} className="glass-card p-5">
                <h3 className="text-sm font-semibold text-[var(--white)] mb-2">
                  {faq.question}
                </h3>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                  {faq.answer}
                </p>
              </div>
            ))}
          </div>

          {/* Cross-links */}
          <h3 className="text-lg font-bold text-[var(--white)] mb-4">
            Keep reading
          </h3>
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            {location.crossLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="glass-card p-5 hover:border-white/30 transition-colors"
              >
                <p className="text-sm font-semibold text-[var(--white)]">
                  {link.label}
                </p>
              </a>
            ))}
            <a
              href={HUB_PATH}
              className="glass-card p-5 hover:border-white/30 transition-colors"
            >
              <p className="text-sm font-semibold text-[var(--white)]">
                All states: Roof Insurance Claim Help
              </p>
            </a>
          </div>

          {related.length > 0 && (
            <>
              <h3 className="text-lg font-bold text-[var(--white)] mb-4">
                Related states
              </h3>
              <div className="flex flex-wrap gap-3 mb-8">
                {related.map((r) => (
                  <a
                    key={r.slug}
                    href={locationPath(r.slug)}
                    className="glass-card px-4 py-2 rounded-lg text-sm font-medium text-[var(--gray)] hover:text-white hover:border-white/30 transition-colors"
                  >
                    {r.state}
                  </a>
                ))}
              </div>
            </>
          )}

          {/* CTA */}
          <div className="bg-gradient-to-r from-[var(--pink)]/10 via-[var(--purple)]/10 to-[var(--blue)]/10 border border-white/10 rounded-2xl p-8 text-center mt-14">
            <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
              Underpaid roof claim in {location.state}?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              Turn your photos, measurements, and the carrier&apos;s estimate
              into a carrier-ready supplement package in minutes.
            </p>
            <a
              href="/sample"
              className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
            >
              View a Sample Report
            </a>
            <p className="text-xs text-[var(--gray-dim)] mt-3">
              No credit card required
            </p>
          </div>
        </article>

        <Footer />
      </main>
    </>
  );
}
