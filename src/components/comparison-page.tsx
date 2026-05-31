/**
 * Shared layout for a single /compare/<slug> comparison page. Server
 * component — no client state. Renders the visible chrome (breadcrumb,
 * header, direct answer, body sections, comparison table, "use them
 * together" note, bottom line, FAQ, cross-links, CTA) plus the Article,
 * BreadcrumbList, and FAQPage JSON-LD. Each page file supplies its own
 * metadata + content via props so the structure stays identical and AEO-clean.
 */
import { Footer } from "@/components/footer";
import { JsonLd } from "@/components/json-ld";
import { article, breadcrumbList, faqPage } from "@/lib/seo/schema";

export type TableRow = {
  /** Row label (the dimension being compared). */
  feature: string;
  /** DumbRoof's answer for this dimension. */
  dumbroof: string;
  /** The other tool/approach's answer for this dimension. */
  other: string;
};

export type Section = {
  id: string;
  heading: string;
  /** Paragraphs of body copy. Plain strings — rendered as <p>. */
  paragraphs: string[];
};

export type Faq = { question: string; answer: string };

export type ComparisonPageProps = {
  /** Leaf breadcrumb label, e.g. "vs Roofr". */
  breadcrumbLabel: string;
  /** Slug path, e.g. "/compare/dumbroof-vs-roofr". */
  path: string;
  /** Kicker above the H1. */
  eyebrow: string;
  /** The single H1. */
  h1: string;
  /** Article headline for schema (often === h1). */
  headline: string;
  /** Meta/schema description. */
  description: string;
  /** The lead "direct answer" paragraph (rendered with a bold lead-in). */
  directAnswerLead: string;
  directAnswerBody: string;
  /** Label for the "other" column header in the table. */
  otherLabel: string;
  /** Caption above the comparison table. */
  tableCaption: string;
  tableRows: TableRow[];
  /** Body sections (H2 + paragraphs). */
  sections: Section[];
  /** "When to choose DumbRoof" bullets. */
  chooseDumbroof: string[];
  /** "When to choose the other / use the other" bullets. */
  chooseOther: { heading: string; items: string[] };
  /** Optional "use them together" note (for complementary tools). */
  togetherNote?: string;
  /** The bottom-line verdict paragraph(s). */
  bottomLine: string[];
  faqs: Faq[];
  /** Related comparison links: { href, label, kicker }. */
  relatedComparisons: { href: string; label: string; kicker: string }[];
  /** Related learn guide links. */
  relatedLearn: { href: string; label: string; kicker: string }[];
  /** CTA heading + body. */
  ctaHeading: string;
  ctaBody: string;
  /** CTA destination ("/" | "/sample" | "/signup" etc.). */
  ctaHref: string;
  ctaLabel: string;
};

export function ComparisonPage(props: ComparisonPageProps) {
  const faqSchema = faqPage(
    props.faqs.map((f) => ({ question: f.question, answer: f.answer }))
  );
  const articleSchema = article({
    headline: props.headline,
    description: props.description,
    path: props.path,
    datePublished: "2026-05-31",
    dateModified: "2026-05-31",
  });
  const breadcrumbSchema = breadcrumbList([
    { name: "Home", path: "/" },
    { name: "Compare", path: "/compare" },
    { name: props.breadcrumbLabel, path: props.path },
  ]);

  return (
    <>
      <JsonLd data={faqSchema} />
      <JsonLd data={articleSchema} />
      <JsonLd data={breadcrumbSchema} />

      <main className="min-h-screen">
        <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
          {/* Breadcrumb */}
          <nav className="text-sm text-[var(--gray-muted)] mb-8">
            <a href="/" className="hover:text-white transition-colors">
              Home
            </a>
            <span className="mx-2">/</span>
            <a href="/compare" className="hover:text-white transition-colors">
              Compare
            </a>
            <span className="mx-2">/</span>
            <span className="text-[var(--gray)]">{props.breadcrumbLabel}</span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              {props.eyebrow}
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              {props.h1}
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              Updated May 31, 2026 &middot; DumbRoof comparison guide
            </p>
          </header>

          {/* Direct Answer — AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">
              {props.directAnswerLead}
            </strong>{" "}
            {props.directAnswerBody}
          </p>

          {/* Comparison Table */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="at-a-glance"
          >
            {props.tableCaption}
          </h2>
          <div className="overflow-x-auto mb-10 rounded-xl border border-white/10">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-white/[0.04]">
                  <th
                    scope="col"
                    className="text-left font-semibold text-[var(--white)] p-4 border-b border-white/10 align-top"
                  >
                    Dimension
                  </th>
                  <th
                    scope="col"
                    className="text-left font-semibold text-[var(--white)] p-4 border-b border-white/10 align-top"
                  >
                    DumbRoof
                  </th>
                  <th
                    scope="col"
                    className="text-left font-semibold text-[var(--white)] p-4 border-b border-white/10 align-top"
                  >
                    {props.otherLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {props.tableRows.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={i % 2 === 1 ? "bg-white/[0.02]" : undefined}
                  >
                    <th
                      scope="row"
                      className="text-left font-medium text-[var(--white)] p-4 border-b border-white/5 align-top"
                    >
                      {row.feature}
                    </th>
                    <td className="text-[var(--gray)] p-4 border-b border-white/5 align-top leading-relaxed">
                      {row.dumbroof}
                    </td>
                    <td className="text-[var(--gray-muted)] p-4 border-b border-white/5 align-top leading-relaxed">
                      {row.other}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Body sections */}
          {props.sections.map((section) => (
            <section key={section.id}>
              <h2
                className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
                id={section.id}
              >
                {section.heading}
              </h2>
              {section.paragraphs.map((p, i) => (
                <p
                  key={i}
                  className="text-[var(--gray)] leading-relaxed mb-4"
                >
                  {p}
                </p>
              ))}
            </section>
          ))}

          {/* When to choose which */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="when-to-choose"
          >
            When to Choose Which
          </h2>
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="glass-card p-5">
              <p className="font-semibold text-[var(--white)] text-sm mb-3">
                Choose DumbRoof when&hellip;
              </p>
              <div className="space-y-2">
                {props.chooseDumbroof.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 text-sm text-[var(--gray)]"
                  >
                    <span className="text-green-500 mt-0.5 shrink-0">
                      &#x2713;
                    </span>
                    <span className="leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-card p-5">
              <p className="font-semibold text-[var(--white)] text-sm mb-3">
                {props.chooseOther.heading}
              </p>
              <div className="space-y-2">
                {props.chooseOther.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 text-sm text-[var(--gray)]"
                  >
                    <span className="text-[var(--cyan)] mt-0.5 shrink-0">
                      &#x2192;
                    </span>
                    <span className="leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Use them together */}
          {props.togetherNote && (
            <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
              <p className="text-sm text-[var(--gray)] leading-relaxed">
                <strong className="text-[var(--white)]">
                  Use them together:
                </strong>{" "}
                {props.togetherNote}
              </p>
            </div>
          )}

          {/* Bottom line */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="bottom-line"
          >
            Bottom Line: Which Should You Choose?
          </h2>
          {props.bottomLine.map((p, i) => (
            <p key={i} className="text-[var(--gray)] leading-relaxed mb-4">
              {p}
            </p>
          ))}

          {/* FAQ */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-6"
            id="faq"
          >
            Frequently Asked Questions
          </h2>
          <div className="space-y-4 mb-10">
            {props.faqs.map((faq) => (
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

          {/* Related */}
          <div className="mt-14">
            <h3 className="text-lg font-bold text-[var(--white)] mb-4">
              Related Comparisons
            </h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              {props.relatedComparisons.map((rel) => (
                <a
                  key={rel.href}
                  href={rel.href}
                  className="glass-card p-5 hover:border-white/30 transition-colors"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                    {rel.kicker}
                  </span>
                  <p className="text-sm font-semibold text-[var(--white)] mt-1">
                    {rel.label}
                  </p>
                </a>
              ))}
            </div>
            <h3 className="text-lg font-bold text-[var(--white)] mb-4">
              Related Guides
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {props.relatedLearn.map((rel) => (
                <a
                  key={rel.href}
                  href={rel.href}
                  className="glass-card p-5 hover:border-white/30 transition-colors"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                    {rel.kicker}
                  </span>
                  <p className="text-sm font-semibold text-[var(--white)] mt-1">
                    {rel.label}
                  </p>
                </a>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="bg-gradient-to-r from-[var(--pink)]/10 via-[var(--purple)]/10 to-[var(--blue)]/10 border border-white/10 rounded-2xl p-8 text-center mt-14">
            <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
              {props.ctaHeading}
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              {props.ctaBody}
            </p>
            <a
              href={props.ctaHref}
              className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
            >
              {props.ctaLabel}
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
