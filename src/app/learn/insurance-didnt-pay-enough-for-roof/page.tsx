import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Insurance Didn't Pay Enough for My Roof — What To Do Next",
  description:
    "Your insurance estimate is too low to replace your roof. Learn why carriers underpay, how to read your estimate, file a supplement, recover depreciation, and get every dollar owed for drip edge, starter strip, ice & water shield, ridge cap, O&P, and code upgrades.",
  keywords: [
    "insurance didn't pay enough for roof",
    "roof claim underpayment",
    "supplement roof insurance claim",
    "insurance estimate too low roof",
    "roofing supplement",
    "roof insurance underpayment",
    "Xactimate roof estimate low",
    "overhead and profit roofing",
  ],
  openGraph: {
    title: "Insurance Didn't Pay Enough for My Roof — What To Do Next",
    description:
      "Step-by-step guide to fighting roof claim underpayment. File supplements, recover depreciation, and capture every missing line item carriers skip.",
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
      name: "Why did my insurance not pay enough to replace my roof?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Insurance carriers routinely underpay roof claims by omitting legitimate line items such as drip edge, starter strip, ice and water shield, ridge cap, and felt/underlayment upgrades. They also withhold depreciation on ACV policies, exclude overhead and profit (O&P), and use outdated unit pricing. Studies show initial carrier estimates undervalue roof replacement costs by 25-50% on average.",
      },
    },
    {
      "@type": "Question",
      name: "What is a roofing supplement and how do I file one?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A roofing supplement is a formal request to your insurance carrier for additional payment on line items, code upgrades, or pricing discrepancies missing from the original claim estimate. You file it by submitting an itemized scope comparison, invoices, building code citations, and photos proving the additional work is necessary. Most carriers have a dedicated supplement review team that responds within 10-30 business days.",
      },
    },
    {
      "@type": "Question",
      name: "What is the difference between ACV and RCV on a roof claim?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "ACV (Actual Cash Value) is the replacement cost minus depreciation — the initial check you receive. RCV (Replacement Cost Value) is the full cost to replace the roof without deducting depreciation. On RCV policies, you recover the withheld depreciation after proving the work was completed. On ACV-only policies, the depreciated amount is the maximum payout. Always check your policy declarations page to know which type you have.",
      },
    },
    {
      "@type": "Question",
      name: "Can I get overhead and profit (O&P) added to my roof claim?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Overhead and profit — typically 10% overhead plus 10% profit (20% combined) — is owed when three or more trades are involved in the repair. Roof replacements almost always meet this threshold because they involve roofing, gutters, and often carpentry, painting, or drywall. Many carriers deny O&P by default, but Xactimate's own guidelines and multiple state regulations support its inclusion. A supplement with trade documentation is the standard way to recover it.",
      },
    },
    {
      "@type": "Question",
      name: "How does dumbroof.ai help find missing money in roof claims?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "dumbroof.ai's AI compares your carrier's estimate against a comprehensive Xactimate-grade scope line by line. It flags every missing item — drip edge, starter strip, ice and water shield, ridge cap, underlayment, code upgrades, O&P, and more. The platform then generates a supplement letter with building code citations, annotated photos, and carrier-specific language. Contractors using dumbroof.ai recover an average of $3,200 per claim in previously missed line items.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Insurance Didn't Pay Enough for My Roof — What To Do Next",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage:
    "https://www.dumbroof.ai/learn/insurance-didnt-pay-enough-for-roof",
  description:
    "Step-by-step guide to fighting roof claim underpayment. File supplements, recover depreciation, and capture every missing line item carriers skip.",
};

export default function InsuranceDidntPayEnoughForRoof() {
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
              Insurance Didn&apos;t Pay Enough for Roof
            </span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Insurance Claims
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              Insurance Didn&apos;t Pay Enough to Replace My Roof &mdash; What
              To Do
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 15 min read
            </p>
          </header>

          {/* Direct Answer — AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">
              If your insurance didn&apos;t pay enough to replace your roof,
              you&apos;re not alone &mdash; and you&apos;re not stuck.
            </strong>{" "}
            Most initial carrier estimates undervalue roof replacement costs by
            25&ndash;50%. Carriers omit legitimate line items, apply excessive
            depreciation, exclude overhead and profit, and use outdated unit
            pricing. The fix is a supplement: a formal, itemized request for the
            additional money owed. This guide walks you through exactly why
            carriers underpay, how to read your estimate, what they skip, how to
            file a supplement, and how to recover every dollar your policy
            entitles you to.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong>{" "}
              According to industry data, the average roofing supplement recovers{" "}
              <strong className="text-[var(--white)]">
                $3,000&ndash;$7,000 in additional funds
              </strong>{" "}
              per claim beyond the original carrier payout. dumbroof.ai has
              processed over{" "}
              <strong className="text-[var(--white)]">
                $12.5 million in claims
              </strong>{" "}
              and generated{" "}
              <strong className="text-[var(--white)]">
                $2.6 million in approved supplements
              </strong>
              , with an average recovery of $3,200 per supplemented claim.
            </p>
          </div>

          {/* Section: Why Insurance Underpays */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="why-insurance-underpays"
          >
            Why Does Insurance Underpay Roof Claims?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Insurance carriers are for-profit companies. Every dollar they
            don&apos;t pay on a claim goes directly to their bottom line. This
            doesn&apos;t mean your adjuster is intentionally cheating you &mdash;
            most field adjusters are overworked, handling 80&ndash;150 claims at a
            time, and rely on templates that systematically omit legitimate scope.
            The underpayment is structural, not personal.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Here are the most common reasons carriers pay less than what your
            roof actually costs to replace:
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                reason: "Template-based scoping",
                detail:
                  "Adjusters use pre-built Xactimate templates that include the minimum line items. Items like drip edge, starter strip, and ice and water shield are left off unless specifically requested.",
              },
              {
                reason: "Aggressive depreciation schedules",
                detail:
                  "Carriers depreciate every component — shingles, felt, flashing, even labor — using internal schedules that often exceed actual wear. A 10-year-old roof with a 30-year shingle may see 40-60% depreciation applied.",
              },
              {
                reason: "O&P exclusion by default",
                detail:
                  "Overhead and profit (10% + 10%) is excluded on most initial estimates, even when three or more trades are clearly required. This alone can represent $2,000-$5,000 on a standard residential roof.",
              },
              {
                reason: "Outdated unit pricing",
                detail:
                  "Carrier pricing databases lag behind current material and labor costs, especially after major storm events when demand spikes. The price they allow per square of shingles may be 15-25% below actual market rate.",
              },
              {
                reason: "Scope minimization",
                detail:
                  "Adjusters scope repairs instead of replacement, approve partial sections instead of full slopes, or omit code-required upgrades entirely. The goal is to keep the claim total as low as defensibly possible.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-4 flex gap-4">
                <span className="text-[var(--red)] font-bold text-sm whitespace-nowrap min-w-[60px]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--white)] mb-1">
                    {item.reason}
                  </p>
                  <p className="text-sm text-[var(--gray)] leading-relaxed">
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Section: ACV vs RCV */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="acv-vs-rcv"
          >
            ACV vs. RCV: Understanding Your Policy Payout
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Before you fight for more money, you need to understand what type of
            policy you have. This single distinction determines your maximum
            recovery potential.
          </p>
          <div className="space-y-4 mb-6">
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-[var(--white)] mb-2">
                Replacement Cost Value (RCV)
              </h3>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                RCV policies pay the full cost to replace your roof at
                today&apos;s prices. However, the carrier first sends a check for
                the <em>Actual Cash Value</em> (replacement cost minus
                depreciation). You complete the work, then submit invoices to
                recover the withheld depreciation. This second payment is called
                the &ldquo;recoverable depreciation&rdquo; or &ldquo;supplement
                check.&rdquo; If you don&apos;t complete the work, you
                don&apos;t get the depreciation back.
              </p>
            </div>
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-[var(--white)] mb-2">
                Actual Cash Value (ACV)
              </h3>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                ACV policies deduct depreciation and that&apos;s your final
                payout. There is no recoverable depreciation. If your 15-year-old
                roof costs $18,000 to replace but the carrier depreciates it by
                50%, you receive $9,000 minus your deductible &mdash; and
                that&apos;s it. ACV policies make supplements even more critical
                because every line item you recover goes directly into the claim
                total before depreciation is applied.
              </p>
            </div>
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Check your policy&apos;s declarations page to confirm your coverage
            type. Look for the phrases &ldquo;Replacement Cost&rdquo; or
            &ldquo;Actual Cash Value&rdquo; under the Dwelling coverage section.
            Some carriers have moved to hybrid policies that pay RCV on roofs
            under a certain age (typically 10 years) and ACV on older roofs.
          </p>

          {/* Section: How to Read Your Estimate */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="read-your-estimate"
          >
            How to Read Your Insurance Roof Estimate
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Your carrier&apos;s estimate is an Xactimate report &mdash; a
            line-by-line scope of work with unit prices, quantities, and totals.
            Most homeowners and even some contractors glance at the bottom-line
            number and assume it&apos;s correct. It almost never is. Here&apos;s
            what to look for:
          </p>
          <div className="space-y-4 mb-6">
            {[
              {
                area: "Roof measurements",
                check:
                  "Compare the total squares (1 square = 100 sq ft) against your own measurement or a satellite report. Carriers frequently undercount by 2-5 squares, which at $350-$500 per square can mean $700-$2,500 missing from the estimate.",
              },
              {
                area: "Line item completeness",
                check:
                  "A proper roof replacement includes 15-25 line items. If your estimate has fewer than 12, it is almost certainly missing scope. Common omissions include drip edge, starter strip, ice and water shield, pipe boot flashing, step flashing, and ridge vent.",
              },
              {
                area: "Unit pricing",
                check:
                  "Every line item has a unit price. Compare these against current Xactimate pricing for your zip code. Carriers sometimes use regional pricing that is 10-20% below actual local rates, especially in storm-surge markets.",
              },
              {
                area: "Waste factor",
                check:
                  "Roofing materials require a waste factor — typically 10-15% for simple roofs and 15-20% for complex, cut-up roofs. If the estimate shows 0% waste or a flat 5%, the material quantities are understated.",
              },
              {
                area: "O&P line",
                check:
                  "Look for a line item showing 10% overhead and 10% profit. If it's absent, that's 20% of the total claim amount missing. This is the single largest omission on most underpaid claims.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h4 className="text-[var(--white)] font-semibold text-sm">
                    {item.area}
                  </h4>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">
                  {item.check}
                </p>
              </div>
            ))}
          </div>

          {/* Section: Missing Line Items */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="missing-line-items"
          >
            Missing Line Items Carriers Skip on Roof Claims
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            These are the specific line items most frequently omitted from
            initial carrier estimates. Each one is a legitimate cost of roof
            replacement that your policy covers. If any of these are missing from
            your estimate, you have grounds for a supplement.
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                item: "Drip edge",
                detail:
                  "Metal flashing installed along eaves and rakes to direct water away from the fascia. Required by IRC R905.2.8.5 for asphalt shingles. Carriers omit it on 60%+ of estimates. Cost: $1.50-$3.00 per linear foot, typically $300-$600 per roof.",
              },
              {
                item: "Starter strip",
                detail:
                  "Adhesive shingle strip installed along eaves and rakes before the first course. Required by every major shingle manufacturer for warranty compliance. Without it, the first row of shingles has no sealant bond. Cost: $0.75-$1.50/LF, typically $150-$350 per roof.",
              },
              {
                item: "Ice and water shield",
                detail:
                  "Self-adhering membrane installed in valleys, along eaves (per IRC R905.2.7.1 in ice dam zones), around penetrations, and at sidewall transitions. Carriers often allow only felt paper in areas where code requires ice and water shield. Cost: $50-$100 per roll, typically $200-$800 per roof.",
              },
              {
                item: "Ridge cap shingles",
                detail:
                  "Purpose-manufactured hip and ridge shingles. Adjusters sometimes scope field shingles cut to fit the ridge instead of proper ridge cap, which costs more but is required by manufacturer installation specs. Cost: $40-$75 per bundle, typically $200-$450 per roof.",
              },
              {
                item: "Pipe boot / jack flashing",
                detail:
                  "Rubber or lead flashing around plumbing and HVAC penetrations. When you tear off the old roof, existing pipe boots are destroyed and must be replaced. Carriers regularly omit this $15-$40 per boot cost — multiply by 3-6 penetrations per roof.",
              },
              {
                item: "Step flashing",
                detail:
                  "L-shaped metal pieces woven into shingle courses where the roof meets a vertical wall (dormers, chimneys, sidewalls). Must be replaced during re-roof per IRC R905.2.8.3. Cost: $5-$12 per piece, typically $150-$500 per roof depending on wall intersections.",
              },
              {
                item: "Felt / underlayment upgrade",
                detail:
                  "Many carriers scope 15 lb felt when code or manufacturer specs require 30 lb felt or synthetic underlayment. The price difference is $15-$30 per square. On a 25-square roof, that's $375-$750 the carrier didn't include.",
              },
              {
                item: "Ridge vent / ventilation",
                detail:
                  "Proper attic ventilation is required by IRC R806. If the existing ridge vent is damaged or the old roof used box vents, the replacement may require upgrading to continuous ridge vent. Carriers often scope 'reset' instead of 'replace.' Cost difference: $3-$8 per linear foot.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-4">
                <p className="text-sm font-semibold text-[var(--white)] mb-1">
                  {item.item}
                </p>
                <p className="text-sm text-[var(--gray)] leading-relaxed">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Add these up on a typical 25-square residential roof and
            you&apos;re looking at $1,500&ndash;$4,000 in missing scope before
            you even address O&amp;P, code upgrades, or pricing discrepancies.
            This is why initial carrier estimates consistently fall short.
          </p>

          {/* Section: How to File a Supplement */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="file-a-supplement"
          >
            How to File a Roofing Supplement
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A supplement is your primary tool for recovering underpaid money. It
            is a formal, documented request &mdash; not a phone call, not a
            complaint. Carriers respond to supplements that follow their process
            and include specific evidence. Here&apos;s how to file one that
            gets approved:
          </p>
          <div className="space-y-4 mb-6">
            {[
              {
                step: "Build a complete scope",
                detail:
                  "Create a line-by-line estimate in Xactimate (or an Xactimate-grade format) that includes every item required for the roof replacement. This is your baseline — the true cost of the job.",
              },
              {
                step: "Compare against the carrier estimate",
                detail:
                  "Go line by line through the carrier's estimate and your complete scope. Flag every missing line item, every quantity discrepancy, every pricing difference, and every omitted code upgrade. This comparison document is the backbone of your supplement.",
              },
              {
                step: "Cite building codes",
                detail:
                  "For each missing item, reference the specific IRC section, manufacturer installation requirement, or local code amendment that mandates it. Carriers cannot deny code-required work — they can only argue about whether the code applies. Make it undeniable.",
              },
              {
                step: "Include photo documentation",
                detail:
                  "Annotated photos showing the existing conditions that require the supplemented items. Photos of damaged drip edge, worn-through underlayment, deteriorated pipe boots, and missing step flashing create visual proof the carrier cannot dispute.",
              },
              {
                step: "Write a professional supplement letter",
                detail:
                  "The letter should be addressed to the specific adjuster or supplement department, reference the claim number, summarize the total additional amount requested, and itemize each line item with code citations. Keep the tone factual and professional — never accusatory.",
              },
              {
                step: "Submit through the carrier's supplement process",
                detail:
                  "Most carriers have a dedicated supplement email address or portal. Submit your complete package — supplement letter, comparison document, estimate, photos, and code citations — as a single organized submission. Follow up at 10, 20, and 30 days if you don't receive a response.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h4 className="text-[var(--white)] font-semibold text-sm">
                    {item.step}
                  </h4>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>

          {/* Section: Building Code Upgrades */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="code-upgrades"
          >
            Building Code Upgrades They Owe You
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            When your roof was originally installed, it was built to the building
            code in effect at that time. When it&apos;s replaced today, it must
            meet <em>current</em> code. Your insurance policy includes an
            &ldquo;Ordinance or Law&rdquo; provision (sometimes as a separate
            endorsement) that covers the cost of upgrading to current code. These
            upgrades are frequently omitted from carrier estimates:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "Ice and water shield in eave areas (IRC R905.2.7.1) — required in regions where the average January temperature is 25°F or below",
              "Drip edge at eaves and rakes (IRC R905.2.8.5) — required for all asphalt shingle installations since the 2012 IRC adoption",
              "Attic ventilation meeting 1:150 or 1:300 NFA ratio (IRC R806.1) — if the existing ventilation doesn't meet current code, it must be upgraded during re-roof",
              "Synthetic underlayment or 30 lb felt where 15 lb was original (varies by local amendment) — many jurisdictions now require higher-grade underlayment",
              "High-wind fastener patterns (IRC R905.2.6) — in wind zones exceeding 110 mph, enhanced nailing patterns (6 nails per shingle vs. 4) are required, adding labor cost",
              "Impact-resistant shingles (local code in hail-prone areas) — states like Texas, Colorado, and parts of the Midwest mandate Class 4 impact-resistant shingles in certain zones",
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 text-sm text-[var(--gray)]"
              >
                <span className="text-[var(--red)] font-bold mt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            If any of these code requirements apply to your re-roof and they
            aren&apos;t on the carrier&apos;s estimate, submit a supplement with
            the specific code section referenced. Carriers are contractually
            obligated to pay for code-required upgrades under the Ordinance or
            Law coverage in your policy.
          </p>

          {/* Section: Depreciation Recovery */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="depreciation-recovery"
          >
            How to Recover Withheld Depreciation
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            If you have an RCV (Replacement Cost Value) policy, your carrier
            withheld depreciation from your initial check. This money is
            recoverable &mdash; but only if you follow the correct process.
          </p>
          <div className="space-y-4 mb-6">
            {[
              {
                step: "Complete the roof replacement",
                detail:
                  "The work must be done before you can claim recoverable depreciation. The carrier requires proof that the money was actually spent on the repair.",
              },
              {
                step: "Collect your contractor's final invoice",
                detail:
                  "The invoice must show the completed scope of work and the total cost. It should match or exceed the carrier's RCV total (after supplements) to recover the full depreciation amount.",
              },
              {
                step: "Submit the depreciation recovery request",
                detail:
                  "Send the final invoice, completion photos, and a formal request for the recoverable depreciation to your carrier. Reference your claim number and the specific depreciation amount listed on your original estimate.",
              },
              {
                step: "Review the depreciation calculation",
                detail:
                  "Carriers sometimes apply depreciation incorrectly — depreciating non-depreciable items like labor, flashing, or code upgrades. If the depreciation amount seems excessive, challenge the calculation with specific line-item objections.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h4 className="text-[var(--white)] font-semibold text-sm">
                    {item.step}
                  </h4>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Important: most policies have a time limit for recovering
            depreciation &mdash; typically 180 days to 1 year from the date of
            loss. If you wait too long, the carrier can deny the recoverable
            depreciation entirely. Start the replacement as soon as your
            supplements are approved and the scope is finalized.
          </p>

          {/* Section: O&P Deep Dive */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="overhead-and-profit"
          >
            The Overhead &amp; Profit (O&amp;P) Dispute
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Overhead and profit is the single most-disputed line item in roofing
            insurance claims. It represents 20% of the total claim amount (10%
            overhead + 10% profit), and carriers fight it on virtually every
            claim. Here&apos;s what you need to know:
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Xactimate &mdash; the software carriers themselves use to write
            estimates &mdash; includes O&amp;P as a standard feature because it
            recognizes that general contractors incur overhead costs (insurance,
            licensing, office expenses, supervision) and are entitled to a profit
            margin. The industry standard is the &ldquo;three-trade rule&rdquo;:
            when three or more trades are involved in a claim, O&amp;P is owed.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A standard roof replacement almost always involves three or more
            trades:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "Roofing — tear-off, underlayment, shingle installation, flashing, ventilation",
              "Gutters — detach, reset, or replace gutters and downspouts disturbed during tear-off",
              "Carpentry — repair or replace damaged decking, fascia, soffit discovered during tear-off",
              "Painting — touch up or repaint fascia, soffit, and trim after carpentry work",
              "Drywall / interior — repair interior water damage if leaks occurred before the roof was replaced",
            ].map((trade, i) => (
              <div
                key={i}
                className="flex items-start gap-3 text-sm text-[var(--gray)]"
              >
                <span className="text-[var(--red)] shrink-0 mt-0.5">
                  &#x2713;
                </span>
                <p className="leading-relaxed">{trade}</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            If your carrier denied O&amp;P, your supplement should document every
            trade involved with specific scope items, subcontractor invoices or
            estimates, and a reference to the Xactimate O&amp;P guidelines. In
            states like Florida, Colorado, and Texas, case law and regulatory
            guidance further support the contractor&apos;s right to O&amp;P when
            the three-trade threshold is met.
          </p>

          {/* Section: How dumbroof.ai Finds Missing Money */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="dumbroof-ai"
          >
            How dumbroof.ai Finds Missing Money in Your Claim
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai was built specifically to solve the underpayment problem.
            The platform uses AI to generate a forensic-grade claim package from
            your inspection photos and measurements in under 15 minutes &mdash;
            no Xactimate license required. Here&apos;s how it works:
          </p>
          <div className="space-y-4 mb-6">
            {[
              {
                feature: "AI-powered scope generation",
                detail:
                  "Upload your photos and roof measurements. The AI generates a comprehensive Xactimate-grade estimate that includes every line item a proper roof replacement requires — drip edge, starter strip, ice and water shield, ridge cap, pipe boots, step flashing, underlayment, ventilation, and more.",
              },
              {
                feature: "Carrier estimate comparison",
                detail:
                  "The platform compares your carrier's estimate against the AI-generated scope line by line. Every missing item, quantity discrepancy, and pricing gap is flagged with the exact dollar amount at stake.",
              },
              {
                feature: "Building code citation engine",
                detail:
                  "For each missing line item, dumbroof.ai references the specific IRC section, manufacturer spec, or local code amendment that requires it. This transforms a generic request into an evidence-backed supplement that carriers must address on the merits.",
              },
              {
                feature: "Automated supplement letter",
                detail:
                  "The platform generates a professional supplement letter addressed to the carrier, complete with your branding, claim details, itemized requests, code citations, and annotated photos. Ready to submit as-is.",
              },
              {
                feature: "Carrier intelligence",
                detail:
                  "dumbroof.ai tracks how specific carriers respond to different supplement arguments. The AI tailors the language, documentation emphasis, and code citation strategy based on which carrier you're dealing with — because State Farm responds differently than Allstate, and USAA differently than Liberty Mutual.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h4 className="text-[var(--white)] font-semibold text-sm">
                    {item.feature}
                  </h4>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The result: contractors using dumbroof.ai recover an average of
            $3,200 per claim that they would have otherwise left on the table.
            Over $2.6 million in supplements have been approved through the
            platform since launch.
          </p>

          {/* FAQ Section */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-6"
            id="faq"
          >
            Frequently Asked Questions About Roof Claim Underpayment
          </h2>
          <div className="space-y-4 mb-10">
            {(
              faqSchema.mainEntity as Array<{
                name: string;
                acceptedAnswer: { text: string };
              }>
            ).map((faq) => (
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
              Think Your Roof Claim Was Underpaid? Find Out in 15 Minutes.
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              Upload your inspection photos and measurements. dumbroof.ai
              compares your carrier&apos;s estimate against a complete scope,
              flags every missing line item, and generates a ready-to-submit
              supplement package &mdash; no Xactimate license needed.
            </p>
            <a
              href="/login?mode=signup"
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
