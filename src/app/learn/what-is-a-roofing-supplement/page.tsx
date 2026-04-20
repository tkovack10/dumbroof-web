import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title:
    "What Is a Roofing Supplement? The Definitive Guide for Homeowners & Contractors",
  description:
    "A roofing supplement is a request for additional money from your insurance carrier when the original estimate missed legitimate repair costs. Learn the full supplement process, common denied items, and how to write a supplement letter that gets approved.",
  keywords: [
    "what is a roofing supplement",
    "roofing supplement process",
    "how to supplement a roof claim",
    "roof insurance supplement",
    "supplement denied items",
    "roofing supplement letter",
    "insurance claim supplement",
  ],
  openGraph: {
    title:
      "What Is a Roofing Supplement? The Definitive Guide for Homeowners & Contractors",
    description:
      "A roofing supplement is a request for additional money from your insurance carrier when the original estimate missed legitimate repair costs. Learn the full process, common denied items, and how to get supplements approved.",
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
      name: "What is a roofing supplement?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A roofing supplement is a formal request sent to an insurance carrier asking them to add money to an existing roof claim because the original estimate did not include all the work, materials, or code-required items needed to complete the repair. Supplements are standard practice in insurance restoration and are not adversarial — they correct the estimate so the homeowner receives the coverage they paid for.",
      },
    },
    {
      "@type": "Question",
      name: "Why is the first insurance estimate almost always low?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Insurance adjusters write estimates remotely using satellite imagery, spend limited time on the roof, or use software defaults that undercount line items. They typically approve the minimum scope — basic shingle replacement — and omit components like drip edge, ice and water shield, starter strip, pipe boots, step flashing, ridge vent, and code-required upgrades that are only visible during tear-off or on-site inspection.",
      },
    },
    {
      "@type": "Question",
      name: "What items are most commonly left off a roof insurance estimate?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The most commonly omitted items include drip edge replacement, starter strip, ice and water shield in valleys and eaves, pipe boot replacement, step flashing at walls and chimneys, ridge vent or ridge cap, synthetic underlayment upgrades required by current building code, and permit fees. These items are often only discovered during tear-off when the old roof is removed.",
      },
    },
    {
      "@type": "Question",
      name: "How long does the roofing supplement process take?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A typical supplement takes 7 to 21 business days from submission to carrier response. Well-documented supplements with photos, manufacturer specs, code citations, and line-item detail tend to resolve in 7-10 days. Poorly documented supplements or those requiring a re-inspection can take 30 days or more. Some carriers have dedicated supplement departments that process faster than others.",
      },
    },
    {
      "@type": "Question",
      name: "How does dumbroof.ai help with roofing supplements?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "dumbroof.ai auto-generates supplement letters with line-item detail, building code citations, manufacturer specifications, and photo documentation in approximately 15 minutes. The AI cross-references the carrier's original estimate against a complete scope of work to identify every missing item, then produces a professional supplement package ready to send to the insurance company — no Xactimate license required.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline:
    "What Is a Roofing Supplement? The Definitive Guide for Homeowners & Contractors",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage:
    "https://www.dumbroof.ai/learn/what-is-a-roofing-supplement",
  description:
    "A roofing supplement is a request for additional money from your insurance carrier when the original estimate missed legitimate repair costs. Learn the full supplement process, common denied items, and how to write a supplement letter that gets approved.",
};

export default function WhatIsARoofingSupplement() {
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
            <a href="/" className="hover:text-white transition-colors">
              Home
            </a>
            <span className="mx-2">/</span>
            <a href="/learn" className="hover:text-white transition-colors">
              Learn
            </a>
            <span className="mx-2">/</span>
            <span className="text-[var(--gray)]">
              What Is a Roofing Supplement
            </span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Insurance Claims
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              What Is a Roofing Supplement and Why Do I Need One?
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 14 min read
            </p>
          </header>

          {/* Direct Answer */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">
              A roofing supplement is a formal request for additional money from
              your insurance company
            </strong>{" "}
            when the original claim estimate did not include everything needed to
            actually fix your roof. Think of it this way: the insurance company
            sends an adjuster, the adjuster writes a check, and then your
            contractor starts tearing off shingles and discovers that the real
            repair costs more than what the adjuster approved. The supplement is
            how your contractor asks the carrier to cover the difference. It is
            not a scam, not an upsell, and not optional — it is standard
            practice in insurance restoration and happens on the majority of
            roof claims in the United States.
          </p>

          {/* Key Stat Box */}
          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong> The
              average roofing supplement increases a claim payout by{" "}
              <strong className="text-[var(--white)]">30-50%</strong> over the
              carrier&apos;s original estimate. On a typical $12,000 roof claim,
              that means{" "}
              <strong className="text-[var(--white)]">
                $3,600 to $6,000 in additional money
              </strong>{" "}
              that the homeowner is entitled to but would never receive without
              filing a supplement.
            </p>
          </div>

          {/* Section 1 — What a Supplement Is in Plain English */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="what-is-a-supplement"
          >
            What Is a Roofing Supplement in Plain English?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Imagine you take your car to a mechanic after an accident. The
            insurance company looks at photos and says, &ldquo;We&apos;ll pay to
            replace the bumper.&rdquo; But when the mechanic actually removes
            the bumper, they find the frame underneath is bent too. Now the
            mechanic calls the insurance company and says, &ldquo;Hey, there&apos;s
            more damage here than you approved. We need additional money to fix
            it properly.&rdquo; That call is essentially a supplement.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A roofing supplement works the same way. Your insurance carrier sends
            an adjuster to inspect your roof after a storm. The adjuster writes
            an estimate — a list of materials and labor they&apos;ll pay for.
            But adjusters spend a limited amount of time on any single roof.
            They often use satellite imagery, software defaults, and templated
            line items. They approve the minimum: shingles, felt paper, maybe
            some flashing. They move on to the next claim.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Then your contractor actually gets on the roof, tears off the old
            shingles, and sees everything the adjuster missed. Rotted decking.
            Corroded pipe boots. Missing ice and water shield that current
            building code requires. Step flashing so deteriorated it cannot be
            reused. A ridge vent that the adjuster didn&apos;t even include on the
            estimate.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            The supplement is the formal, documented request your contractor
            sends to the insurance company that says: &ldquo;Here is what was
            actually needed, here is why it was needed, here are the photos
            proving it, and here is the additional cost.&rdquo; The carrier
            reviews it, and if the documentation supports the request, they
            issue an additional payment. This process is completely normal and
            happens on roughly{" "}
            <strong className="text-[var(--white)]">
              60-70% of all insurance roof claims
            </strong>
            .
          </p>

          {/* Section 2 — Why the First Estimate Is Almost Always Low */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="why-estimates-are-low"
          >
            Why Is the First Insurance Estimate Almost Always Low?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Insurance carriers are businesses. Their adjusters are trained to
            approve the minimum defensible scope. This is not necessarily
            malicious — adjusters handle enormous caseloads and literally cannot
            spend three hours on every roof. But the result is the same: the
            first estimate almost always underrepresents the true cost of
            repair. Here is why:
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                title: "Desk adjusting and satellite imagery",
                detail:
                  "Many carriers now write initial estimates from satellite photos without ever sending a person to the roof. They measure the roof area from above, apply a default shingle cost, and generate a number. This method cannot detect hidden damage, deteriorated components, or code-required upgrades.",
              },
              {
                title: "Limited time on-site",
                detail:
                  "Even when a field adjuster visits, they typically spend 20-45 minutes per property. They inspect what they can see from the surface — bruised shingles, missing tabs, visible flashing issues. They cannot see what is underneath the existing shingles without a tear-off.",
              },
              {
                title: "Software defaults and minimum scope",
                detail:
                  "Insurance estimating software like Xactimate uses default settings and line items. Adjusters often accept these defaults rather than customizing for each property. The defaults typically reflect the cheapest acceptable repair, not a complete one.",
              },
              {
                title: "No code-upgrade review",
                detail:
                  "Building codes change regularly. Your roof may have been installed under an older code that did not require ice and water shield, drip edge on all edges, or synthetic underlayment. Current code does. Adjusters frequently omit these items because the original roof did not have them — even though code now mandates them during any re-roof.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <p className="font-semibold text-[var(--white)] text-sm">
                  {item.title}
                </p>
                <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>

          {/* Section 3 — Common Line Items Left Off */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="common-missing-items"
          >
            Common Line Items Insurance Adjusters Leave Off the Estimate
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            If you have never seen a roofing estimate before, the line items can
            look like a foreign language. But each one represents a real
            material or labor cost that your contractor must pay for. When the
            adjuster leaves an item off the estimate, that cost comes out of
            either the contractor&apos;s margin or the homeowner&apos;s pocket — unless
            someone files a supplement. Here are the items most frequently
            omitted:
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Drip Edge",
                desc: "A metal strip installed along the eaves and rakes (edges) of your roof that directs water away from the fascia and into the gutter. Most current building codes require drip edge on all roof edges during a re-roof. Adjusters commonly leave it off because the original roof may not have had it — but code now mandates it.",
              },
              {
                num: "02",
                title: "Starter Strip",
                desc: "A specialized shingle or adhesive strip installed along the eaves before the first course of shingles. It provides the initial sealant bond and wind resistance for the bottom row. Without it, the first row of shingles has no adhesive backing and is highly vulnerable to wind uplift. Adjusters often omit this as a separate line item, assuming it is included in the shingle count — it is not.",
              },
              {
                num: "03",
                title: "Ice and Water Shield",
                desc: "A self-adhering waterproof membrane installed in valleys, along eaves, and around penetrations (pipes, chimneys, skylights). Building code in most jurisdictions requires ice and water shield in these vulnerable areas. It is one of the most expensive components per square foot and one of the most commonly omitted from initial estimates.",
              },
              {
                num: "04",
                title: "Pipe Boots (Pipe Jacks)",
                desc: "Rubber or metal flanges that seal around plumbing vent pipes where they penetrate the roof. These deteriorate faster than shingles and almost always need replacement during a re-roof. Adjusters frequently skip them or include only one when the roof has four or five penetrations.",
              },
              {
                num: "05",
                title: "Step Flashing",
                desc: "Individual L-shaped metal pieces installed where the roof meets a vertical wall, chimney, or dormer. Each piece overlaps the one below it, channeling water away from the wall junction. Step flashing corrodes over time and cannot be reused after a tear-off. Adjusters routinely omit step flashing or include a fraction of the actual quantity needed.",
              },
              {
                num: "06",
                title: "Ridge Vent and Ridge Cap",
                desc: "Ridge vent is the ventilation strip installed along the peak of the roof. Ridge cap shingles cover it. Both are removed and replaced during any full re-roof. Adjusters sometimes exclude the vent entirely or include ridge cap but not the vent material underneath, or vice versa.",
              },
              {
                num: "07",
                title: "Synthetic Underlayment (Felt Upgrade)",
                desc: "Modern building code in many jurisdictions requires synthetic underlayment instead of traditional 15-pound felt paper. Synthetic underlayment costs more but provides better water resistance and durability. Adjusters who default to felt paper pricing leave a cost gap that the contractor absorbs unless a supplement is filed.",
              },
            ].map((item) => (
              <div key={item.num} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">
                    {item.num}
                  </span>
                  <h3 className="text-[var(--white)] font-semibold text-sm">
                    {item.title}
                  </h3>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 mb-6">
            <p className="text-amber-400 text-sm leading-relaxed">
              <strong>Important:</strong> These are not luxury upgrades or
              upsells. Every item on this list is either required by current
              building code, required by the shingle manufacturer&apos;s
              installation warranty, or both. Omitting them is not &ldquo;saving
              money&rdquo; — it is installing a roof that does not meet code and
              voids the warranty.
            </p>
          </div>

          {/* Section 4 — Building Code Requirements */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="building-code"
          >
            Building Code Requirements That Carriers Ignore
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Here is something most homeowners do not know: when your roof is
            replaced, the new installation must comply with the{" "}
            <em>current</em> building code — not the code that was in effect
            when the original roof was installed. This is called &ldquo;code
            upgrade&rdquo; and it is one of the most significant sources of
            supplement money.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Your original roof might have been installed in 2005 with 15-pound
            felt paper, no ice and water shield, and no drip edge on the rakes.
            That was code-compliant in 2005. But the 2018 or 2021 International
            Residential Code (IRC) — adopted by most U.S. jurisdictions — now
            requires all of those items. When your contractor pulls a permit for
            the replacement, the building inspector will enforce current code.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Insurance carriers know this. Many policies explicitly include
            &ldquo;ordinance or law&rdquo; coverage that pays for code upgrades.
            But adjusters frequently write estimates to the old standard anyway,
            banking on the fact that most homeowners and many contractors will
            not push back. The supplement is how you push back — with code
            citations, not opinions.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Common code-mandated items that generate supplements include: ice
            and water shield in valleys and at eaves (IRC R905.1.2), drip edge
            on all roof edges (IRC R905.2.8.5), proper attic ventilation ratios
            (IRC R806), and fire-rated underlayment in wildfire interface zones.
            Your contractor should cite the specific code section in the
            supplement letter — carriers respond to code citations far more
            favorably than vague requests.
          </p>

          {/* Stat Block */}
          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">
                Code upgrade insight:
              </strong>{" "}
              Contractors who cite specific IRC sections in their supplement
              letters report a{" "}
              <strong className="text-[var(--white)]">
                40% higher approval rate
              </strong>{" "}
              on code-related line items compared to those who simply write
              &ldquo;per code&rdquo; without a reference number.
            </p>
          </div>

          {/* Section 5 — How to Write a Supplement Letter */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="how-to-write"
          >
            How to Write a Supplement Letter That Gets Approved
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A supplement letter is the cover document you send to the insurance
            carrier alongside your supporting evidence. It needs to do three
            things: identify exactly what is missing from the original estimate,
            explain why each item is necessary, and reference the evidence that
            proves it. Here is the structure that works:
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                step: "1",
                title: "Reference the claim",
                detail:
                  "Open with the claim number, policy number, insured name, property address, and date of loss. The adjuster handles hundreds of claims — make it effortless for them to pull up the right file.",
              },
              {
                step: "2",
                title: "State the purpose",
                detail:
                  "One sentence: \"This supplement requests additional payment for items not included in the original estimate that are required to complete the roof replacement per manufacturer specifications and current building code.\"",
              },
              {
                step: "3",
                title: "List each line item individually",
                detail:
                  "For every missing item, include the Xactimate line-item code (if known), a description of the item, the quantity needed, the unit cost, and the total. Do not lump items together. Each line item should be independently justifiable.",
              },
              {
                step: "4",
                title: "Cite your authority",
                detail:
                  "For code items, cite the IRC section. For manufacturer requirements, cite the installation manual page. For material upgrades, cite the spec sheet. Adjusters cannot deny items that are backed by published standards.",
              },
              {
                step: "5",
                title: "Attach photo documentation",
                detail:
                  "Every line item should have a corresponding photo. Rotted decking? Show the rot. Missing ice and water shield? Show the bare valley. Corroded pipe boots? Show the cracked rubber. Photos turn opinions into evidence.",
              },
              {
                step: "6",
                title: "State the total and request a timeline",
                detail:
                  "Close with the total supplement amount and a professional request for response within a specific timeframe (e.g., 10 business days). This sets expectations and creates a paper trail if the carrier delays.",
              },
            ].map((item) => (
              <div key={item.step} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">
                    {item.step}
                  </span>
                  <h3 className="text-[var(--white)] font-semibold text-sm">
                    {item.title}
                  </h3>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>

          {/* Section 6 — Documentation */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="documentation"
          >
            What to Include in Your Supplement Documentation
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The supplement letter is the cover page. Behind it, you need a
            documentation package that leaves the adjuster no room to deny your
            request. The stronger the package, the faster the approval. Here is
            what a complete supplement package includes:
          </p>
          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              Complete Supplement Package Checklist:
            </p>
            <div className="space-y-2">
              {[
                "Supplement cover letter with claim reference and line-item breakdown",
                "Before and after photos of each supplemented item",
                "Tear-off photos showing hidden damage discovered during removal",
                "Manufacturer installation specifications for products being installed",
                "Building code citations (IRC section numbers) for code-required items",
                "Xactimate-format estimate or line-item pricing sheet",
                "Roof diagram or measurement report showing quantities",
                "Permit documentation if a building permit was required",
                "Previous correspondence with the adjuster for context",
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 text-sm text-[var(--gray)]"
                >
                  <span className="text-green-500 mt-0.5 shrink-0">
                    &#x2713;
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Missing even one of these elements gives the carrier a reason to
            delay or deny. The most common reason supplements are denied is not
            that the work was unnecessary — it is that the documentation was
            insufficient. Adjusters are trained to look for gaps. Do not give
            them one.
          </p>

          {/* Section 7 — How Long Supplements Take */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="timeline"
          >
            How Long Does the Supplement Process Take?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            This is the question every homeowner asks, and the honest answer is:
            it depends on your documentation quality and your carrier. Here are
            realistic timelines:
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                scenario: "Well-documented supplement, responsive carrier",
                time: "7-10 business days",
                detail:
                  "Complete package with photos, code citations, and Xactimate-format line items sent to a carrier with a dedicated supplement department. This is the best-case scenario and achievable with proper preparation.",
              },
              {
                scenario: "Average supplement, typical carrier",
                time: "14-21 business days",
                detail:
                  "Adequate documentation but missing some elements. The carrier may request additional photos or clarification before approving. One round of back-and-forth correspondence is common.",
              },
              {
                scenario: "Incomplete documentation or re-inspection required",
                time: "30-45+ business days",
                detail:
                  "The carrier sends their own adjuster back to the property for a re-inspection, or the supplement is missing key evidence. Multiple rounds of correspondence. This is where claims stall and contractors lose money waiting.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <p className="font-semibold text-[var(--white)] text-sm">
                    {item.scenario}
                  </p>
                  <span className="text-[var(--cyan)] font-mono text-sm shrink-0">
                    {item.time}
                  </span>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            The single biggest factor in supplement speed is documentation
            quality. Carriers approve complete packages faster because there is
            nothing to dispute. Every missing photo or uncited code reference is
            a reason for the adjuster to kick the file back to you — adding
            another 5-10 business days each time.
          </p>

          {/* Section 8 — What to Do If Denied */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="denied-supplement"
          >
            What to Do If Your Supplement Is Denied
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A denied supplement is not the end of the road. Carriers deny
            supplements for specific, stated reasons — and each reason has a
            counter-strategy. Here is how to respond:
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                reason: "\"Not related to the covered loss\"",
                counter:
                  "Provide additional photos and a causation narrative linking the supplemented item directly to the storm damage. If pipe boots cracked due to hail impact, show the impact marks. If step flashing was displaced by wind, show the directional damage pattern.",
              },
              {
                reason: "\"Maintenance or pre-existing condition\"",
                counter:
                  "This is the most common denial tactic. Counter with dated photos showing the condition before and after the loss event, weather data proving the storm severity, and manufacturer documentation showing expected lifespan versus actual age of the component.",
              },
              {
                reason: "\"Insufficient documentation\"",
                counter:
                  "This is actually the easiest denial to overcome. The carrier is telling you exactly what they need — more evidence. Resubmit with additional photos, code citations, and manufacturer specs addressing each denied line item specifically.",
              },
              {
                reason: "\"Not code-required in this jurisdiction\"",
                counter:
                  "Research your local building code adoption. Cite the specific adopted code year and section number. If your jurisdiction has adopted the 2018 or 2021 IRC, the requirements are clear. Contact your local building department for a written confirmation if needed.",
              },
              {
                reason: "\"Included in the original estimate\"",
                counter:
                  "Review the original estimate line by line. If the carrier claims drip edge was included but the estimate does not have a drip edge line item, point this out explicitly with a side-by-side comparison of the estimate versus your supplement request.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">
                    &#x2715;
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--white)] text-sm">
                      {item.reason}
                    </p>
                    <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                      {item.counter}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            If the carrier continues to deny a legitimate supplement after
            resubmission, you have escalation options: request a supervisor
            review, file a complaint with your state&apos;s Department of
            Insurance, hire a licensed public adjuster, or consult an attorney
            who specializes in insurance claims. Most legitimate supplements are
            resolved before reaching this stage — carriers prefer to settle
            well-documented requests rather than face regulatory scrutiny.
          </p>

          {/* Stat Block */}
          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">
                Approval rate insight:
              </strong>{" "}
              Industry data shows that{" "}
              <strong className="text-[var(--white)]">
                85-90% of well-documented supplements are approved
              </strong>{" "}
              on the first or second submission. The 10-15% that require
              escalation are typically disputes over scope interpretation, not
              documentation quality.
            </p>
          </div>

          {/* Section 9 — How dumbroof.ai Auto-Generates Supplements */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="dumbroof-supplements"
          >
            How dumbroof.ai Auto-Generates Supplements in 15 Minutes
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Everything described above — the line-item breakdown, the code
            citations, the manufacturer specs, the photo documentation, the
            professional supplement letter — takes an experienced contractor 2-4
            hours to compile manually for a single claim. Most contractors
            either skip supplements entirely (leaving money on the table) or
            outsource them to supplement companies that charge 10-15% of the
            approved amount.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai eliminates both problems. When you upload your claim
            photos and measurements, the AI cross-references the carrier&apos;s
            original estimate against a complete scope of work — checking for
            every line item that should be present based on your roof type,
            local building code, and manufacturer installation requirements.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The system automatically identifies missing items and generates a
            complete supplement package including:
          </p>
          <div className="glass-card p-6 mb-6">
            <div className="space-y-2">
              {[
                "A professional supplement letter addressed to the carrier with claim references",
                "Line-item pricing in Xactimate-compatible format with accurate quantities",
                "Building code citations specific to your jurisdiction (IRC section numbers)",
                "Manufacturer specification references for each material being installed",
                "Photo documentation organized by line item for easy adjuster review",
                "A carrier comparison showing the original estimate versus the complete scope",
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 text-sm text-[var(--gray)]"
                >
                  <span className="text-green-500 mt-0.5 shrink-0">
                    &#x2713;
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The entire process takes approximately 15 minutes from photo upload
            to completed supplement package. No Xactimate license required. No
            supplement company taking a percentage of your approval. No 2-4
            hours of manual work per claim.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Contractors using dumbroof.ai report supplement approval rates
            consistent with or exceeding industry averages, because the AI
            produces the same level of documentation that top-tier supplement
            companies deliver — code citations, manufacturer specs, organized
            photos, professional formatting — without the cost or delay.
          </p>

          {/* FAQ Section */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-6"
            id="faq"
          >
            Frequently Asked Questions About Roofing Supplements
          </h2>
          <div className="space-y-4 mb-10">
            {faqSchema.mainEntity.map(
              (faq: { name: string; acceptedAnswer: { text: string } }) => (
                <div key={faq.name} className="glass-card p-5">
                  <h3 className="text-sm font-semibold text-[var(--white)] mb-2">
                    {faq.name}
                  </h3>
                  <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                    {faq.acceptedAnswer.text}
                  </p>
                </div>
              )
            )}
          </div>

          {/* Related Articles */}
          <div className="mt-14">
            <h3 className="text-lg font-bold text-[var(--white)] mb-4">
              Related Articles
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <a
                href="/learn/what-is-hail-damage"
                className="glass-card p-5 hover:border-white/30 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                  Damage Identification
                </span>
                <p className="text-sm font-semibold text-[var(--white)] mt-1">
                  What Is Hail Damage?
                </p>
              </a>
              <a
                href="/learn/how-to-automate-insurance-invoicing"
                className="glass-card p-5 hover:border-white/30 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                  Business Operations
                </span>
                <p className="text-sm font-semibold text-[var(--white)] mt-1">
                  Automate Insurance Invoicing
                </p>
              </a>
            </div>
          </div>

          {/* CTA */}
          <div className="bg-gradient-to-r from-[var(--pink)]/10 via-[var(--purple)]/10 to-[var(--blue)]/10 border border-white/10 rounded-2xl p-8 text-center mt-14">
            <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
              Stop Leaving Supplement Money on the Table
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              Upload your claim photos and measurements. dumbroof.ai
              auto-generates your supplement letter, line-item estimate, and
              code citations in 15 minutes — ready to send to the carrier.
            </p>
            <a
              href="/signup"
              className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
            >
              Try 3 Free Claims
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
