import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "What Is an AOB (Assignment of Benefits) for Roofing?",
  description:
    "Learn what an Assignment of Benefits (AOB) means for roofing contractors, how it differs from a contingency agreement, state laws like Florida's AOB reform, and how dumbroof.ai automates AOB workflows with e-signatures.",
  keywords: [
    "assignment of benefits roofing",
    "AOB roofing",
    "what is an AOB",
    "roofing contingency agreement",
    "assignment of benefits insurance claim",
    "AOB vs contingency agreement",
    "Florida AOB reform",
    "roofing insurance assignment",
  ],
  openGraph: {
    title: "What Is an AOB (Assignment of Benefits) for Roofing?",
    description:
      "Understand what an AOB is, how it works in roofing insurance claims, the legal landscape by state, and how to automate AOB workflows with digital signatures.",
    type: "article",
    publishedTime: "2026-04-03T00:00:00Z",
    authors: ["Tom Kovack Jr."],
  },
};

const faqItems = [
  {
    question: "Is an Assignment of Benefits (AOB) legal in all 50 states?",
    answer:
      "AOBs are legal in most states, but the rules vary significantly. Florida passed major AOB reform in 2019 (SB 122) that added notice requirements, fee-shifting limits, and the right for insurers to offer managed-repair options. Some states restrict or effectively prohibit AOBs for property claims. Always check your state's current statutes before using an AOB in your workflow.",
  },
  {
    question: "What is the difference between an AOB and a contingency agreement?",
    answer:
      "An AOB transfers the homeowner's insurance claim rights directly to the contractor, who then bills and negotiates with the carrier. A contingency agreement keeps the claim in the homeowner's name but commits them to using your company if the claim is approved. Contingency agreements are less legally complex and more commonly used in states that restrict AOBs.",
  },
  {
    question: "Can a homeowner cancel an AOB after signing it?",
    answer:
      "In most states, yes. Florida law, for example, gives homeowners the right to rescind an AOB within 14 days of signing or within 30 days of the assignment if no substantial work has begun. Many other states also provide a rescission window. Your AOB document should clearly disclose this right to stay compliant.",
  },
  {
    question: "How does dumbroof.ai handle AOB and contingency workflows?",
    answer:
      "dumbroof.ai generates customizable AOB and contingency agreement templates as part of your claim workflow. Homeowners can sign digitally via a secure link — no printing, scanning, or chasing signatures. Signed documents are stored with the claim file, timestamped, and accessible from your dashboard for audit and compliance purposes.",
  },
  {
    question: "Should I use an AOB or a contingency agreement for my roofing business?",
    answer:
      "It depends on your state's laws and your business model. If you're in a state with permissive AOB laws, an AOB gives you direct control over the claim process and carrier negotiations. If you're in a state with restrictions or your carrier relationships are strong, a contingency agreement may be simpler and less contentious. Many contractors use contingency agreements as their default and reserve AOBs for complex or disputed claims.",
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
  headline: "What Is an AOB (Assignment of Benefits) for Roofing?",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage:
    "https://www.dumbroof.ai/learn/what-is-aob-assignment-of-benefits-roofing",
  description:
    "Learn what an Assignment of Benefits (AOB) means for roofing contractors, how it differs from a contingency agreement, and how to automate AOB workflows with e-signatures.",
};

export default function WhatIsAOBRoofing() {
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
              What Is an AOB (Assignment of Benefits)?
            </span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Business Operations
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              What Is an AOB (Assignment of Benefits) for Roofing?
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 13 min read
            </p>
          </header>

          {/* Direct Answer -- AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">
              An Assignment of Benefits (AOB)
            </strong>{" "}
            is a legal document in which a homeowner transfers their insurance
            claim rights to a third party — typically a roofing contractor. Once
            signed, the contractor can file the claim, negotiate directly with
            the insurance carrier, and receive payment without the homeowner
            acting as a middleman. AOBs are common in roofing and water
            mitigation but have become controversial due to abuse in some
            markets, leading to significant legislative reform in states like
            Florida.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong>{" "}
              Florida&apos;s AOB-related lawsuits grew from{" "}
              <strong className="text-[var(--white)]">
                405 in 2006 to over 135,000 in 2018
              </strong>{" "}
              — a 33,000% increase — before the state enacted major reform
              legislation in 2019. The fallout reshaped how contractors across
              the country think about claim assignments, making it critical to
              understand both the benefits and the risks.
            </p>
          </div>

          {/* Section 1 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="aob-plain-english"
          >
            What Is an AOB in Plain English?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Think of an AOB like a power of attorney — but specifically for an
            insurance claim. When a homeowner signs an AOB, they&apos;re saying:
            &ldquo;I authorize this contractor to deal with my insurance company
            on my behalf for this specific claim.&rdquo; The contractor steps
            into the homeowner&apos;s shoes and gains the right to file
            paperwork, negotiate the scope of repairs, request supplements, and
            collect payment directly from the carrier.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Without an AOB, the claim stays in the homeowner&apos;s name. The
            carrier issues payment to the homeowner (and typically the mortgage
            company), who then pays the contractor. With an AOB, the carrier
            pays the contractor directly — or the contractor at least has legal
            standing to dispute underpayments without requiring the homeowner to
            be involved at every step.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            AOBs are not unique to roofing. They&apos;re used in auto body
            repair, water mitigation, medical billing, and other industries
            where a third-party service provider works on an insurance claim.
            In roofing, they became widespread in storm-prone states where
            high claim volume made it impractical for homeowners to manage
            every interaction with their carrier.
          </p>

          {/* Section 2 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="how-aob-works-roofing"
          >
            How Does an AOB Work for Roofing Contractors?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The AOB workflow for a roofing contractor typically follows a
            predictable sequence. Understanding each step helps you decide
            whether an AOB fits your business model — and where the
            compliance pitfalls are.
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Inspection and Documentation",
                desc: "The contractor inspects the property, documents the damage with photos and measurements, and determines that an insurance claim is warranted. This is the same first step whether or not an AOB will be used.",
              },
              {
                num: "02",
                title: "Homeowner Signs the AOB",
                desc: "Before any work begins, the homeowner signs an AOB transferring their claim rights to the contractor. The document must clearly describe the scope of work, the specific insurance policy, and any rescission rights the homeowner has under state law.",
              },
              {
                num: "03",
                title: "Contractor Files and Manages the Claim",
                desc: "The contractor files the claim directly with the carrier, coordinates the adjuster inspection, submits estimates, and negotiates the scope and pricing. The homeowner is kept informed but doesn't need to manage the back-and-forth.",
              },
              {
                num: "04",
                title: "Supplements and Negotiation",
                desc: "If the initial carrier estimate is insufficient, the contractor submits supplements with supporting documentation — line-item estimates, code citations, photos. With an AOB, the contractor has legal standing to dispute underpayments directly.",
              },
              {
                num: "05",
                title: "Work Completion and Payment",
                desc: "Once the claim is approved and work is complete, the insurance carrier issues payment. Depending on the state and policy, the check may go directly to the contractor, to the homeowner for endorsement, or to both parties jointly.",
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

          {/* Section 3 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="aob-vs-contingency"
          >
            AOB vs. Contingency Agreement: What&apos;s the Difference?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            These two documents are often confused, but they serve very
            different legal functions. Understanding the distinction is
            essential for staying compliant and choosing the right tool for
            your market.
          </p>

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-4">
              Side-by-Side Comparison:
            </p>
            <div className="space-y-4">
              {[
                {
                  label: "Claim Ownership",
                  aob: "Transfers to the contractor. The contractor becomes the claimant.",
                  contingency: "Stays with the homeowner. The homeowner remains the claimant.",
                },
                {
                  label: "Carrier Negotiations",
                  aob: "Contractor negotiates directly with the carrier as the assignee.",
                  contingency: "Homeowner is the negotiating party; contractor advises and supports.",
                },
                {
                  label: "Payment Flow",
                  aob: "Carrier may pay the contractor directly (varies by state).",
                  contingency: "Carrier pays the homeowner, who then pays the contractor.",
                },
                {
                  label: "Legal Standing",
                  aob: "Contractor can sue the carrier for underpayment in their own name.",
                  contingency: "Only the homeowner has standing to dispute with the carrier.",
                },
                {
                  label: "Regulatory Complexity",
                  aob: "High. Subject to state-specific AOB statutes, notice requirements, and reform laws.",
                  contingency: "Lower. Generally treated as a standard service contract.",
                },
              ].map((row) => (
                <div key={row.label} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
                  <p className="text-sm font-semibold text-[var(--white)] mb-2">
                    {row.label}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="text-sm text-[var(--gray-muted)] leading-relaxed">
                      <span className="text-[var(--red)] font-semibold">AOB:</span>{" "}
                      {row.aob}
                    </div>
                    <div className="text-sm text-[var(--gray-muted)] leading-relaxed">
                      <span className="text-[var(--blue)] font-semibold">Contingency:</span>{" "}
                      {row.contingency}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[var(--gray)] leading-relaxed mb-6">
            In practice, many roofing contractors use contingency agreements as
            their default because they&apos;re simpler and less legally fraught.
            AOBs are reserved for situations where the contractor needs direct
            legal standing — typically complex claims, carrier disputes, or
            markets where AOBs are standard practice.
          </p>

          {/* Section 4 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="state-laws"
          >
            State Laws: Florida&apos;s AOB Reform, Texas Rules, and Beyond
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            AOB laws vary dramatically from state to state. What&apos;s
            standard practice in one market may be illegal or heavily regulated
            in another. Here&apos;s a look at the key states roofing
            contractors should understand.
          </p>

          <div className="space-y-4 mb-6">
            <div className="glass-card p-5">
              <h3 className="text-[var(--white)] font-semibold text-sm mb-2">
                Florida (SB 122 — 2019 Reform)
              </h3>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                Florida was ground zero for AOB abuse. The state saw a
                staggering increase in AOB-related litigation, with lawsuits
                rising from 405 in 2006 to over 135,000 in 2018. In response,
                SB 122 introduced mandatory notice requirements (the contractor
                must notify the insurer within 3 business days of receiving an
                AOB), a 14-day rescission window for homeowners, limitations on
                attorney fee-shifting (previously a major incentive for
                litigation), and the insurer&apos;s right to offer a
                managed-repair option. In 2023, Florida further tightened the
                rules with HB 837, eliminating one-way attorney fee recovery in
                property insurance cases entirely.
              </p>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-[var(--white)] font-semibold text-sm mb-2">
                Texas
              </h3>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                Texas does not have a specific AOB statute for property
                insurance. AOBs are generally permissible, but insurers often
                include anti-assignment clauses in their policies. Texas courts
                have historically upheld these clauses, meaning a contractor
                with an AOB may not have enforceable rights if the policy
                prohibits assignment. Many Texas contractors rely on
                contingency agreements instead, which avoid this issue entirely.
                Texas also has strict rules about solicitation and door-to-door
                sales that indirectly affect how contractors obtain AOBs.
              </p>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-[var(--white)] font-semibold text-sm mb-2">
                Colorado
              </h3>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                Colorado passed HB 19-1209 in 2019, which prohibits roofing
                contractors from requiring homeowners to sign an AOB as a
                condition of receiving an estimate or inspection. Contractors
                can still use AOBs, but they cannot be tied to the inspection
                process. The law also prohibits rebates and incentives to
                induce a homeowner to file a claim.
              </p>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-[var(--white)] font-semibold text-sm mb-2">
                Other States to Watch
              </h3>
              <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                North Carolina, Tennessee, and Louisiana have all enacted or
                proposed legislation targeting AOB practices in property
                insurance. The trend is toward more regulation, not less. If
                you operate in multiple states, assume that each market has
                different rules and build your workflow to accommodate
                state-specific document templates.
              </p>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 mb-6">
            <p className="text-amber-400 text-sm leading-relaxed">
              <strong>Disclaimer:</strong> This article is for educational
              purposes and does not constitute legal advice. AOB laws change
              frequently. Always consult a licensed attorney in your state
              before using AOBs in your business.
            </p>
          </div>

          {/* Section 5 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="benefits-contractors"
          >
            Benefits of AOBs for Roofing Contractors
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            When used properly and in compliance with state law, AOBs offer
            legitimate advantages for roofing contractors:
          </p>

          <div className="glass-card p-6 mb-6">
            <div className="space-y-2">
              {[
                "Direct control over the claims process — no waiting on homeowners to forward paperwork or make phone calls",
                "Legal standing to dispute underpayments and file supplements without requiring homeowner involvement at every step",
                "Faster claim resolution since the contractor manages the timeline directly with the carrier",
                "Ability to negotiate scope and pricing with adjusters as the assignee, not just an advisor",
                "Streamlined payment flow in states that allow direct payment to the assignee",
                "Professional positioning — demonstrates to the homeowner that you handle everything from inspection to payment",
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

          {/* Section 6 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="benefits-homeowners"
          >
            Benefits of AOBs for Homeowners
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A well-executed AOB can genuinely help homeowners, especially those
            who lack the time, knowledge, or willingness to manage an insurance
            claim themselves:
          </p>

          <div className="glass-card p-6 mb-6">
            <div className="space-y-2">
              {[
                "The homeowner doesn't have to negotiate with the insurance company — the contractor handles all communication",
                "Reduced paperwork burden — no need to file claims, submit documentation, or track supplement approvals",
                "The contractor has a financial incentive to maximize the claim payout, which often aligns with the homeowner's interest in getting full repairs",
                "Faster repairs since the contractor can begin coordinating materials and scheduling without waiting for the homeowner to approve each step",
                "Access to experienced claims professionals who understand policy language, Xactimate pricing, and carrier negotiation tactics",
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

          {/* Section 7 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="risks-controversy"
          >
            Risks and Controversy: Why AOBs Have a Bad Reputation
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            It would be irresponsible to discuss AOBs without acknowledging the
            real problems that have occurred. The controversy is not
            hypothetical — it reshaped insurance markets and led to sweeping
            legislation. Here&apos;s an honest look at the risks:
          </p>

          <div className="space-y-3 mb-6">
            {[
              {
                risk: "Inflated claims and litigation abuse",
                detail:
                  "In Florida, some contractors and attorneys used AOBs to inflate repair costs and then sue carriers when they didn't pay the inflated amount. The one-way attorney fee structure meant carriers often settled even questionable claims because defending them was more expensive. This drove up premiums for all policyholders.",
              },
              {
                risk: "Homeowner loses control of the claim",
                detail:
                  "Once an AOB is signed, the homeowner may have limited ability to influence the direction of the claim. If the contractor and carrier reach an impasse, the homeowner's property may sit unrepaired while legal proceedings play out.",
              },
              {
                risk: "Quality concerns",
                detail:
                  "When contractors are incentivized to maximize claim payouts, there's a risk that the focus shifts from quality repairs to maximum billing. Reputable contractors don't operate this way, but the AOB structure can create perverse incentives for bad actors.",
              },
              {
                risk: "Carrier pushback and policy restrictions",
                detail:
                  "Many insurance carriers have responded to AOB abuse by adding anti-assignment clauses to policies, increasing deductibles, or withdrawing from certain markets entirely. This can make it harder for legitimate contractors to use AOBs, even in states where they're legal.",
              },
              {
                risk: "Reputation risk for the industry",
                detail:
                  "The broader roofing industry has suffered reputational damage from AOB abuse. Homeowners who have heard negative stories may be hesitant to sign any agreement, even a standard contingency contract. Contractors who use AOBs need to be especially transparent about what the document means and what rights the homeowner retains.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">
                    &#x2715;
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--white)] text-sm">
                      {item.risk}
                    </p>
                    <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[var(--gray)] leading-relaxed mb-6">
            The bottom line: AOBs are a legitimate legal tool, but they&apos;ve
            been misused badly enough to trigger an industry-wide reckoning.
            If you use them, do it transparently, comply with every state
            requirement, and make sure the homeowner understands exactly
            what they&apos;re signing.
          </p>

          {/* Section 8 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="good-aob-includes"
          >
            What Should a Good AOB Include?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Whether you draft your own AOB or use a template, make sure it
            includes these elements. Missing any of them can render the
            document unenforceable or expose you to liability.
          </p>

          <div className="glass-card p-6 mb-6">
            <p className="font-semibold text-[var(--white)] mb-3">
              Essential AOB Components:
            </p>
            <div className="space-y-2">
              {[
                "Full legal names and contact information for the homeowner and the contractor",
                "The specific insurance policy number and carrier name",
                "A clear description of the scope of work being assigned (e.g., \"roof repair due to storm damage on [date]\")",
                "The homeowner's rescission rights — how long they have to cancel and how to do it",
                "A statement that the contractor will not charge more than the insurance proceeds without prior written consent",
                "Notice requirements — when and how the contractor must notify the insurer of the assignment",
                "A prohibition against the contractor billing the homeowner for amounts the carrier disputes (unless explicitly agreed otherwise)",
                "A clause stating the homeowner retains the right to communicate with their insurer at any time",
                "Signature lines with dates and, where required, witness or notary provisions",
                "Any state-specific disclosures required by law (e.g., Florida's mandatory AOB notice language)",
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

          {/* Section 9 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="digital-signatures"
          >
            Digital Signatures and Compliance
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            In 2026, there&apos;s no reason to chase wet signatures on AOB
            documents. The federal ESIGN Act (2000) and the Uniform Electronic
            Transactions Act (UETA), adopted in 47 states, make electronic
            signatures legally binding for most commercial contracts — including
            AOBs and contingency agreements.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Digital signatures offer practical advantages beyond convenience:
            they create a timestamped, tamper-evident record of when the
            document was signed, from what device and IP address, and whether
            the signer viewed the full document before signing. This audit
            trail is far stronger than a pen-on-paper signature with no
            verification of when or how it was obtained.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            For compliance, make sure your e-signature workflow includes clear
            disclosure of what the homeowner is signing, the ability to
            download a copy of the signed document immediately, and a
            delivery mechanism that doesn&apos;t require the homeowner to
            create an account or install an app. Frictionless signing improves
            conversion rates and reduces the chance of homeowners abandoning
            the process.
          </p>

          {/* Section 10 */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="dumbroof-automates"
          >
            How dumbroof.ai Automates AOB and Contingency Workflows
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai is built for roofing contractors who handle insurance
            claims. As part of the claim workflow, the platform generates AOB
            and contingency agreement templates that are customizable to your
            business and state requirements. Here&apos;s how it works:
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Template Generation",
                desc: "When you create a claim in dumbroof.ai, the platform generates an AOB or contingency agreement pre-populated with the property address, homeowner name, insurance carrier, policy number, and scope of work. You choose which document type to use based on your state and business preference.",
              },
              {
                num: "02",
                title: "Digital Signature via Secure Link",
                desc: "Send the document to the homeowner via a secure link — no printing, scanning, or chasing signatures. The homeowner reviews the full document, acknowledges disclosures, and signs from their phone or computer. The signed document is timestamped and stored with the claim file.",
              },
              {
                num: "03",
                title: "Claim File Integration",
                desc: "The signed AOB or contingency agreement becomes part of the complete claim package alongside inspection photos, measurements, AI-generated estimates, and supplement documentation. Everything is accessible from one dashboard — no digging through email attachments or filing cabinets.",
              },
              {
                num: "04",
                title: "Audit and Compliance Trail",
                desc: "Every signed document includes a full audit trail: signer identity, timestamp, IP address, device information, and a record that the signer viewed the complete document. This protects your business in disputes and satisfies state compliance requirements.",
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
            The goal is simple: eliminate paper, reduce friction, and make sure
            every claim file is complete and audit-ready from day one. Whether
            you use AOBs, contingency agreements, or both, the workflow should
            be digital, fast, and compliant.
          </p>

          {/* FAQ Section */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-6"
            id="faq"
          >
            Frequently Asked Questions About AOBs in Roofing
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
              Streamline Your AOB and Contingency Workflows
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              dumbroof.ai generates AOB and contingency agreement templates,
              collects digital signatures, and stores everything with your
              claim file. Upload photos and measurements, get 5 professional
              documents in 15 minutes — plus e-signed agreements ready for
              your files.
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

          {/* Related Articles */}
          <div className="mt-14">
            <h3 className="text-lg font-bold text-[var(--white)] mb-4">
              Related Articles
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <a
                href="/learn/how-to-automate-insurance-invoicing"
                className="glass-card p-5 hover:border-white/30 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                  Business Operations
                </span>
                <p className="text-sm font-semibold text-[var(--white)] mt-1">
                  How to Automate Insurance Invoicing
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
