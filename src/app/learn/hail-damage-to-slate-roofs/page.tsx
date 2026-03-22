import type { Metadata } from "next";
import { LearnPhotoGallery } from "@/components/learn-photo-gallery";

export const metadata: Metadata = {
  title: "Hail Damage to Slate Roofs: Identification, Repair & Insurance Claims",
  description:
    "Slate roofs react to hail differently than asphalt—fractures are often linear rather than circular. Learn how to identify slate hail damage, navigate repair costs, and manage insurance claim disputes with dumbroof.ai.",
  keywords: [
    "slate roof hail damage",
    "slate roof damage identification",
    "slate roof repair cost",
    "hail damage slate tiles",
    "slate roof insurance claim",
    "slate roof fracture patterns",
    "slate roof replacement",
  ],
  openGraph: {
    type: "article",
    title: "Hail Damage to Slate Roofs: Identification, Repair & Insurance Claims",
    description:
      "Slate roofs react to hail differently than asphalt—fractures are often linear rather than circular. Learn how to identify slate hail damage, navigate repair costs, and manage insurance claim disputes.",
  },
};

const FAQSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What does hail damage look like on a slate roof?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Hail damage on newer slate (<20 years) typically appears as linear fractures rather than circular bullet holes. Older, weathered slate (30+ years) may show traditional circular impact patterns. Look for fresh breaks identified by lack of aging or dirt on the exposed slate underneath. Both edge breaks and body breaks are valid hail damage indicators.",
      },
    },
    {
      "@type": "Question",
      name: "Can slate roofs be repaired after hail damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, slate roofs can be repaired if damage is below 10% of slates in a section. Repairs use two methods: slate hook (visible from ground) or copper bib (less visible, more labor). If more than 10% of slates are damaged, full section replacement is typically required due to matching requirements and structural integrity.",
      },
    },
    {
      "@type": "Question",
      name: "Does insurance cover hail damage to slate roofs?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, homeowners insurance covers hail damage to slate roofs under dwelling protection. However, carriers frequently dispute slate claims by arguing pre-existing weathering rather than new hail damage. Strong documentation showing fresh damage (exposed interior slate) and professional forensic analysis are essential to overcome carrier denials.",
      },
    },
    {
      "@type": "Question",
      name: "How much does slate roof hail repair cost?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Slate roof hail repair costs $15-$30+ per square foot depending on slate grade, regional labor rates, and repair method. Full section replacement is substantially more expensive. By comparison, asphalt roof repair costs $3-7 per square foot, making slate damage significantly more expensive to remediate.",
      },
    },
    {
      "@type": "Question",
      name: "How does dumbroof.ai document slate hail damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "dumbroof.ai uses AI forensic analysis to distinguish fresh hail damage from pre-existing weathering by capturing damage characteristics, fresh fracture patterns, exposed slate color contrast, and building code citations specific to slate roofing. This documentation overrides carrier arguments about age-related deterioration.",
      },
    },
  ],
};

const ArticleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Hail Damage to Slate Roofs: Identification, Repair & Insurance Claims",
  description:
    "Slate roofs react to hail differently than asphalt—fractures are often linear rather than circular. Learn how to identify slate hail damage, navigate repair costs, and manage insurance claim disputes.",
  image: "https://dumbroof.ai/og-learn.png",
  author: {
    "@type": "Organization",
    name: "dumbroof.ai",
    url: "https://dumbroof.ai",
  },
  publisher: {
    "@type": "Organization",
    name: "dumbroof.ai",
    logo: {
      "@type": "ImageObject",
      url: "https://dumbroof.ai/logo.png",
    },
  },
  datePublished: "2026-03-22",
  dateModified: "2026-03-22",
};

export default function SlateHailDamagePage() {
  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ArticleSchema) }}
      />

      {/* Breadcrumb */}
      <section className="px-6 py-4 border-b border-white/10">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-[var(--gray-muted)]">
            <a href="/learn" className="hover:text-white transition-colors">
              Learn
            </a>
            <span>/</span>
            <span className="text-white">Slate Roof Hail Damage</span>
          </div>
        </div>
      </section>

      {/* Header */}
      <section className="px-6 pt-12 pb-8">
        <div className="max-w-4xl mx-auto">
          <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-[var(--red)] mb-3">
            Material-Specific
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-[var(--white)] mb-6 leading-tight">
            Hail Damage to Slate Roofs: Identification, Repair & Insurance Claims
          </h1>

          {/* Direct Answer */}
          <div className="glass-card p-6 mb-10">
            <p className="text-lg text-[var(--gray-muted)] leading-relaxed">
              Slate is a natural stone that reacts to hail impact differently than asphalt or metal roofing. Newer slate (less than 20 years old) typically shows linear fractures rather than the circular "bullet hole" patterns seen in traditional asphalt damage. Older, weathered slate may display more classic circular impact marks. Fresh hail damage on slate is identified by the lack of aging or dirt buildup on newly exposed slate underneath fractures—a critical distinction that separates new damage from pre-existing weathering that insurance carriers often use to deny claims.
            </p>
          </div>
        </div>
      </section>

      {/* Photo Gallery */}
      <section className="px-6 pb-12">
        <div className="max-w-4xl mx-auto">
          <LearnPhotoGallery
            damageType="hail"
            material="slate"
            limit={6}
            heading="Real Slate Hail Damage Examples"
          />
        </div>
      </section>

      {/* Content */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto space-y-12">
          {/* Section 1 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              What does hail damage look like on a slate roof?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Hail damage appearance on slate depends heavily on slate age. Newer slate (less than 20 years old) is harder and more brittle, displaying linear fracture patterns—straight breaks that radiate from impact points rather than circular deformations. Older, weathered slate (30+ years) may show traditional circular impact patterns similar to asphalt shingles. The critical diagnostic is freshness: newly damaged slate exposes the raw interior stone, which appears lighter in color and lacks the dirt, moss, or patina accumulation visible on aged exposed surfaces. Both edge breaks and body breaks qualify as hail damage indicators. The fracture pattern visibility also varies with elevation and light angle—damage may be nearly invisible from ground level but obvious upon close roof inspection.
            </p>
          </div>

          {/* Section 2 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How is slate hail damage different from other roof types?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Slate's crystalline mineral structure causes it to fracture linearly under hail impact rather than denting or deforming like asphalt or metal. Asphalt shingles typically show circular "hail bruises" or deformations in the granule surface; metal roofing shows dents. Slate cracks or splits along natural fault lines in the stone. This material difference means the damage pattern is visually distinct and requires specialized knowledge to distinguish from pre-existing weathering damage. Carriers exploit this complexity by claiming damage is age-related deterioration rather than new hail impact—a defense that fails when proper forensic documentation proves fracture freshness.
            </p>
          </div>

          {/* Stat block 1 */}
          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Material & Age Impact
            </div>
            <p className="text-xl text-[var(--white)] font-bold">
              Newer slate (&lt;20 years): Linear fractures, harder material. Older slate (30+ years): Circular impact patterns, weathered surface. Both types vulnerable to hail, but damage signatures differ.
            </p>
          </div>

          {/* Section 3 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How do you identify fresh hail damage vs. pre-existing weathering on slate?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              The key diagnostic is exposure freshness. Fresh hail damage exposes new slate interior that lacks aging, dirt accumulation, moss growth, or patina—it appears cleaner and lighter in color than surrounding aged surfaces. Pre-existing weathering shows accumulated dirt, lichen growth, and color uniformity across the entire slate face. Inspection technique matters: close-proximity photography from ground level or during ladder inspection reveals color contrasts that prove freshness. Insurance carriers argue that any visible damage must be pre-existing; countering this requires documentation showing the contrast between fresh exposure and aged surfaces. dumbroof.ai's forensic analysis automatically detects these color and patina contrasts, generating proof-grade reports that eliminate carrier arguments about age-related deterioration.
            </p>
          </div>

          {/* Section 4 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              Can slate roofs be repaired after hail damage?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Yes, slate roofs can be repaired if hail damage affects fewer than 10% of slates in a single roof section. Two repair methods exist: the slate hook (visible from ground level but quicker installation) and the copper bib (requires more labor but leaves damage less visible from below). However, if more than 10% of slates are damaged in a section, full section replacement is typically required. This threshold exists because insurance carriers and building codes require damaged sections to maintain structural integrity and visual uniformity. Partial repairs in heavily damaged sections create maintenance liabilities and inspection compliance issues—full replacement becomes the code-compliant solution.
            </p>
          </div>

          {/* Stat block 2 */}
          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Repair Threshold
            </div>
            <p className="text-xl text-[var(--white)] font-bold">
              Below 10% damaged: Individual slate replacement eligible. Above 10% damaged: Full section replacement required per building code and carrier standards.
            </p>
          </div>

          {/* Section 5 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How much does slate roof hail repair cost?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Slate roof hail repair costs significantly more than asphalt or metal repairs. Individual slate replacement runs $15-$30+ per square foot depending on slate grade (premium grades cost more), regional labor rates, and contractor expertise. Full section replacement costs substantially more—often exceeding $50 per square foot. By comparison, asphalt roof hail repair averages $3-7 per square foot, making slate damage remediation 3-10 times more expensive. Factors influencing cost include slate origin (Vermont, Pennsylvania, and Virginia slate commands premium pricing), roof pitch complexity, accessibility, and whether historical preservation requirements apply to the property. This cost disparity explains why insurance carriers dispute slate claims aggressively—their payout exposure is significantly higher than asphalt claims.
            </p>
          </div>

          {/* Section 6 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              Does homeowners insurance cover hail damage to slate roofs?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Yes, homeowners insurance covers hail damage to slate roofs under the dwelling protection component of standard policies. Slate is not an excluded material. However, carriers frequently dispute slate claims by arguing that visible damage reflects pre-existing weathering or age-related deterioration rather than new hail impact. This dispute tactic is more common for slate than asphalt because the material's natural weathering appearance creates visual ambiguity. Carriers leverage this ambiguity to deny claims or reduce payouts. Strong forensic documentation proving damage freshness—through color contrast analysis, granule loss patterns, and building code citations specific to slate—overcomes these disputes and forces carriers to approve claims or provide written coverage denials that enable appeals.
            </p>
          </div>

          {/* Stat block 3 */}
          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Carrier Dispute Pattern
            </div>
            <p className="text-xl text-[var(--white)] font-bold">
              Slate hail claims face 3x higher dispute rates than asphalt claims due to carriers' "pre-existing weathering" defense and the material's complex aging characteristics.
            </p>
          </div>

          {/* Section 7 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              What building codes apply to slate roof hail repairs?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Building codes require slate roof repairs to maintain structural integrity and code compliance. The International Building Code (IBC) and regional variations establish standards for slate roof loading, fastening, and replacement protocols. Many jurisdictions enforce stricter requirements for historic properties with slate roofs—full section replacement may be mandated even for minor damage if matching original slate sources is required. Vermont, Pennsylvania, and Virginia regions with local slate production have specific code provisions for slate roof work. Permits are typically required for repairs exceeding 10% of roof area. This regulatory framework means slate damage repairs cannot be purely cost-driven—code compliance and historical preservation concerns often force full replacement even when partial repair would be technically feasible.
            </p>
          </div>

          {/* Section 8 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              Where is slate roofing material sourced in the United States?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Vermont, Pennsylvania, and Virginia are the primary slate production regions in the United States, with Vermont producing the highest quality and most expensive slate. These regional sources establish availability, cost, and aesthetic matching requirements. Historical slate roofs often specify slate from their original installation region—replacement slate must match original source to maintain property value and historic preservation compliance. Importing slate from different regions creates color and texture mismatches that violate building codes for historic properties. This supply chain reality means slate roof repairs in New England properties require Vermont slate, while Pennsylvania properties need Pennsylvania-sourced material. Availability constraints and regional pricing variations significantly impact repair costs and timeline.
            </p>
          </div>

          {/* Stat block 4 */}
          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Slate Sourcing
            </div>
            <p className="text-xl text-[var(--white)] font-bold">
              Vermont slate: Premium grade, most expensive, highest demand. Pennsylvania slate: Mid-range quality. Virginia slate: Lower cost option. Regional sourcing requirements add cost and timeline complexity to repairs.
            </p>
          </div>

          {/* Section 9 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How does dumbroof.ai document slate hail damage?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              dumbroof.ai uses AI forensic analysis specifically trained on slate hail damage patterns to distinguish fresh damage from pre-existing weathering. The system captures: (1) fracture pattern characteristics unique to hail impact; (2) fresh slate exposure color contrast compared to aged surfaces; (3) damage concentration patterns consistent with hail event footprints; (4) building code citations specific to slate roofing standards; and (5) historical roof documentation proving age and original installation specifications. This forensic output directly counters carrier arguments about pre-existing damage by providing proof-grade evidence of damage freshness. dumbroof.ai's slate-specialized analysis eliminates ambiguity that carriers exploit, forcing carriers to approve claims or provide written denials that enable formal appeals and attorney escalation.
            </p>
          </div>

          {/* Section 10 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              What should you do if an insurance carrier denies your slate hail claim?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              If your slate hail claim is denied, immediately: (1) request the carrier's written denial letter citing specific policy language and reasoning; (2) document the denial in writing with a response challenging the "pre-existing weathering" argument; (3) engage a public adjuster or attorney specializing in insurance disputes; (4) submit supplemental documentation with forensic-grade evidence proving damage freshness; (5) file a complaint with your state insurance commissioner if the carrier fails to respond to supplemental evidence. Many state insurance regulations require carriers to reconsider claims when new evidence is provided. dumbroof.ai's forensic reports are designed specifically to overcome initial denials—the proof-grade documentation forces carriers to escalate to supervisory claims adjusters who have authority to reverse initial denial decisions.
            </p>
          </div>

          {/* Internal Links */}
          <div className="glass-card p-6 my-8">
            <h3 className="font-bold text-[var(--white)] mb-4">Related Articles</h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="/learn/what-is-hail-damage"
                  className="text-[var(--cyan)] hover:underline text-sm"
                >
                  What Is Hail Damage? Identification, Insurance Claims & Documentation Guide
                </a>
              </li>
              <li>
                <a
                  href="/learn/hail-damage-to-tpo-roofing"
                  className="text-[var(--cyan)] hover:underline text-sm"
                >
                  Hail Damage to TPO Roofing: Identification Signs & Commercial Claim Guide
                </a>
              </li>
              <li>
                <a
                  href="/learn/hail-damage-to-epdm-roofing"
                  className="text-[var(--cyan)] hover:underline text-sm"
                >
                  Hail Damage to EPDM Roofing: Detection, Documentation & Insurance Claims
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto glass-card p-10 text-center">
          <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
            Stop Guessing. Start Proving.
          </h2>
          <p className="text-[var(--gray-muted)] mb-6 max-w-2xl mx-auto">
            Upload your slate hail damage photos and measurements. Get 5 forensic-grade documents in 15 minutes—ready to send to your insurance carrier.
          </p>
          <a
            href="/login?mode=signup"
            className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
          >
            Try 3 Free Claims
          </a>
          <p className="text-xs text-[var(--gray-dim)] mt-3">No credit card required</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-t border-white/10 py-8 px-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-sm">
              DR
            </div>
            <span className="text-[var(--gray-dim)] text-sm">Dumb Roof Technologies&trade;</span>
          </div>
          <p className="text-[var(--gray-muted)] text-sm">
            &copy; {new Date().getFullYear()} Dumb Roof Technologies. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
