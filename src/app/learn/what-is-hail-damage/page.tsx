import type { Metadata } from "next";
import { LearnPhotoGallery } from "@/components/learn-photo-gallery";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "What Is Hail Damage? Identification, Insurance Claims & Documentation Guide",
  description:
    "Hail damage is physical deterioration caused by frozen precipitation striking roofing materials at high velocity. Learn to identify hail damage across all roof types, document it for insurance claims, and understand what carriers look for. Real claim photos included.",
  keywords: [
    "what is hail damage",
    "hail damage roof",
    "hail damage identification",
    "hail damage insurance claim",
    "roof hail damage signs",
    "hail damage documentation",
    "hail damage to shingles",
  ],
  openGraph: {
    title: "What Is Hail Damage? Complete Identification & Insurance Claim Guide",
    description: "Learn to identify hail damage across all roof types with real claim photos. Expert guide from dumbroof.ai.",
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
      name: "What does hail damage look like on a roof?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "On asphalt shingles, hail damage appears as random circular bruises — soft spots where granules were displaced by impact. On metal roofs, it shows as dents. On tile and slate, it causes cracks or fractures. On flat membranes (TPO, EPDM), it creates concentric circular fracture patterns or punctures. Ground-level clues include dented gutters, damaged AC units, and dimpled car hoods.",
      },
    },
    {
      "@type": "Question",
      name: "What size hail causes roof damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Hail 1 inch in diameter (quarter-size) is the threshold where meaningful roof damage begins for most materials. At 1 inch, asphalt shingles can crack and lose granules, and metal roofs may dent. At 1.75 inches (golf ball size), broken shingles and cracked tiles are common. At 2.5 inches and above, significant destruction occurs across nearly all roofing types.",
      },
    },
    {
      "@type": "Question",
      name: "How long do I have to file a hail damage insurance claim?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Most insurance providers allow 6 to 12 months to file a hail damage claim, though timelines vary by carrier and state. Waiting too long can disqualify your claim, especially if the damage worsens due to delayed action. File as soon as possible after a hail event for the strongest claim outcome.",
      },
    },
    {
      "@type": "Question",
      name: "Can I have roof hail damage without a visible leak?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. You don't need a visible leak to have valid roof hail damage. Hail impacts weaken roofing materials by creating tiny cracks and vulnerabilities that may not produce leaks for months or even years after the storm. Insurance covers the damage itself, not just resulting leaks.",
      },
    },
    {
      "@type": "Question",
      name: "How does dumbroof.ai help with hail damage claims?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "dumbroof.ai is an AI platform that generates forensic-grade insurance claim documentation from your inspection photos and measurements in under 15 minutes. Upload your photos, and the AI produces 5 professional documents: a forensic causation report with annotated photos, an Xactimate-style estimate with building code citations, a carrier comparison, a supplement letter, and a cover email — all branded with your company logo. Over $12.5M in claims processed with $2.6M in approved supplements.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "What Is Hail Damage? Identification, Insurance Claims & Documentation Guide",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-03-22",
  dateModified: "2026-03-22",
  mainEntityOfPage: "https://www.dumbroof.ai/learn/what-is-hail-damage",
  description: "Hail damage is physical deterioration caused by frozen precipitation striking roofing materials at high velocity. Complete identification and insurance claim guide with real photos.",
};

export default function WhatIsHailDamage() {
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
            <span className="text-[var(--gray)]">What Is Hail Damage?</span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Damage Identification
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              What Is Hail Damage? Identification, Insurance Claims &amp; Documentation Guide
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; March 22, 2026 &middot; 12 min read
            </p>
          </header>

          {/* Direct Answer — AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">Hail damage</strong> is physical deterioration
            caused by frozen precipitation (hailstones) striking roofing materials at terminal
            velocity. On asphalt shingles, it appears as random circular bruises where granules
            are displaced. On metal, it produces dents. On tile and slate, it creates cracks or
            fractures. Hail damage is covered under standard homeowners insurance policies and is
            one of the most common — and most underpaid — property damage claims in the United States.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong> The National Oceanic and
              Atmospheric Administration (NOAA) reports that hail causes over <strong className="text-[var(--white)]">$10 billion in damage
              annually</strong> in the United States, making it one of the costliest natural hazards
              for property owners. dumbroof.ai has processed over <strong className="text-[var(--white)]">$12.5 million in hail-related
              claims</strong> with <strong className="text-[var(--white)]">$2.6 million in approved supplements</strong>.
            </p>
          </div>

          {/* Photo Gallery */}
          <LearnPhotoGallery
            damageType="hail"
            limit={6}
            heading="Real Hail Damage Photos From Processed Claims"
          />

          {/* Section: How to Identify */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="how-to-identify">
            How Do You Identify Hail Damage on a Roof?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Identifying hail damage requires examining both the roof surface and ground-level
            indicators. Hail creates distinct impact patterns that vary by roofing material — but
            all materials share one common trait: the damage pattern is <em>random</em>, not
            linear. This randomness distinguishes hail damage from wind damage, foot traffic,
            or manufacturing defects.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Asphalt Shingles
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            On asphalt shingles — which cover approximately 80% of residential roofs in the
            U.S. — hail damage presents as random circular bruises. When you press on the
            impact point, it feels soft or spongy compared to the surrounding material. Granule
            loss exposes the black asphalt mat underneath. Insurance adjusters use a &ldquo;test
            square&rdquo; method, counting impacts in a 10&times;10-foot area. If 8 or more hits
            are found in a single test square, the roof typically qualifies for full replacement.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Metal Roofing
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Metal roofs show hail damage as visible dents or dimples. While cosmetic denting
            may not immediately affect functionality, it compromises the protective coating and
            accelerates corrosion. Carriers frequently argue metal dents are &ldquo;cosmetic only&rdquo;
            — but the protective coating breach is a legitimate functional damage argument supported
            by manufacturer warranties.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Tile &amp; Slate
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Tile and slate roofs crack or fracture under hail impact rather than denting. Newer
            slate (under 20 years) is harder and less likely to show circular &ldquo;bullet hole&rdquo;
            impact patterns — instead, it develops linear fractures that are only visible upon
            close inspection. Cracked tiles and slate allow water intrusion at each fracture
            point. See our detailed guide on{" "}
            <a href="/learn/hail-damage-to-slate-roofs" className="text-[var(--cyan)] hover:underline">
              hail damage to slate roofs
            </a>.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Flat / Commercial Membranes (TPO, EPDM, PVC)
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Flat roofing membranes react differently to hail than steep-slope materials. TPO
            and PVC show concentric circular fracture patterns or star-shaped cracks in the top
            ply. EPDM (rubber) absorbs the impact but transfers force to the insulation board
            underneath, creating hidden dimpling that leads to ponding water. Both{" "}
            <a href="/learn/hail-damage-to-tpo-roofing" className="text-[var(--cyan)] hover:underline">
              TPO hail damage
            </a>{" "}and{" "}
            <a href="/learn/hail-damage-to-epdm-roofing" className="text-[var(--cyan)] hover:underline">
              EPDM hail damage
            </a>{" "}
            require specialized identification techniques.
          </p>

          {/* Section: Hail Size */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="hail-size">
            What Size Hail Causes Roof Damage?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Hail damage potential correlates directly with hailstone diameter. Here are the
            thresholds roofing contractors and adjusters use when evaluating storm damage claims:
          </p>

          <div className="space-y-3 mb-6">
            {[
              { size: '¼" (pea)', effect: "Unlikely to damage most roofing materials. May displace some loose granules on aged shingles." },
              { size: '½" (marble)', effect: "Can leave surface marks on weathered shingles. Minimal functional damage to roofing in good condition." },
              { size: '1" (quarter)', effect: "Threshold for meaningful damage. Asphalt shingles crack and lose granules. Metal roofs dent. This is where most legitimate insurance claims begin." },
              { size: '1.75" (golf ball)', effect: "Broken shingles, cracked tiles, significant metal denting. TPO/PVC membrane fracturing begins at this size." },
              { size: '2.5"+ (tennis ball)', effect: "Significant destruction across nearly all roofing types. EPDM punctures likely. Full replacement claims are standard." },
            ].map((item) => (
              <div key={item.size} className="glass-card p-4 flex gap-4">
                <span className="text-[var(--red)] font-bold text-sm whitespace-nowrap min-w-[120px]">{item.size}</span>
                <p className="text-sm text-[var(--gray)] leading-relaxed">{item.effect}</p>
              </div>
            ))}
          </div>

          {/* Section: Ground Level */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="ground-level">
            How Do You Check for Hail Damage Without Getting on the Roof?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Ground-level assessment is the first step in hail damage documentation. Before
            climbing a ladder, check these 5 indicators that confirm hail presence and
            approximate size at the property:
          </p>
          <div className="space-y-3 mb-4">
            {[
              "Gutters and downspouts — look for dents on aluminum or copper sections; downspout elbows show impact clearly",
              "Soft metals — mailbox tops, AC condenser fins, outdoor light fixtures dent easily and confirm hail size",
              "Vehicles — circular dimples on vehicle hoods, roofs, and trunk lids confirm hail at the specific address",
              "Window screens and siding — torn screens and dented vinyl or aluminum siding establish storm path",
              "Wood surfaces — decks, fences, and painted surfaces show splatter marks and impact divots",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--red)] font-bold mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            These ground-level photos are essential for insurance documentation. They prove the
            hail event impacted the specific property — not just the general area. dumbroof.ai&apos;s
            AI photo analysis cross-references ground-level evidence with roof-level findings to
            build a complete forensic evidence chain.
          </p>

          {/* Section: Insurance Claim */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="insurance-claim">
            How Do You File an Insurance Claim for Hail Damage?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Filing a hail damage insurance claim requires systematic documentation that connects
            the weather event to the specific property damage. Most insurance providers allow 6 to
            12 months to file, but filing promptly produces the strongest outcomes. Here&apos;s the
            process:
          </p>
          <div className="space-y-4 mb-6">
            {[
              { step: "Document immediately", detail: "Photograph all visible damage from ground level. Include timestamps. Capture soft metals, vehicles, and surrounding property. Do not make any repairs before the adjuster visit." },
              { step: "Schedule professional inspection", detail: "A qualified roof inspector will use the test-square method and identify damage you can't see from the ground. HAAG-certified inspectors carry the most weight with carriers." },
              { step: "File your claim", detail: "Contact your insurance carrier and report the loss. Provide the storm date and general description. The carrier will assign an adjuster." },
              { step: "Meet the adjuster", detail: "Be present (or have your contractor present) when the adjuster inspects. Point out all documented damage. The adjuster's scope often misses line items — this is where supplements become critical." },
              { step: "Review and supplement", detail: "Compare the adjuster's scope against a comprehensive estimate. Most initial carrier scopes underestimate the true cost by 25-50%. A proper supplement identifies every missed line item, building code requirement, and pricing discrepancy." },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">{String(i + 1).padStart(2, "0")}</span>
                  <h4 className="text-[var(--white)] font-semibold text-sm">{item.step}</h4>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">{item.detail}</p>
              </div>
            ))}
          </div>

          {/* Section: Why Claims Get Denied */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="claim-denials">
            Why Do Insurance Companies Deny Hail Damage Claims?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Carriers deny or underpay hail damage claims for predictable reasons. Understanding
            these tactics helps contractors build documentation that pre-empts objections. The most
            common denial reasons include:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "\"Pre-existing damage\" — carrier claims the damage existed before the storm event",
              "\"Wear and tear\" — carrier attributes damage to age rather than hail impact",
              "\"Cosmetic only\" — carrier acknowledges damage but argues it doesn't affect functionality",
              "\"Below deductible\" — carrier's scope intentionally omits line items to keep the total under deductible",
              "\"No matching\" — carrier refuses to replace non-damaged materials needed for visual consistency",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--red)] shrink-0 mt-0.5">&#x2715;</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai&apos;s forensic causation reports address each of these objections by pairing
            specific photo evidence with building code citations and HAAG engineering standards.
            The carrier intelligence playbooks track how specific carriers respond to claims,
            allowing the AI to pre-build documentation that counters their known tactics.
          </p>

          {/* FAQ Section */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-6" id="faq">
            Frequently Asked Questions About Hail Damage
          </h2>
          <div className="space-y-4 mb-10">
            {(faqSchema.mainEntity as Array<{name: string; acceptedAnswer: {text: string}}>).map((faq) => (
              <div key={faq.name} className="glass-card p-5">
                <h3 className="text-sm font-semibold text-[var(--white)] mb-2">{faq.name}</h3>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                  {faq.acceptedAnswer.text}
                </p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="bg-gradient-to-r from-[var(--pink)]/10 via-[var(--purple)]/10 to-[var(--blue)]/10 border border-white/10 rounded-2xl p-8 text-center mt-14">
            <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
              Have Hail Damage Photos? Get Your Claim Package in 15 Minutes.
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              Upload your inspection photos and measurements. dumbroof.ai generates 5 forensic-grade
              documents — causation report, estimate, carrier comparison, supplement letter, and cover
              email. No Xactimate license needed.
            </p>
            <a
              href="/login?mode=signup"
              className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
            >
              Try 3 Free Claims
            </a>
            <p className="text-xs text-[var(--gray-dim)] mt-3">No credit card required</p>
          </div>
        </article>

        <Footer />
      </main>
    </>
  );
}
