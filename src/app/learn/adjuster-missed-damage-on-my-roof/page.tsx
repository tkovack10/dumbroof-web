import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Insurance Adjuster Missed Damage on My Roof — What Now?",
  description:
    "Your insurance adjuster missed damage on your roof. Learn why adjusters overlook hail and wind damage, how to request a re-inspection, your right to an independent inspection, and how to supplement for every missed line item. Step-by-step guide from dumbroof.ai.",
  keywords: [
    "adjuster missed roof damage",
    "insurance adjuster didn't see damage",
    "re-inspection roof claim",
    "adjuster missed hail damage",
    "dispute adjuster findings",
  ],
  openGraph: {
    title: "Insurance Adjuster Missed Damage on My Roof — What Now?",
    description:
      "Why adjusters miss roof damage and exactly what to do about it. Re-inspection rights, documentation strategies, and supplement tactics from dumbroof.ai.",
    type: "article",
    publishedTime: "2026-04-03T00:00:00Z",
    authors: ["Tom Kovack Jr."],
  },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Can I dispute an insurance adjuster's findings on my roof?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. You have the right to dispute an adjuster's findings. Start by requesting a formal re-inspection from your carrier in writing. Provide your own documentation — photos, measurements, and an independent inspection report — showing damage the adjuster missed. If the carrier denies the re-inspection, you can invoke your policy's appraisal clause to have an independent umpire review the claim.",
      },
    },
    {
      "@type": "Question",
      name: "Why do insurance adjusters miss roof damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Adjusters miss roof damage for several reasons: they are under time pressure with 8-12 inspections per day, they may not access all roof planes or steep sections, they may lack experience with specific roofing materials, and their scope is often limited to what is visible from a quick walkover. Collateral damage to AC units, window screens, skylights, and gutters is frequently overlooked entirely.",
      },
    },
    {
      "@type": "Question",
      name: "What items do adjusters most commonly miss on a roof claim?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The most commonly missed items include: soft metal damage (AC condensers, vent caps, flashing), collateral property damage (window screens, fence panels, garage doors, paint surfaces), interior damage from existing leaks, building code upgrade requirements (drip edge, ice and water shield, ventilation), gutter and downspout damage, and skylight seal failures. These missed items can add thousands of dollars to a claim.",
      },
    },
    {
      "@type": "Question",
      name: "How long do I have to request a re-inspection after an adjuster visit?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Most carriers allow you to request a re-inspection within the original claim filing window, which is typically 6 to 12 months from the date of loss depending on your state and carrier. However, the sooner you request a re-inspection, the stronger your position. Submit your request in writing with specific documentation of what the adjuster missed.",
      },
    },
    {
      "@type": "Question",
      name: "How does dumbroof.ai help when an adjuster misses damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "dumbroof.ai generates forensic-grade documentation that identifies every missed line item from the adjuster's original scope. Upload your inspection photos and measurements, and the AI produces a causation report with annotated photos, an Xactimate-style estimate, a carrier comparison highlighting scope gaps, a supplement letter with building code citations, and a cover email — all in under 15 minutes. The platform has recovered over $2.6 million in approved supplements from initially underpaid claims.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Insurance Adjuster Missed Damage on My Roof — What Now?",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage: "https://www.dumbroof.ai/learn/adjuster-missed-damage-on-my-roof",
  description:
    "Your insurance adjuster missed damage on your roof. Learn why adjusters overlook damage, how to request a re-inspection, and how to supplement for every missed line item.",
};

export default function AdjusterMissedDamageOnMyRoof() {
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
            <span className="text-[var(--gray)]">Adjuster Missed Damage on My Roof</span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Insurance Claims
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              Insurance Adjuster Missed Damage on My Roof &mdash; What Now?
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 13 min read
            </p>
          </header>

          {/* Direct Answer — AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">If your insurance adjuster missed damage on your roof, you have options.</strong>{" "}
            You can request a formal re-inspection, hire an independent HAAG-certified inspector
            to document what was overlooked, and submit a supplement to recover the full claim
            value. Adjusters routinely miss collateral damage, building code upgrades, and entire
            roof planes they never accessed. The gap between what the adjuster scoped and the
            actual damage is often 25&ndash;50% of the total claim value &mdash; and you have
            every right to challenge it.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong> According to industry data,
              the average insurance adjuster spends <strong className="text-[var(--white)]">43 minutes
              on a residential roof inspection</strong> while managing 8&ndash;12 inspections per day.
              In contrast, an independent inspector typically spends 2&ndash;3 hours documenting the
              same property. dumbroof.ai has identified over{" "}
              <strong className="text-[var(--white)]">$2.6 million in missed line items</strong>{" "}
              across claims that were initially underpaid after the first adjuster visit.
            </p>
          </div>

          {/* Section: Why Adjusters Miss Damage */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="why-adjusters-miss-damage">
            Why Do Insurance Adjusters Miss Roof Damage?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Insurance adjusters are not intentionally ignoring damage in most cases. The system
            they operate within creates structural gaps that consistently result in incomplete
            scopes. Understanding why damage gets missed gives you the leverage to challenge the
            findings effectively.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Time Pressure
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            After a major storm event, carriers deploy adjusters who are expected to complete
            8&ndash;12 roof inspections per day. That leaves roughly 30&ndash;45 minutes per
            property, including drive time, homeowner interaction, roof access, documentation,
            and report writing. A thorough roof inspection of a 30-square residential property
            requires 2&ndash;3 hours to cover every plane, penetration, and collateral item.
            The math does not work in your favor.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Limited Roof Access
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Many adjusters inspect steep-slope roofs from the gutter line or use binoculars
            from the ground. Roof planes facing away from ladder access frequently go
            uninspected. On multi-story homes, the back elevation is almost always under-documented.
            If the adjuster cannot safely access a section, they often omit it from the scope
            rather than noting it as inaccessible and recommending further inspection.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Inexperience With Specific Materials
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Staff adjusters rotate across property types &mdash; auto, interior, commercial,
            residential. An adjuster who specializes in auto claims may be reassigned to
            residential roofing after a catastrophic storm. They may not know that EPDM transfers
            hail impact to the insulation board below the membrane, or that soft slate develops
            linear fractures rather than circular impact marks. Material-specific knowledge gaps
            lead directly to missed damage.
          </p>

          {/* Section: What Adjusters Commonly Overlook */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="commonly-overlooked">
            What Do Adjusters Most Commonly Overlook?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Certain categories of damage are missed so consistently that experienced contractors
            check for them on every single re-inspection. Here are the items adjusters overlook
            most often &mdash; and the dollar impact of each.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Soft Metals &amp; Mechanical Equipment
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            AC condenser units, heat pump cabinets, and rooftop mechanical equipment are among the
            most frequently missed items on hail claims. Hail dents condenser fins, reducing
            airflow efficiency and shortening equipment life. Adjusters walk past these units
            without inspecting them because they are focused on the roof surface. Other soft metal
            targets include vent pipe boots, flashing, drip edge, and chimney caps &mdash; all of
            which absorb hail impacts and confirm storm presence at the property.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Collateral Property Damage
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The adjuster&apos;s scope typically covers the roof and sometimes gutters. But hail
            and wind events damage far more than roofing materials. Items that are routinely left
            out of the initial scope include:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "Window screens — aluminum mesh tears and distorts under hail impact; replacement costs add up across 15-20 windows",
              "Fence panels — wood fence caps splinter, vinyl panels crack, and metal fencing dents; entire fence runs may qualify",
              "Garage doors — steel and aluminum garage doors dent in the same hail pattern as the roof; often a $1,500-$3,000 line item",
              "Paint surfaces — exterior painted trim, fascia, shutters, and window sills show hail splatter marks that require repainting",
              "Skylights — hail cracks skylight glazing and compromises seals; missed skylight damage leads to interior water intrusion",
              "Outdoor fixtures — light fixtures, mailboxes, address plaques, and decorative metalwork all sustain cosmetic and functional damage",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--red)] shrink-0 mt-0.5">&#x2715;</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Interior Damage
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            If hail or wind compromised the roof before the adjuster arrived, water may have
            already entered the structure. Water stains on ceilings, bubbling paint on walls,
            and damp insulation in the attic are all claimable &mdash; but the adjuster may
            never enter the home. If you have any interior signs of water intrusion, document
            them and include them in your supplement request. Mold remediation costs alone can
            exceed the original roof claim.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Building Code Upgrades
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            When a roof is replaced due to storm damage, the new installation must meet current
            building codes &mdash; even if the original roof was built to older standards. Adjusters
            frequently scope the replacement to match the existing roof without accounting for code
            upgrades. Commonly missed code items include:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "Drip edge installation (IRC R905.2.8.5) — required on all eaves and rakes in most jurisdictions",
              "Ice and water shield membrane — required in cold climates along eaves, valleys, and penetrations",
              "Starter strip shingles — manufacturer specifications require them for warranty compliance",
              "Ridge ventilation upgrades — code may require balanced intake and exhaust ventilation",
              "Deck attachment and nailing patterns — wind zone requirements may mandate ring-shank nails or closer spacing",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--red)] font-bold mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Gutters &amp; Downspouts
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Gutters are one of the most reliable indicators of hail presence at a property, yet
            adjusters often document gutter dents as evidence of hail without including gutter
            replacement in their scope. If the gutters are dented enough to confirm hail, they
            are damaged enough to replace. Downspout elbows, splash blocks, and gutter guards
            are additional line items that adjusters routinely leave off the estimate.
          </p>

          {/* Section: How to Request a Re-Inspection */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="re-inspection">
            How to Request a Re-Inspection
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A re-inspection is a formal request for the carrier to send a second adjuster (or
            the same adjuster) back to the property to review damage that was missed or
            under-documented. Here is the process that produces the best outcomes:
          </p>
          <div className="space-y-4 mb-6">
            {[
              { step: "Submit your request in writing", detail: "Email or fax a written re-inspection request to your claims adjuster and their supervisor. Include the claim number, date of loss, and a specific list of items you believe were missed. Verbal requests are easily ignored — written requests create a paper trail." },
              { step: "Attach your own documentation", detail: "Include dated photos of damage the adjuster missed, measurements showing the full scope, and any third-party inspection reports. The more specific your evidence, the harder it is for the carrier to deny the request." },
              { step: "Reference specific scope gaps", detail: "Don't say 'the adjuster missed damage.' Say 'the adjuster's scope does not include the 14 dented AC condenser fins on the north-facing Carrier unit, the 18 torn window screens on the east and south elevations, or the IRC R905.2.8.5 drip edge requirement.' Specificity forces a substantive response." },
              { step: "Request the re-inspection adjuster bring a ladder", detail: "Many initial inspections are done from the ground or gutter line. Specifically request that the re-inspection include physical access to all roof planes, including the back elevation and any steep sections the first adjuster could not reach." },
              { step: "Be present or have your contractor present", detail: "The re-inspection is your opportunity to walk the adjuster through every missed item. Point out damage in real time. An experienced contractor who can explain the significance of each finding dramatically improves the outcome." },
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

          {/* Section: Your Right to an Independent Inspection */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="independent-inspection">
            Your Right to an Independent Inspection
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            You are not required to accept the carrier&apos;s adjuster as the final word on your
            claim. Every homeowner and contractor has the right to obtain an independent
            inspection and submit it as supporting documentation. If the carrier denies your
            re-inspection request or the second adjuster still underscopes the damage, you have
            additional options:
          </p>
          <div className="space-y-3 mb-6">
            {[
              "Hire an independent HAAG-certified inspector to produce a comprehensive report with test-square counts, collateral damage documentation, and building code citations",
              "Invoke the appraisal clause in your insurance policy — this allows both parties to appoint independent appraisers and an umpire to determine the claim value",
              "File a complaint with your state's Department of Insurance if the carrier is acting in bad faith by refusing to acknowledge documented damage",
              "Retain a public adjuster who works on your behalf (typically for 10-15% of the claim recovery) to negotiate directly with the carrier",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--red)] font-bold mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>

          {/* Section: How to Document What They Missed */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="documentation">
            How to Document What the Adjuster Missed
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Documentation is the difference between a denied supplement and a paid one. The goal
            is to build an evidence chain that connects the weather event to specific, measurable
            damage at the property. Here is what that documentation should include:
          </p>
          <div className="space-y-3 mb-6">
            {[
              "Dated, high-resolution photos of every damaged item — roof planes, soft metals, collateral property, and interior water damage",
              "Close-up photos of individual hail strikes or wind-lifted shingles with a ruler or coin for scale reference",
              "Wide-angle context photos showing the damaged item's location on the property (adjusters need to identify where the damage is)",
              "Test-square counts on multiple roof planes — 10×10-foot areas with impact counts that meet or exceed the carrier's threshold",
              "NOAA storm data confirming hail size, wind speed, and storm path across the property's zip code on the date of loss",
              "A written narrative explaining what was missed and why each item qualifies as storm damage under the policy",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--red)] font-bold mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>

          {/* Section: The Role of a HAAG-Certified Inspector */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="haag-certified">
            The Role of a HAAG-Certified Inspector
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            HAAG Engineering is the gold standard for forensic roof inspection training. A
            HAAG-certified inspector has completed coursework in hail and wind damage
            identification across all major roofing material types. Their reports carry
            significantly more weight with insurance carriers than a standard contractor
            inspection for several reasons:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "HAAG certification requires passing rigorous exams on damage identification methodology — carriers trust the methodology",
              "HAAG reports follow a standardized format that adjusters and desk reviewers are trained to process",
              "HAAG inspectors document damage using engineering terminology that aligns with carrier evaluation criteria",
              "A HAAG report creates an expert-level record that supports appraisal and litigation if the claim escalates",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--red)] shrink-0 mt-0.5">&#x2713;</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            If you are a roofing contractor who is not HAAG-certified, consider partnering with
            a certified inspector in your market. The cost of a HAAG inspection ($300&ndash;$500)
            is a fraction of the supplement recovery it supports. Many contractors include the
            inspection fee as a line item in the supplement itself.
          </p>

          {/* Section: Supplement Strategies for Missed Items */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="supplement-strategies">
            Supplement Strategies for Missed Items
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A supplement is a formal request to add line items or adjust pricing on an existing
            insurance claim. When an adjuster misses damage, the supplement is your primary tool
            for recovering the full claim value. Effective supplement strategies include:
          </p>
          <div className="space-y-4 mb-6">
            {[
              { strategy: "Line-item comparison", detail: "Place the adjuster's estimate side-by-side with your comprehensive estimate. Highlight every line item that appears in your scope but is absent from the adjuster's. This visual comparison makes the gaps impossible to ignore." },
              { strategy: "Building code citations", detail: "For every code upgrade the adjuster missed, cite the specific IRC, IBC, or local building code section that requires the item. Code upgrades are non-negotiable — the carrier cannot authorize a replacement that violates current building codes." },
              { strategy: "Photo-to-line-item mapping", detail: "Match each missed line item to a specific photo showing the damage. Annotate the photos with arrows, circles, and measurements. A supplement without photo evidence is a wish list; a supplement with mapped photos is a case file." },
              { strategy: "Manufacturer specifications", detail: "If the adjuster scoped generic materials instead of the actual manufacturer's product, reference the manufacturer's installation requirements. GAF, Owens Corning, and CertainTeed all publish specifications that often exceed the adjuster's assumed scope." },
              { strategy: "Carrier-specific language", detail: "Different carriers respond to different framing. State Farm focuses on documentation completeness. Allstate responds to code citations. USAA values engineering reports. Tailor your supplement language to the specific carrier's known review process." },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">{String(i + 1).padStart(2, "0")}</span>
                  <h4 className="text-[var(--white)] font-semibold text-sm">{item.strategy}</h4>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">{item.detail}</p>
              </div>
            ))}
          </div>

          {/* Section: How dumbroof.ai Catches What Adjusters Miss */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="dumbroof-ai">
            How dumbroof.ai Catches What Adjusters Miss
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai was built specifically to close the gap between what adjusters scope and
            what the property actually needs. The platform uses AI-powered photo analysis and
            building code intelligence to identify missed line items that human reviewers overlook.
            Here is how it works:
          </p>
          <div className="space-y-3 mb-6">
            {[
              "Upload your inspection photos and roof measurements — the AI analyzes every image for damage indicators across all visible surfaces",
              "The platform cross-references your photos against the adjuster's scope to identify line items that are present in the evidence but missing from the estimate",
              "Building code requirements for your jurisdiction are automatically applied — drip edge, ice and water shield, ventilation, and nailing patterns are never omitted",
              "Carrier intelligence playbooks track how specific carriers (State Farm, Allstate, USAA, Farmers, Liberty Mutual) handle claims, so the supplement language is tailored to each carrier's review process",
              "In under 15 minutes, the AI generates 5 forensic-grade documents: a causation report with annotated photos, an Xactimate-style estimate, a carrier comparison, a supplement letter, and a professional cover email",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--red)] font-bold mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The result is a supplement package that addresses every missed item with photo evidence,
            code citations, and carrier-specific language. Over $12.5 million in claims have been
            processed through the platform, with $2.6 million in approved supplements &mdash;
            money that would have been left on the table without systematic gap identification.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Real example:</strong> A contractor in Dallas
              uploaded photos from a claim where the adjuster scoped only the roof replacement at
              $8,200. dumbroof.ai identified 23 missed line items including AC condenser fin damage,
              12 torn window screens, garage door denting, fascia paint damage, drip edge code
              requirements, and gutter replacement. The supplement was approved for an additional
              $4,750 &mdash; a <strong className="text-[var(--white)]">58% increase</strong> over
              the original adjuster scope.
            </p>
          </div>

          {/* FAQ Section */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-6" id="faq">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4 mb-10">
            {(faqSchema.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>).map((faq) => (
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
              Adjuster Missed Damage? Get the Full Scope in 15 Minutes.
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              Upload your inspection photos and measurements. dumbroof.ai identifies every missed
              line item and generates a complete supplement package &mdash; causation report,
              estimate, carrier comparison, supplement letter, and cover email.
            </p>
            <a
              href="/signup"
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
