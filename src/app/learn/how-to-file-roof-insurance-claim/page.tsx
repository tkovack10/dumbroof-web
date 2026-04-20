import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title:
    "How to File a Roof Insurance Claim After a Storm (Step-by-Step Guide)",
  description:
    "Step-by-step guide to filing a roof insurance claim after storm damage. Learn what to document, what to say to your carrier, how to handle the adjuster, when to supplement, and mistakes that kill claims.",
  keywords: [
    "how to file roof insurance claim",
    "file storm damage claim",
    "roof damage insurance process",
    "roof insurance claim steps",
    "storm damage claim guide",
  ],
  openGraph: {
    title:
      "How to File a Roof Insurance Claim After a Storm (Step-by-Step Guide)",
    description:
      "The ultimate step-by-step guide to filing a roof insurance claim. What to document, what to say, how to handle the adjuster, and common mistakes that kill claims.",
    type: "article",
    publishedTime: "2026-04-03T00:00:00Z",
    authors: ["Tom Kovack Jr."],
  },
};

const faqItems = [
  {
    question:
      "How long do I have to file a roof insurance claim after a storm?",
    answer:
      "Deadlines vary by state and policy. Most states allow 1-2 years from the date of loss, but some policies require notice within 60-90 days. Florida requires notice within 2 years, while Texas allows up to 2 years for property damage claims. Always check your specific policy and state statute of limitations -- filing sooner is always better because evidence degrades over time.",
  },
  {
    question:
      "Should I get my own estimate before the insurance adjuster comes?",
    answer:
      "Yes, absolutely. Having a contractor-generated estimate before the adjuster arrives gives you a documented baseline to compare against the carrier's estimate. If the adjuster's estimate is significantly lower, you have line-item documentation to support a supplement. Never rely solely on the carrier's estimate -- they work for the insurance company, not you.",
  },
  {
    question:
      "What should I do if the insurance company denies my roof claim?",
    answer:
      "First, request the denial in writing with the specific reason. Then review your policy language against their stated reason. Common wrongful denial reasons include 'wear and tear' on storm-damaged roofs and 'cosmetic damage' exclusions applied to functional damage. You can file a formal appeal with supporting documentation, hire a public adjuster, or consult an insurance attorney. Many denied claims are overturned on appeal with proper documentation.",
  },
  {
    question: "Do I need to use the contractor my insurance company recommends?",
    answer:
      "No. You have the legal right to choose your own contractor in every state. Insurance companies may suggest 'preferred vendors' but cannot require you to use them. Preferred vendor programs often benefit the carrier (lower costs) rather than the homeowner (quality work). Choose a licensed, insured contractor who specializes in insurance restoration and will advocate for proper scope and pricing.",
  },
  {
    question:
      "What is a supplement and how does it increase my claim payout?",
    answer:
      "A supplement is a request for additional funds after the original claim estimate was approved, based on damage or work that was not included in the initial scope. Common supplement items include hidden damage discovered during tear-off, code upgrades required by local building departments, and line items the adjuster missed. Supplements can increase total claim value by 30-60% on average when properly documented with photos, code citations, and Xactimate line items.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline:
    "How to File a Roof Insurance Claim After a Storm (Step-by-Step Guide)",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage:
    "https://www.dumbroof.ai/learn/how-to-file-roof-insurance-claim",
  description:
    "Step-by-step guide to filing a roof insurance claim after storm damage. Learn what to document, what to say to your carrier, how to handle the adjuster, when to supplement, and mistakes that kill claims.",
};

export default function HowToFileRoofInsuranceClaim() {
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
              How to File a Roof Insurance Claim
            </span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Insurance Claims
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              How to File a Roof Insurance Claim After a Storm (Step-by-Step)
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 16 min read
            </p>
          </header>

          {/* Direct Answer -- AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">
              To file a roof insurance claim after a storm,
            </strong>{" "}
            document all damage with photos and video before touching anything,
            call your insurance carrier to open a claim, get an independent
            contractor estimate, attend the adjuster inspection with your
            contractor, review the estimate line by line, and supplement anything
            the adjuster missed. The entire process typically takes 2-8 weeks
            from filing to payment, depending on your carrier and the complexity
            of the damage.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong>{" "}
              Insurance claims with professional contractor documentation and
              photo evidence are approved at a{" "}
              <strong className="text-[var(--white)]">
                40-60% higher rate
              </strong>{" "}
              than claims filed without supporting evidence. The average
              residential roof insurance claim in the U.S. is{" "}
              <strong className="text-[var(--white)]">$11,000-$15,000</strong>,
              but underdocumented claims routinely settle for 30-50% less than
              the actual repair cost.
            </p>
          </div>

          {/* Section 1: Step-by-Step Filing Process */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="step-by-step-filing-process"
          >
            Step-by-Step: How to File a Roof Insurance Claim
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Filing an insurance claim is not complicated, but the order matters.
            Each step builds evidence and leverage for the next. Skip a step and
            you lose negotiating power. Here is the exact process, in order:
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Document Everything Before You Call Anyone",
                desc: "Walk the property and photograph all visible damage -- roof, gutters, siding, windows, interior water stains, dented HVAC units. Shoot wide-angle context photos and close-up detail shots. Record video narrating what you see. Date-stamp everything. This evidence cannot be recreated later.",
              },
              {
                num: "02",
                title: "Mitigate Further Damage (Temporary Repairs Only)",
                desc: "Your policy requires you to prevent additional damage. Tarp any exposed areas, board up broken windows, and place buckets under active leaks. Keep all receipts -- these are reimbursable. Do NOT make permanent repairs before the adjuster inspects.",
              },
              {
                num: "03",
                title: "Call Your Insurance Carrier to Open a Claim",
                desc: "Call the claims number on your policy (not your local agent). Provide the date of loss, a brief description of damage, and confirm your contact information. Get your claim number, adjuster assignment, and expected inspection timeline in writing.",
              },
              {
                num: "04",
                title: "Hire a Licensed Roofing Contractor for an Independent Inspection",
                desc: "Before the adjuster arrives, have a licensed, insured roofing contractor inspect the damage and provide a written estimate. This gives you a documented baseline. Choose a contractor experienced in insurance restoration -- they will know Xactimate pricing and can identify damage the adjuster might miss.",
              },
              {
                num: "05",
                title: "Attend the Adjuster Inspection with Your Contractor",
                desc: "Never let the adjuster inspect alone. Your contractor should be on the roof with the adjuster, pointing out every area of damage. The adjuster works for the insurance company -- your contractor advocates for you. This single step can increase claim approval amounts by 25-40%.",
              },
              {
                num: "06",
                title: "Review the Insurance Estimate Line by Line",
                desc: "When the carrier sends their estimate, compare it against your contractor's estimate item by item. Look for missing line items, incorrect quantities, wrong material types, and excluded code upgrades. Every discrepancy is a supplement opportunity.",
              },
              {
                num: "07",
                title: "File Supplements for Missing or Underscoped Items",
                desc: "Submit a formal supplement request with documentation for every line item the adjuster missed. Include photos, measurements, code citations, and manufacturer specifications. Well-documented supplements are approved 70-80% of the time.",
              },
              {
                num: "08",
                title: "Approve the Final Scope and Schedule the Work",
                desc: "Once the carrier approves the full scope (including supplements), review the final numbers, confirm your deductible, and authorize your contractor to begin. Get the start date, estimated completion, and payment schedule in writing.",
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

          {/* Section 2: What to Document Before Calling */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="what-to-document"
          >
            What to Document Before Calling Your Carrier
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Documentation is the single most important factor in claim outcomes.
            Insurance adjusters are trained to minimize payouts -- your
            documentation is the counterweight. Before you make that first call,
            you need three categories of evidence locked down:
          </p>

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              Exterior Documentation Checklist:
            </p>
            <div className="space-y-2">
              {[
                "Roof surface: photograph every slope from multiple angles, close-ups of dents, cracks, missing shingles, and exposed underlayment",
                "Gutters and downspouts: dents, separation, crushed sections, debris buildup from storm",
                "Siding and fascia: impact marks, cracks, holes, loose or missing sections",
                "Windows and screens: cracks, shattered panes, torn screens, damaged frames",
                "HVAC units: dented fins, displaced components, debris impact marks",
                "Fencing, sheds, and outbuildings: any storm-related damage to accessory structures",
                "Vehicles or property in driveway: shows hail size and impact force",
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

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              Interior Documentation Checklist:
            </p>
            <div className="space-y-2">
              {[
                "Water stains on ceilings and walls -- photograph with a ruler for scale",
                "Active leaks: video of dripping water with timestamp",
                "Damaged insulation in attic spaces",
                "Wet drywall, warping, or bubbling paint",
                "Mold growth from moisture intrusion (even early signs)",
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

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              Supporting Evidence:
            </p>
            <div className="space-y-2">
              {[
                "Date-stamped photos (enable location and timestamp on your phone camera)",
                "Weather reports from the National Weather Service for your zip code on the storm date",
                "Hail size reports from local storm-chasing networks or hail-mapping services",
                "Neighbor damage: if neighbors are filing claims, document that context",
                "Previous roof inspection reports showing pre-storm condition",
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

          {/* Section 3: What to Say When Filing */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="what-to-say"
          >
            What to Say (and NOT Say) When Filing Your Claim
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Your first phone call to the insurance company is recorded. Every
            word you say becomes part of the claim file. Adjusters are trained
            to listen for statements they can use to reduce or deny coverage.
            Here is exactly what to say -- and what to avoid:
          </p>

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              What to Say:
            </p>
            <div className="space-y-2">
              {[
                "\"I'm calling to report storm damage to my property that occurred on [date].\"",
                "\"I have visible damage to my roof, gutters, and [other affected areas].\"",
                "\"I've documented the damage with photos and video.\"",
                "\"I'd like to schedule an adjuster inspection as soon as possible.\"",
                "\"Can I get the claim number, adjuster's name, and expected inspection date in writing?\"",
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

          <div className="space-y-3 mb-6">
            <p className="font-semibold text-[var(--white)] mb-1">
              What NOT to Say:
            </p>
            {[
              {
                mistake: "\"The roof was already old / needed replacement.\"",
                detail:
                  "This gives the carrier ammunition to classify damage as pre-existing wear and tear. Even if your roof is 15 years old, storm damage is storm damage. Age does not negate a covered peril.",
              },
              {
                mistake: "\"It's probably not that bad.\"",
                detail:
                  "Minimizing damage on a recorded call anchors the adjuster's expectations low. Let the inspection determine severity -- don't pre-diagnose.",
              },
              {
                mistake: "\"I already got a repair estimate for $X.\"",
                detail:
                  "Giving a specific dollar amount on the first call sets a ceiling. The carrier may use your number to cap the claim. Let the adjuster's inspection and your contractor's estimate drive the conversation.",
              },
              {
                mistake:
                  "\"My neighbor got a new roof, so I should too.\"",
                detail:
                  "Claims are evaluated individually. Referencing your neighbor's claim has no bearing on yours and makes it sound like you're fishing for a payout rather than reporting legitimate damage.",
              },
              {
                mistake: "\"I don't know if it was the storm or something else.\"",
                detail:
                  "If you're filing a storm damage claim, be clear that you're reporting storm damage. Expressing uncertainty about causation invites the adjuster to attribute damage to wear and tear or maintenance issues.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">
                    &#x2715;
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--white)] text-sm">
                      {item.mistake}
                    </p>
                    <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Section 4: The Adjuster Inspection Process */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="adjuster-inspection"
          >
            The Adjuster Inspection: What to Expect
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The adjuster inspection is the most critical moment in your claim.
            This is where the scope of work -- and your payout -- gets
            determined. The adjuster is a professional who works for the
            insurance company. Their job is to assess damage accurately, but
            their employer benefits when estimates come in lower. Understanding
            the process removes surprises and protects your interests.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Most adjusters will arrive within 7-14 days of your claim being
            filed, though after major storms it can take 30-60 days. They will
            inspect the exterior (roof, siding, gutters, windows), the interior
            (ceilings, walls, attic), and document damage using Xactimate
            software. The inspection typically takes 1-3 hours depending on
            property size and damage extent.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            The adjuster will take their own photos, take measurements, and
            create an estimate in Xactimate. They will note the type of damage
            (hail, wind, impact), the affected areas, and the recommended
            repair or replacement scope. This estimate is their first offer --
            not the final word.
          </p>

          {/* Section 5: What to Do During the Adjuster Visit */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="during-adjuster-visit"
          >
            What to Do During the Adjuster Visit
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Your behavior during the adjuster inspection directly impacts your
            claim outcome. Be present, be prepared, and be professional. Here
            is your playbook:
          </p>

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              During the Inspection:
            </p>
            <div className="space-y-2">
              {[
                "Have your contractor present on-site -- they should be on the roof with the adjuster pointing out every area of damage",
                "Bring your own documentation: photos, video, weather reports, and your contractor's written estimate",
                "Walk the property with the adjuster and make sure they inspect every affected area, not just the roof",
                "Take your own photos of everything the adjuster photographs -- create a parallel record",
                "Ask the adjuster to explain what they are documenting and what Xactimate codes they are using",
                "Be polite but firm -- you're not adversaries, but your interests are different",
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
              <strong>Critical rule:</strong> Do NOT sign anything the adjuster
              gives you on the spot. Adjusters may present a &ldquo;scope of
              work&rdquo; or &ldquo;agreement&rdquo; for you to sign during
              the inspection. Never sign on-site. Tell them you need to review
              it with your contractor first. Signing prematurely can lock you
              into a scope that excludes legitimate damage and waives your
              right to supplement.
            </p>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 mb-6">
            <p className="text-amber-400 text-sm leading-relaxed">
              <strong>Do NOT agree to the first estimate.</strong> The
              adjuster&apos;s initial estimate is a starting point, not a final
              offer. Carriers expect supplements -- the process is designed for
              negotiation. Accepting the first number without review leaves
              money on the table on virtually every claim.
            </p>
          </div>

          {/* Section 6: Understanding Your Estimate */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="understanding-estimate"
          >
            Understanding Your Insurance Estimate
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The insurance estimate is a line-item document generated in
            Xactimate, the industry-standard software used by virtually all
            insurance carriers. Understanding how to read it is essential for
            identifying what was missed and building your supplement case.
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Line Items and Xactimate Codes",
                desc: "Every repair task has a unique Xactimate code (e.g., RFG LAMI30 for 30-year laminated shingles). Each line item includes a description, quantity, unit price, and total. Compare every code against your contractor's estimate to catch discrepancies.",
              },
              {
                num: "02",
                title: "RCV vs. ACV Payments",
                desc: "RCV (Replacement Cost Value) is the full cost to repair or replace. ACV (Actual Cash Value) is RCV minus depreciation. Most claims pay ACV upfront and release the depreciation (recoverable) after repairs are completed. Know which your policy provides.",
              },
              {
                num: "03",
                title: "Overhead and Profit (O&P)",
                desc: "Legitimate insurance estimates include 10% overhead and 10% profit for the contractor. Some adjusters exclude O&P on the initial estimate. If yours is missing O&P, that is a supplement item. Carriers are required to pay O&P when a general contractor manages the project.",
              },
              {
                num: "04",
                title: "Deductible Application",
                desc: "Your deductible is subtracted from the total estimate. On a $12,000 claim with a $1,000 deductible, the carrier pays $11,000. The deductible is your responsibility -- no legitimate contractor will 'waive' or 'absorb' your deductible (this is insurance fraud in most states).",
              },
              {
                num: "05",
                title: "Code Upgrade Line Items",
                desc: "Building codes change over time. If your roof was installed under older codes, repairs may require code upgrades (drip edge, ice & water shield, ventilation). These should be included in the estimate. If missing, they are supplementable items with strong approval rates.",
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

          {/* Section 7: When to Supplement */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="when-to-supplement"
          >
            When to Supplement (and How to Win)
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Supplementing is not optional -- it is a standard part of the
            insurance claims process. The adjuster&apos;s first estimate almost
            never captures the full scope of work. Supplements exist because
            damage is often hidden until work begins, code requirements are
            frequently overlooked, and initial inspections miss items.
            Contractors who do not supplement leave an average of{" "}
            <strong className="text-[var(--white)]">30-60%</strong> of
            recoverable dollars on the table.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Common supplement items include:
          </p>

          <div className="glass-card p-6 mb-6">
            <div className="space-y-2">
              {[
                "Hidden damage found during tear-off (rotted decking, damaged underlayment, compromised flashing)",
                "Code-required upgrades: drip edge, ice & water shield in valleys and eaves, proper ventilation ratios",
                "Missing line items: starter strip, ridge cap, pipe boot replacement, step flashing",
                "Incorrect quantities: adjuster measured one slope but damage extends to additional slopes",
                "Overhead and profit if excluded from the original estimate",
                "Steep pitch charges for roofs above 7/12 pitch",
                "High roof charges for multi-story structures requiring additional safety equipment",
                "Haul-off and dump fees for debris removal",
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
            To win a supplement, you need three things: photos of the additional
            damage or work, the specific Xactimate line items and codes you are
            requesting, and a written justification citing building codes or
            manufacturer specifications. Vague requests get denied. Specific,
            documented requests with code citations get approved.
          </p>

          {/* Section 8: Common Mistakes That Kill Claims */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="common-mistakes"
          >
            Common Mistakes That Kill Insurance Claims
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            We have seen thousands of roof insurance claims. These are the
            mistakes that cause claims to be underpaid, delayed, or denied
            outright:
          </p>

          <div className="space-y-3 mb-6">
            {[
              {
                mistake: "Making permanent repairs before the adjuster inspects",
                detail:
                  "Once you repair the damage, the evidence is gone. The adjuster cannot verify what they cannot see. Make only temporary, emergency repairs (tarping, boarding up) and document those repairs with photos and receipts.",
              },
              {
                mistake: "Letting the adjuster inspect alone",
                detail:
                  "Without your contractor on the roof, the adjuster controls the narrative. They decide what to document and what to skip. Having your contractor present ensures every area of damage is identified, pointed out, and recorded.",
              },
              {
                mistake: "Signing documents on the spot during the inspection",
                detail:
                  "Adjusters may present scope agreements, direction-to-pay forms, or authorization documents during the visit. Signing before your contractor reviews the scope can lock you into an incomplete estimate and waive supplement rights.",
              },
              {
                mistake: "Accepting the first estimate without comparing line items",
                detail:
                  "The carrier's first estimate is a starting point. Comparing it line by line against your contractor's estimate reveals missing items, incorrect quantities, and excluded code upgrades. This comparison is the foundation of every successful supplement.",
              },
              {
                mistake: "Filing too late and missing your state's deadline",
                detail:
                  "Every state has a statute of limitations for property damage claims, and many policies have shorter notice requirements. Missing the deadline means forfeiting your claim entirely -- no exceptions, no appeals.",
              },
              {
                mistake: "Not documenting damage immediately after the storm",
                detail:
                  "Evidence degrades fast. Rain washes away hail debris, sun exposure causes additional deterioration, and homeowners unknowingly disturb damage. The first 24-48 hours after a storm are the most critical documentation window.",
              },
              {
                mistake: "Admitting the roof was old or in poor condition on a recorded call",
                detail:
                  "Your first call to the carrier is recorded. Statements about roof age, prior condition, or pre-existing issues give the adjuster justification to classify storm damage as wear and tear. Report the storm damage. Period.",
              },
              {
                mistake: "Using a contractor who does not understand insurance restoration",
                detail:
                  "General contractors who do not work insurance claims regularly will miss supplement opportunities, fail to use proper Xactimate line items, and leave recoverable money uncollected. Insurance restoration is a specialization -- hire accordingly.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">
                    &#x2715;
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--white)] text-sm">
                      {item.mistake}
                    </p>
                    <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Section 9: Timelines and Deadlines by State */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="timelines-deadlines"
          >
            Timelines and Deadlines: How Long Do You Have?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Timing is everything in insurance claims. Miss a deadline and your
            claim is dead regardless of how much damage exists. Here are the
            key timelines you need to know:
          </p>

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              State Filing Deadlines (Statute of Limitations for Property
              Damage):
            </p>
            <div className="space-y-2">
              {[
                "Texas: 2 years from date of loss",
                "Florida: 2 years from date of loss (reduced from 5 years in 2023 reform)",
                "Colorado: 2 years from date of loss (3 years for breach of contract against carrier)",
                "Georgia: 4 years from date of loss",
                "North Carolina: 3 years from date of loss",
                "Oklahoma: 2 years from date of loss",
                "Minnesota: 6 years from date of loss",
                "Illinois: 5 years from date of loss",
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 text-sm text-[var(--gray)]"
                >
                  <span className="text-[var(--white)] mt-0.5 shrink-0 font-mono text-xs">
                    &bull;
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              Typical Claim Timeline:
            </p>
            <div className="space-y-2">
              {[
                "Day 1-2: Document damage and file claim with carrier",
                "Day 3-7: Hire contractor for independent inspection and estimate",
                "Day 7-21: Adjuster inspection (longer after major storm events)",
                "Day 14-30: Receive carrier's estimate and initial payment (ACV)",
                "Day 30-60: Compare estimates, file supplements for missing items",
                "Day 45-90: Supplement approval and revised payment",
                "Day 60-120: Repairs completed, final inspection, depreciation released",
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 text-sm text-[var(--gray)]"
                >
                  <span className="text-[var(--white)] mt-0.5 shrink-0 font-mono text-xs">
                    &bull;
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 mb-6">
            <p className="text-amber-400 text-sm leading-relaxed">
              <strong>Pro tip:</strong> Do not confuse the statute of
              limitations with your policy&apos;s notice requirement. Your state
              may allow 2 years to file suit, but your policy may require you to
              notify the carrier within 60-90 days of the loss. Read your policy
              declarations page and act within the shorter of the two deadlines.
            </p>
          </div>

          {/* Section 10: How dumbroof.ai Streamlines the Process */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="dumbroof-streamlines"
          >
            How dumbroof.ai Streamlines the Insurance Claim Process
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The biggest bottleneck in insurance claims is documentation. Writing
            estimates, formatting supplement letters, citing building codes, and
            creating professional claim packages takes hours per claim -- time
            that could be spent closing more jobs. dumbroof.ai eliminates that
            bottleneck with AI-powered documentation.
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Upload Photos and Measurements",
                desc: "Upload your storm damage photos and roof measurements. The AI analyzes damage patterns, identifies affected components, and maps the full scope of repair work needed.",
              },
              {
                num: "02",
                title: "AI-Generated Xactimate-Style Estimate",
                desc: "Get a complete estimate with line-item detail, correct Xactimate codes, material specifications, and labor quantities. Formatted to match industry standards so adjusters take it seriously.",
              },
              {
                num: "03",
                title: "Forensic Causation Report",
                desc: "A professional causation report that ties damage to the specific weather event using forensic analysis language. This is the document that defeats 'wear and tear' denials.",
              },
              {
                num: "04",
                title: "Supplement Letter with Code Citations",
                desc: "When the adjuster's estimate misses items, generate a supplement letter with specific line items, building code citations, and manufacturer specifications. The documentation that gets supplements approved.",
              },
              {
                num: "05",
                title: "Carrier Comparison and Cover Letter",
                desc: "A side-by-side comparison of your estimate vs. the carrier's estimate, plus a professional cover letter for submission. Everything the insurance company needs in one package.",
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

          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Over{" "}
            <strong className="text-[var(--white)]">$12.5 million</strong> in
            claims have been processed through dumbroof.ai, generating{" "}
            <strong className="text-[var(--white)]">$2.6 million</strong> in
            approved supplements. What used to take a full day of office work
            per claim now takes 15 minutes.
          </p>

          {/* FAQ Section */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-6"
            id="faq"
          >
            Frequently Asked Questions About Filing Roof Insurance Claims
          </h2>
          <div className="space-y-4 mb-10">
            {faqItems.map((faq) => (
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

          {/* CTA */}
          <div className="bg-gradient-to-r from-[var(--pink)]/10 via-[var(--purple)]/10 to-[var(--blue)]/10 border border-white/10 rounded-2xl p-8 text-center mt-14">
            <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
              Stop Leaving Money on the Table
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              dumbroof.ai generates the documentation that gets claims approved
              and supplements paid. Upload your photos, get 5 professional
              documents in 15 minutes -- estimates, causation reports,
              supplement letters, and more.
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
