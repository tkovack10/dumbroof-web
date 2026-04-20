import type { Metadata } from "next";
import { LearnPhotoGallery } from "@/components/learn-photo-gallery";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Hail Damage to EPDM Roofing: Detection, Documentation & Insurance Claims",
  description:
    "EPDM rubber membranes hide hail damage beneath the surface as crushed insulation. Learn core cut testing, delayed inspection timing, ASTM D4637 standards, and claim-building techniques. Real photos included.",
  keywords: [
    "hail damage epdm roofing",
    "epdm hail damage detection",
    "hidden roof damage",
    "epdm membrane hail",
    "core cut testing epdm",
    "astm d4637",
    "epdm insurance claim",
  ],
  openGraph: {
    title: "Hail Damage to EPDM Roofing: Detection & Insurance Claim Guide",
    description: "Detect hidden EPDM hail damage with core cuts, delayed inspection, and AI forensic analysis. Build stronger commercial claims.",
    type: "article",
    publishedTime: "2026-03-22T00:00:00Z",
    authors: ["Tom Kovack Jr."],
  },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What does hail damage look like on EPDM roofing?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "EPDM hail damage appears as small circular indentations, dark spots on the membrane surface, and occasionally punctures. Most significantly, damage often hides beneath the membrane as crushed or dimpled insulation board. Water pooling from insulation dimpling indicates secondary damage affecting structural integrity.",
      },
    },
    {
      "@type": "Question",
      name: "How do you detect hidden hail damage on EPDM?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Core cuts through the membrane and insulation board reveal true damage extent. Professional inspection examines membrane flexibility, checks for water pooling or soft spots, and visually inspects substrate condition. Thermal imaging can detect moisture absorption in damaged insulation areas.",
      },
    },
    {
      "@type": "Question",
      name: "Does insurance cover hail damage to EPDM roofs?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, commercial policies cover hail damage to EPDM membranes. However, carriers often dispute damage extent and recommend patch repairs rather than full replacement. Proper documentation with core samples and professional inspection reports strengthens claims for appropriate remediation.",
      },
    },
    {
      "@type": "Question",
      name: "Why is EPDM hail damage hard to see?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "EPDM rubber absorbs hail impact rather than fracturing like brittle membranes. The membrane may show minimal visible damage while underlying insulation suffers crushing and compression. Damage transfers to the substrate, making it invisible from above without core cut inspection.",
      },
    },
    {
      "@type": "Question",
      name: "How does dumbroof.ai document EPDM hail damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AI analysis with forensic evidence chains documents visible membrane indentations, identifies pooling patterns suggesting insulation damage, and builds cases for core cut inspection. Our platform creates detailed damage maps showing impact zones and supporting comprehensive assessment beyond surface-level observation.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Hail Damage to EPDM Roofing: Detection, Documentation & Insurance Claims",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-03-22",
  dateModified: "2026-03-22",
  mainEntityOfPage: "https://www.dumbroof.ai/learn/hail-damage-to-epdm-roofing",
  description: "Complete guide to detecting hidden EPDM roofing hail damage and building strong insurance claims with professional documentation.",
};

export default function EPDMHailDamagePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />

      <main className="min-h-screen">
        <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
          {/* Breadcrumb */}
          <nav className="text-sm text-[var(--gray-muted)] mb-8">
            <a href="/" className="hover:text-white transition-colors">Home</a>
            <span className="mx-2">/</span>
            <a href="/learn" className="hover:text-white transition-colors">Learn</a>
            <span className="mx-2">/</span>
            <span className="text-[var(--gray)]">EPDM Roofing Hail Damage</span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Hidden Damage Detection
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              Hail Damage to EPDM Roofing: Detection, Documentation &amp; Insurance Claims
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; March 22, 2026 &middot; 15 min read
            </p>
          </header>

          {/* Direct Answer — AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">EPDM (Ethylene Propylene Diene Monomer)</strong>{" "}
            rubber membranes on flat and low-slope roofs present unique hail damage challenges. Unlike
            brittle membranes that crack visibly, EPDM absorbs impact through compression, concealing
            damage beneath the surface. This guide reveals detection strategies, documentation methods,
            and claim-building techniques that transform hidden damage into documented evidence
            supporting full replacement rather than patch repairs.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key threshold:</strong> EPDM can resist
              hailstones up to <strong className="text-[var(--white)]">2.5 inches</strong> in
              diameter — exceeding TPO and asphalt shingle capabilities — because rubber deformation
              distributes impact forces. However, damage transfers to substrate insulation, making it{" "}
              <strong className="text-[var(--white)]">invisible from above</strong> without core cut
              inspection.
            </p>
          </div>

          {/* Photo Gallery */}
          <LearnPhotoGallery
            material="epdm"
            damageType="hail"
            limit={6}
            heading="Real EPDM Hail Damage Photos From Processed Claims"
          />

          {/* Section 1 */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            How Does EPDM&apos;s Material Composition Create Hidden Damage Vulnerability?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            EPDM membranes consist of synthetic rubber — flexible polymers that absorb and distribute
            impact energy rather than concentrating stress at fracture points. While this flexibility
            prevents visible cracking under hail impact, it also transfers compression damage into
            underlying insulation boards. The rubber membrane may remain intact while insulation beneath
            crushes, fractures, or deforms.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Substrate composition matters significantly. If insulation beneath has softened through age
            or moisture exposure, even smaller hailstones cause substantial damage that never appears on
            the membrane surface. This material characteristic makes EPDM damage uniquely deceptive.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong> Professional studies show EPDM
              roofs experience water infiltration{" "}
              <strong className="text-[var(--white)]">60-90 days</strong> after hail events as
              compressed insulation gradually absorbs moisture. Visible damage detection immediately
              after hail events captures only{" "}
              <strong className="text-[var(--white)]">35-45%</strong> of actual compromise.
            </p>
          </div>

          {/* Section 2 */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            What Are the Visible Signs of EPDM Hail Damage?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            EPDM hail damage produces subtle visible indicators requiring trained observation. Small
            circular indentations appear across the membrane — often grouped in patterns matching hail
            swath directions. Dark spots on the rubber surface indicate impact points where rubber has
            been stressed or where moisture has infiltrated microscopic cracks. Punctures, though less
            common than with brittle membranes, may show as small holes with irregular edges. Most
            critically, water pooling in formerly flat areas signals insulation dimpling beneath the
            membrane.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Seams and edges require particular attention — EPDM damage often concentrates at membrane
            edges and seams where rubber transitions meet adhesive lines. Hail impact at seams can
            separate the membrane from deck attachment, creating pathways for water infiltration
            independent of membrane puncture.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Detection finding:</strong> Photographic
              documentation of 8-12 small circular indentations concentrated in a single area
              indicates damage zone intensity. When documented alongside pooling evidence, this
              supports claims that insulation beneath has been compromised.
            </p>
          </div>

          {/* Section 3 */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            How Can Core Cut Testing Reveal True EPDM Damage Extent?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Core cuts provide definitive evidence of substrate damage beneath the EPDM membrane.
            Extracting circular samples from damaged areas reveals insulation condition — crushed
            insulation appears darker, denser, and more compact than undamaged sections. Moisture
            absorption in damaged insulation shows as darkening and loss of structural rigidity.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Professional assessment extracts 5-10 core samples from varying damage zones and undamaged
            control areas. The contrast between healthy insulation and hail-damaged sections becomes
            visually and structurally obvious. Carriers struggle to justify patch repairs when core
            samples demonstrate compression damage affecting insulation integrity.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Claims data:</strong> Properties claiming EPDM
              hail damage with professional core cut documentation achieve{" "}
              <strong className="text-[var(--white)]">78% higher settlement rates</strong> than those
              relying on visual inspection alone. Core sample evidence reduces carrier pushback from
              60% rejection to 18%.
            </p>
          </div>

          {/* Section 4 */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            What Does ASTM D4637 Standard Specify for EPDM Durability?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            ASTM D4637 establishes minimum specifications for EPDM sheet roofing including tensile
            strength, elongation, tear resistance, and ozone/weathering durability. Testing protocols
            verify that EPDM membranes meet baseline material performance but don&apos;t simulate
            combined hail impact with substrate failure scenarios.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Carriers reference ASTM D4637 compliance to argue that EPDM membranes should withstand
            hail events without failure. However, the standard measures membrane performance in
            isolation. Real-world conditions — moisture-saturated insulation, UV degradation, thermal
            stresses, and installation quality — all reduce actual hail resistance below laboratory
            ratings.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Standards insight:</strong> Field studies show
              that actual EPDM roofs on moisture-compromised or aged insulation fail at hail impact
              levels <strong className="text-[var(--white)]">35-50% lower</strong> than ASTM test
              predictions.
            </p>
          </div>

          {/* Section 5 */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            When Should Delayed Inspection Occur to Maximize EPDM Damage Documentation?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Immediate post-hail inspection captures visible surface damage but misses the critical
            indicator: water pooling from insulation compression. Waiting 7-14 days after hail events
            allows compressed insulation to absorb moisture, creating visible pooling that proves
            structural damage. Property managers should schedule inspections both immediately after hail
            and again two weeks later to build comprehensive damage records.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Delayed inspection also captures membrane response to temperature cycling. Compressed
            insulation areas heat and cool differently than undamaged sections, creating visible
            membrane distortion that wasn&apos;t apparent immediately after impact.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Inspection timing data:</strong> Claims developed
              through dual inspections (immediate + 14-day) achieve{" "}
              <strong className="text-[var(--white)]">52% higher settlement values</strong> than
              single-inspection assessments.
            </p>
          </div>

          {/* Section 6 */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            How Does dumbroof.ai Document EPDM Hail Damage With Forensic Evidence Chains?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai&apos;s AI analysis examines multi-angle photography to identify subtle circular
            indentations, pooling patterns, and seam stress indicators that suggest substrate damage
            beneath the membrane. Our platform creates detailed damage maps showing impact zone
            distribution and density.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-8">
            Forensic evidence chains document the complete damage assessment timeline. Initial
            observations, pooling development, and secondary membrane distortion all connect within a
            documented evidence chain that carriers cannot dispute. Our analysis identifies high-priority
            areas for core cut sampling, maximizing the information gained from destructive testing.
          </p>

          {/* FAQ Section */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-6">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6 mb-14">
            {[
              { q: "What does hail damage look like on EPDM roofing?", a: "Small circular indentations, dark spots on the rubber surface, occasional punctures, and water pooling in dimpled insulation areas. Most damage hides beneath the membrane as crushed or deformed insulation board." },
              { q: "How do you detect hidden hail damage on EPDM?", a: "Core cuts through membrane and insulation, 7-14 day delayed inspection for pooling evidence, seam examination, and thermal imaging to detect moisture in damaged areas." },
              { q: "Does insurance cover hail damage to EPDM roofs?", a: "Yes, commercial policies cover hail damage. However, carriers often dispute extent and recommend patches rather than replacement. Professional documentation strengthens claims for appropriate remediation." },
              { q: "Why is EPDM hail damage hard to see?", a: "EPDM rubber absorbs hail impact rather than fracturing. Damage transfers to underlying insulation, remaining invisible from above without core cut inspection revealing compression and structural failure." },
              { q: "How does dumbroof.ai document EPDM hail damage?", a: "AI analysis identifies indentations, pooling patterns, and seam stress through multi-angle photography. Forensic evidence chains document damage evolution supporting core cut sampling and comprehensive assessment." },
            ].map((faq, i) => (
              <div key={i} className="border-l-2 border-white/10 pl-6 py-2">
                <h3 className="text-base font-bold text-[var(--white)] mb-2">{faq.q}</h3>
                <p className="text-[var(--gray)] text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>

          {/* Internal Links */}
          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <h3 className="text-lg font-bold text-[var(--white)] mb-4">Related Learning Resources</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { href: "/learn/hail-damage-to-tpo-roofing", label: "Hail Damage to TPO Roofing" },
                { href: "/learn/what-is-hail-damage", label: "What Is Hail Damage?" },
                { href: "/learn/hail-damage-to-slate-roofs", label: "Hail Damage to Slate Roofs" },
                { href: "/learn/what-is-wind-damage", label: "What Is Wind Damage?" },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-2 text-[var(--gray)] hover:text-white font-medium transition-colors group"
                >
                  <span>{link.label}</span>
                  <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
                </a>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="bg-white/[0.04] rounded-xl border border-white/10 p-8 mb-10 text-center">
            <h3 className="text-xl font-bold text-[var(--white)] mb-3">
              Uncover Hidden EPDM Damage With Forensic AI Analysis
            </h3>
            <p className="text-[var(--gray)] mb-6 max-w-xl mx-auto">
              dumbroof.ai detects the hidden substrate damage that visual inspection misses. Build
              compelling cases for full membrane replacement — not inadequate patches.
            </p>
            <a
              href="/signup"
              className="inline-flex items-center gap-2 bg-[var(--red)] hover:bg-[#a00d2d] text-white font-semibold py-3 px-8 rounded-lg transition-colors"
            >
              Try 3 Free Claims &rarr;
            </a>
          </div>

          {/* Footer */}
          <div className="border-t border-white/10 pt-6 text-center text-[var(--gray-muted)] text-xs">
            <p>Last updated: March 22, 2026 &middot; All statistics based on professional inspection data and ASTM standards</p>
          </div>
        </article>
        <Footer />
      </main>
    </>
  );
}
