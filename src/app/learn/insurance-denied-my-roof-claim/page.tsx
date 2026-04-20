import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title:
    "My Insurance Company Denied My Roof Claim — Now What? Steps to Fight Back",
  description:
    "Your roof claim was denied. Learn exactly how to respond: request adjuster field notes, cite policy language, document with time-stamped photos, and reopen your claim. Guide for homeowners and contractors from dumbroof.ai.",
  keywords: [
    "insurance denied roof claim",
    "roof claim denial",
    "appeal roof insurance claim",
    "insurance denial letter roof",
    "roof damage claim denied",
    "fight insurance denial roof",
    "reopen denied roof claim",
  ],
  openGraph: {
    title:
      "My Insurance Company Denied My Roof Claim — Now What? Steps to Fight Back",
    description:
      "Your roof claim was denied. Learn exactly how to respond: request adjuster field notes, cite policy language, document with time-stamped photos, and reopen your claim.",
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
      name: "Can I reopen a denied roof insurance claim?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Most carriers allow you to reopen a denied claim by submitting new evidence — such as a second inspection report, updated photos with time stamps, or a contractor's damage assessment that contradicts the adjuster's findings. There is no law preventing you from requesting a re-inspection or filing a formal appeal. Start by writing a letter that references your policy number, the denial reason, and the specific new evidence you are providing.",
      },
    },
    {
      "@type": "Question",
      name: "How do I get my insurance adjuster's field notes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Request the adjuster's field notes, photos, and scope of loss in writing — either by email or certified letter to your carrier's claims department. In most states, insurers are required to provide this documentation upon request. The field notes reveal exactly what the adjuster observed, measured, and photographed, which allows you to identify errors, omissions, or areas the adjuster failed to inspect.",
      },
    },
    {
      "@type": "Question",
      name: "What is a cosmetic damage exclusion on a roof policy?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A cosmetic damage exclusion is a policy endorsement that limits or eliminates coverage for damage that affects appearance but not the functional integrity of the roof. Carriers like State Farm and Allstate have added these endorsements to many policies since 2014. Under a cosmetic exclusion, dents in metal roofing or bruised shingles may be denied even if clearly caused by hail — unless the damage also compromises the roof's ability to shed water.",
      },
    },
    {
      "@type": "Question",
      name: "Should I hire a public adjuster after a roof claim denial?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A public adjuster can be valuable when the denied amount is significant (typically $10,000+), when you lack documentation expertise, or when the carrier is unresponsive to your appeal. Public adjusters typically charge 10-15% of the recovered amount. However, if the denial is based on weak documentation, tools like dumbroof.ai can generate carrier-grade evidence for a fraction of the cost — allowing you to supplement the claim yourself before escalating to a public adjuster.",
      },
    },
    {
      "@type": "Question",
      name: "How long do I have to appeal a denied roof claim?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Appeal timelines vary by state and carrier. Most states allow 1-3 years to reopen or dispute a denied claim, but some carriers impose shorter contractual deadlines (60-180 days) in their policy language. Check your policy's 'Duties After Loss' and 'Suit Against Us' sections for specific deadlines. Acting within 30 days of the denial letter gives you the strongest position, as evidence is still fresh and adjusters can more easily be reassigned for re-inspection.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline:
    "My Insurance Company Denied My Roof Claim — Now What? Steps to Fight Back",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage:
    "https://www.dumbroof.ai/learn/insurance-denied-my-roof-claim",
  description:
    "Your roof claim was denied. Learn exactly how to respond: request adjuster field notes, cite policy language, document with time-stamped photos, and reopen your claim.",
};

export default function InsuranceDeniedRoofClaimPage() {
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
              Insurance Denied My Roof Claim
            </span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Insurance Claims
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              My Insurance Company Denied My Roof Claim — Now What?
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 14 min read
            </p>
          </header>

          {/* Direct Answer — AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">
              If your insurance company denied your roof claim,
            </strong>{" "}
            you are not out of options. Start by requesting the adjuster&apos;s
            field notes and photos in writing, then compare their findings
            against your policy language and the actual condition of your roof.
            Most denials are based on insufficient documentation, cosmetic
            damage exclusions, or wear-and-tear arguments — all of which can be
            challenged with proper evidence. You have the right to reopen the
            claim, request a re-inspection, hire a public adjuster, or
            supplement with new documentation that contradicts the denial.
          </p>

          {/* Key Stat Box */}
          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong>{" "}
              Insurance carriers deny approximately{" "}
              <strong className="text-[var(--white)]">
                1 in 5 homeowner roof claims
              </strong>{" "}
              on first submission. However, policyholders who formally appeal
              with updated documentation recover an approved payout in{" "}
              <strong className="text-[var(--white)]">
                over 40% of cases
              </strong>
              . The difference between a denied claim and an approved one is
              almost always the quality of the evidence package.
            </p>
          </div>

          {/* Section 1: Common Reasons for Denial */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="common-reasons"
          >
            Why Did Your Insurance Company Deny the Roof Claim?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Insurance carriers deny roof claims for a limited number of
            reasons, and understanding which one applies to your situation is
            the first step toward overturning it. The denial letter itself is
            your roadmap — it must cite a specific policy provision or coverage
            exclusion. If it doesn&apos;t, that&apos;s already grounds for
            dispute.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Here are the most common denial reasons carriers use, along with
            the real-world tactics behind each:
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Wear and Tear / Age of Roof",
                desc: "The carrier argues that the damage is the result of normal aging, not a covered peril like wind or hail. This is the single most common denial tactic. Adjusters will note granule loss, curling, or cracking and attribute it to age — even when storm damage is clearly present alongside normal wear. The fix: get a contractor inspection that separates storm damage from pre-existing conditions with photo evidence of both.",
              },
              {
                num: "02",
                title: "Cosmetic Damage Exclusion",
                desc: "Since 2014, carriers including State Farm, Allstate, and Farmers have added cosmetic damage exclusions to many policies. These endorsements deny coverage for damage that 'affects appearance but not functional integrity.' Dents in metal roofing, bruised shingles without cracks, and soft-metal damage (gutters, vents) are commonly excluded under these clauses. Check your policy declarations page for endorsements labeled 'Cosmetic Exclusion' or 'Limitation of Coverage for Cosmetic Damage.'",
              },
              {
                num: "03",
                title: "Storm Date Dispute",
                desc: "The carrier claims the damage occurred before or after the storm event you reported. Adjusters reference weather data and argue that wind speeds at the nearest weather station didn't reach damage thresholds, or that the hail reported was too small. They may use data from a station 20+ miles away rather than hyperlocal records. Counter this with NOAA storm reports, Weather Underground station data, and time-stamped photos taken within days of the event.",
              },
              {
                num: "04",
                title: "Insufficient Documentation",
                desc: "The adjuster's inspection found 'no damage' or 'insufficient damage to warrant replacement.' This often happens when the carrier's adjuster spends 15-20 minutes on a roof and misses damage on slopes they didn't walk, or inspects from the ground with binoculars. Inadequate documentation on YOUR side compounds the problem — blurry photos, no measurements, no weather correlation.",
              },
              {
                num: "05",
                title: "Pre-Existing Damage / Prior Claims",
                desc: "The carrier attributes current damage to a prior storm event that was already paid or denied, or argues the roof had pre-existing damage before your policy inception. They cross-reference CLUE reports (Comprehensive Loss Underwriting Exchange) to find previous claims at the address. If a prior claim exists, you need documentation proving the NEW damage is distinct from what was previously reported.",
              },
              {
                num: "06",
                title: "Maintenance / Installation Defect",
                desc: "The carrier classifies the damage as a maintenance issue (clogged gutters causing ice dams, improperly sealed flashing) or installation defect (shingles nailed too high, insufficient starter strip). Homeowner policies explicitly exclude 'faulty workmanship' — so if the carrier can frame storm damage as an installation problem, they avoid the payout.",
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

          {/* Section 2: How to Respond */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="how-to-respond"
          >
            How to Respond to a Roof Claim Denial — Step by Step
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Do not accept the denial letter as final. Insurance denials are
            the beginning of a process, not the end. Carriers count on
            policyholders giving up after the first &ldquo;no.&rdquo; Here is
            the exact sequence to follow:
          </p>

          <div className="space-y-3 mb-6">
            {[
              {
                step: "Step 1: Read the denial letter line by line",
                detail:
                  "Identify the exact policy provision or exclusion cited. If the letter says 'wear and tear,' find that exclusion in your policy. If it references a specific endorsement (like a cosmetic exclusion), locate the endorsement number on your declarations page. The denial must cite a specific, applicable policy term — vague language like 'damage does not meet criteria' without a policy citation is disputable.",
              },
              {
                step: "Step 2: Request the adjuster's complete file",
                detail:
                  "Send a written request (email or certified letter) to the claims department asking for the adjuster's field notes, all photos taken during inspection, the scope of loss document, and any engineering or third-party reports. In most states, you are entitled to this documentation. The adjuster's notes often reveal that they spent minimal time on the roof, missed entire slopes, or noted damage they later excluded from the report.",
              },
              {
                step: "Step 3: Get an independent contractor inspection",
                detail:
                  "Hire a licensed roofing contractor to perform a full inspection and provide a written damage report with measurements, photo documentation, and material identification. The contractor's report should specifically address the denial reason — if the carrier said 'wear and tear,' the contractor should identify and document the storm-caused damage separately from age-related deterioration.",
              },
              {
                step: "Step 4: Gather weather data for the loss date",
                detail:
                  "Pull certified weather data from NOAA, Weather Underground, or local airport weather stations for the date of the storm event. Document wind speeds, hail size, storm direction, and duration. Use the closest weather station to the property — not the one the carrier cherry-picked 25 miles away. If hail was reported, reference the NOAA Storm Events Database for official records.",
              },
              {
                step: "Step 5: Write a formal appeal letter",
                detail:
                  "Address it to the claims manager (not the adjuster who denied it). Reference the policy number, claim number, date of loss, and the specific denial reason. Present your new evidence point by point. Cite the applicable policy language that supports coverage. Be factual, not emotional. Request a re-inspection by a different adjuster and include a deadline for response (typically 15-30 days).",
              },
              {
                step: "Step 6: File a complaint with your state DOI if needed",
                detail:
                  "If the carrier doesn't respond to your appeal within 30 days or continues to deny without addressing your new evidence, file a complaint with your state Department of Insurance (DOI). The DOI will open an investigation and require the carrier to respond. This puts regulatory pressure on the insurer and creates a paper trail that strengthens any future legal action.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-start gap-3">
                  <span className="text-green-500 mt-0.5 shrink-0">
                    &#x2713;
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--white)] text-sm">
                      {item.step}
                    </p>
                    <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Section 3: What to Include in a Reopened Claim */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="reopened-claim"
          >
            What to Include When You Reopen a Denied Roof Claim
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A reopened claim is only as strong as the new evidence you submit.
            Carriers have no obligation to reverse a denial if you simply
            resubmit the same information. Your evidence package must directly
            address and refute the original denial reason with documentation
            the adjuster didn&apos;t have — or chose to ignore — during the
            first inspection.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            The strongest reopened claims include all of the following:
          </p>

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              Evidence Package Checklist:
            </p>
            <div className="space-y-2">
              {[
                "Time-stamped photos of every damaged area (date embedded in EXIF metadata, not handwritten)",
                "Close-up photos showing storm damage vs. wear patterns — carriers need to see the difference",
                "Full roof diagram with damage locations plotted by slope and compass direction",
                "Certified weather data from the closest station to the property on the date of loss",
                "Contractor's written inspection report with license number and measurements",
                "Side-by-side comparison: adjuster's photos vs. your contractor's photos of the same areas",
                "Copy of relevant policy language highlighted to show the covered peril applies",
                "Written response to each denial reason citing specific evidence that contradicts it",
                "Material specifications showing that the documented damage pattern matches the claimed peril (wind, hail, etc.)",
                "Timeline showing when damage was first observed relative to the storm event",
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

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 mb-6">
            <p className="text-amber-400 text-sm leading-relaxed">
              <strong>Pro tip:</strong> When photographing damage, include a
              chalk circle around each impact or damaged area, a ruler or coin
              for scale, and shoot from both 3 feet away (context) and 12
              inches away (detail). Adjusters on re-inspection will look for
              these same marks, which creates visual continuity between your
              documentation and their follow-up visit.
            </p>
          </div>

          {/* Section 4: Your Rights as a Policyholder */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="policyholder-rights"
          >
            Your Rights as a Policyholder After a Roof Claim Denial
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Insurance is a contract. You pay premiums in exchange for coverage
            of specified perils. When a carrier denies a legitimate claim,
            they must follow state-regulated procedures — and you have legal
            protections designed to prevent bad-faith denials. Knowing your
            rights changes the dynamic from &ldquo;hoping they approve
            it&rdquo; to &ldquo;holding them to their contractual
            obligations.&rdquo;
          </p>

          <div className="space-y-3 mb-6">
            {[
              {
                right: "Right to a written explanation",
                detail:
                  "Every denial must include the specific policy provision or exclusion that justifies the decision. A denial letter that says 'claim does not meet our criteria' without citing policy language is insufficient in most states and can be challenged through your DOI.",
              },
              {
                right: "Right to the adjuster's documentation",
                detail:
                  "You can request the adjuster's field notes, photographs, measurements, scope of loss, and any third-party reports used in the coverage decision. Most states require carriers to provide these within 15-30 days of your written request.",
              },
              {
                right: "Right to a re-inspection",
                detail:
                  "You can request that a different adjuster re-inspect the property. Carriers are not required to grant this automatically, but a formal written request citing new evidence makes it difficult to refuse — especially if you've filed a DOI complaint.",
              },
              {
                right: "Right to invoke appraisal",
                detail:
                  "Most homeowner policies include an appraisal clause. If you and the carrier disagree on the amount of loss (not whether coverage exists), either party can invoke appraisal. Each side hires an appraiser, and the two appraisers select an umpire. Agreement between any two of the three is binding. This is faster and cheaper than litigation.",
              },
              {
                right: "Right to file a DOI complaint",
                detail:
                  "Every state has a Department of Insurance that investigates consumer complaints against carriers. Filing a complaint creates an official record, triggers a regulatory review, and often results in the carrier revisiting the claim. In states like Texas and Florida, DOI complaints carry significant weight.",
              },
              {
                right: "Right to legal action",
                detail:
                  "If the carrier acts in bad faith — unreasonable denial, failure to investigate, or ignoring evidence — you may have grounds for a bad-faith lawsuit. Many states allow policyholders to recover damages beyond the claim amount, including attorney's fees, penalty interest, and in some cases treble damages.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--cyan)] mt-0.5 shrink-0 font-bold text-sm">
                    &#x2192;
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--white)] text-sm">
                      {item.right}
                    </p>
                    <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Stat block */}
          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">
                Carrier behavior:
              </strong>{" "}
              In states with active DOI enforcement, carriers reverse or
              increase denied claims at significantly higher rates after a
              complaint is filed. Texas, Florida, and Colorado have some of
              the strongest consumer protection frameworks for property
              insurance disputes. Filing a DOI complaint costs nothing and
              takes{" "}
              <strong className="text-[var(--white)]">15-20 minutes</strong>.
            </p>
          </div>

          {/* Section 5: Public Adjuster vs. Supplement Yourself */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="public-adjuster-vs-supplement"
          >
            When to Hire a Public Adjuster vs. Supplement the Claim Yourself
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            After a denial, you face a decision: hire a public adjuster (PA)
            to negotiate on your behalf, or build the evidence package
            yourself and supplement the claim directly. Both paths can work
            — the right choice depends on the complexity of the denial, the
            dollar amount at stake, and your comfort level with the process.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="glass-card p-5">
              <h3 className="text-[var(--white)] font-semibold text-sm mb-3">
                Hire a Public Adjuster When:
              </h3>
              <div className="space-y-2">
                {[
                  "Claim value exceeds $10,000-$15,000",
                  "Carrier is unresponsive to your appeal",
                  "Denial involves complex policy language (appraisal, bad faith)",
                  "Multiple damage types across the property (roof + siding + interior)",
                  "You've already supplemented once and been denied again",
                  "The carrier sent an engineer report and you need an expert rebuttal",
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm text-[var(--gray-muted)]"
                  >
                    <span className="text-[var(--cyan)] mt-0.5 shrink-0">
                      &#x2713;
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--gray-dim)] mt-3">
                Typical cost: 10-15% of recovered amount
              </p>
            </div>
            <div className="glass-card p-5">
              <h3 className="text-[var(--white)] font-semibold text-sm mb-3">
                Supplement It Yourself When:
              </h3>
              <div className="space-y-2">
                {[
                  "Denial is based on weak or incomplete documentation",
                  "Adjuster missed damage on slopes they didn't inspect",
                  "You have a contractor who can provide a thorough inspection report",
                  "Claim value is under $10,000 (PA fee may eat the margin)",
                  "Carrier cited 'insufficient evidence' rather than a policy exclusion",
                  "You have access to AI documentation tools like dumbroof.ai",
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm text-[var(--gray-muted)]"
                  >
                    <span className="text-green-500 mt-0.5 shrink-0">
                      &#x2713;
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--gray-dim)] mt-3">
                Typical cost: contractor inspection fee + documentation tools
              </p>
            </div>
          </div>

          <p className="text-[var(--gray)] leading-relaxed mb-4">
            For contractors managing multiple denied claims across a book of
            business, the math is clear: building supplement packages
            in-house with AI documentation tools costs a fraction of public
            adjuster fees per claim and keeps the revenue in your operation.
            Public adjusters add the most value on high-dollar, high-complexity
            claims where policy interpretation or bad-faith arguments are in
            play.
          </p>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 mb-6">
            <p className="text-amber-400 text-sm leading-relaxed">
              <strong>Important:</strong> In some states, contractors cannot
              act as public adjusters or negotiate with carriers on behalf of
              homeowners. Know your state&apos;s licensing requirements. What
              contractors CAN do in every state is provide documentation,
              inspection reports, and damage assessments that homeowners use
              in their own appeals.
            </p>
          </div>

          {/* Section 6: How dumbroof.ai Helps */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="how-dumbroof-helps"
          >
            How dumbroof.ai Helps You Fight a Denied Roof Claim
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Most roof claim denials come down to one thing: the evidence
            package wasn&apos;t strong enough to overcome the carrier&apos;s
            default position. dumbroof.ai was built to solve exactly this
            problem — generating forensic-grade documentation that addresses
            the specific reasons carriers deny claims.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Here is what dumbroof.ai generates for every claim — including
            reopened and supplemented claims:
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Forensic Causation Report",
                desc: "AI-generated analysis that separates storm damage from pre-existing wear and tear — directly countering the #1 denial reason. The report maps damage patterns to weather data, identifies peril-specific indicators (hail impacts vs. wind lift vs. thermal cycling), and provides the causal link that adjusters look for.",
              },
              {
                num: "02",
                title: "Xactimate-Style Estimate with Code Citations",
                desc: "Line-item estimate formatted to match industry standard Xactimate output, including local building code requirements that carriers must cover under ordinance-or-law provisions. When the adjuster's estimate is low, this document shows exactly where they under-scoped the job.",
              },
              {
                num: "03",
                title: "Carrier Comparison Report",
                desc: "Side-by-side analysis comparing the carrier's adjuster scope against the actual damage documented by your contractor. Highlights every line item the adjuster missed, under-measured, or excluded — making it impossible for the carrier to claim the damage 'wasn't there.'",
              },
              {
                num: "04",
                title: "Supplement Letter",
                desc: "Pre-written, policy-language-aware letter requesting additional funds for items the original adjuster missed. References specific policy provisions that support coverage and includes the documentation to back each line item.",
              },
              {
                num: "05",
                title: "Cover Letter for Claims Submission",
                desc: "Professional cover letter summarizing the evidence package, referencing the claim number and denial reason, and requesting re-review. Formatted for the claims manager — not the field adjuster — to ensure it reaches the decision-maker.",
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

          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Over{" "}
            <strong className="text-[var(--white)]">$12.5 million</strong> in
            claims have been processed through dumbroof.ai, with{" "}
            <strong className="text-[var(--white)]">$2.6 million</strong> in
            approved supplements. The platform generates a complete evidence
            package in 15 minutes — turning the documentation gap that caused
            the denial into the evidence strength that reverses it.
          </p>

          {/* FAQ Section */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-6"
            id="faq"
          >
            Frequently Asked Questions About Denied Roof Claims
          </h2>
          <div className="space-y-4 mb-10">
            {faqSchema.mainEntity.map((faq) => (
              <div key={faq.name} className="glass-card p-5">
                <h3 className="text-sm font-semibold text-[var(--white)] mb-2">
                  {faq.name}
                </h3>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                  {faq.acceptedAnswer.text}
                </p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="bg-gradient-to-r from-[var(--pink)]/10 via-[var(--purple)]/10 to-[var(--blue)]/10 border border-white/10 rounded-2xl p-8 text-center mt-14">
            <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
              Denied? Build the Evidence That Reverses It.
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              Upload your roof damage photos and measurements. Get 5
              forensic-grade documents in 15 minutes — the same evidence
              package that has reversed denials and recovered millions in
              approved claims.
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
                href="/learn/what-is-wind-damage"
                className="glass-card p-5 hover:border-white/30 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                  Damage Identification
                </span>
                <p className="text-sm font-semibold text-[var(--white)] mt-1">
                  What Is Wind Damage?
                </p>
              </a>
            </div>
          </div>
        </article>

        <Footer />
      </main>
    </>
  );
}
