import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title:
    "How Long Do I Have to File a Roof Insurance Claim? State Deadlines & Tips",
  description:
    "Learn how long you have to file a roof insurance claim. State-by-state deadlines, statute of limitations, prompt notice rules, and tips to avoid missing your filing window. Guide from dumbroof.ai.",
  keywords: [
    "how long to file roof insurance claim",
    "roof claim deadline",
    "statute of limitations roof claim",
    "roof insurance time limit",
    "late roof insurance claim",
  ],
  openGraph: {
    title:
      "How Long Do I Have to File a Roof Insurance Claim? State Deadlines & Tips",
    description:
      "State-by-state filing deadlines, statute of limitations rules, and what happens if you miss your window. File faster with dumbroof.ai.",
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
      name: "How long do I have to file a roof insurance claim after a storm?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Most homeowners have between 1 and 2 years to file a roof insurance claim after storm damage, but the exact deadline depends on your state's statute of limitations and your specific insurance policy. Some states like Texas allow only 1 year, while Florida allows up to 2 years. Always check your policy for 'prompt notice' requirements that may impose shorter deadlines.",
      },
    },
    {
      "@type": "Question",
      name: "What happens if I miss the deadline to file a roof claim?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "If you miss your state's statute of limitations or your policy's filing deadline, your insurance carrier can legally deny the claim outright. You lose all rights to compensation for the damage, regardless of how severe or well-documented it is. In some cases, the carrier may also cancel or non-renew your policy.",
      },
    },
    {
      "@type": "Question",
      name: "Does the filing deadline start from the storm date or the discovery date?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "In most states, the filing deadline starts from the date of loss (the storm date). However, some states apply a 'discovery rule' where the deadline starts from when you reasonably discovered or should have discovered the damage. This exception is important for damage that is not immediately visible, such as slow leaks caused by displaced flashing.",
      },
    },
    {
      "@type": "Question",
      name: "What does 'prompt notice' mean in a roof insurance policy?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Prompt notice is a policy requirement that you report damage to your insurance carrier within a reasonable timeframe after discovering it. While the exact definition varies by policy and state law, carriers generally expect notice within 30-60 days of the loss event. Failing to provide prompt notice can give the carrier grounds to deny your claim even if you are within the statute of limitations.",
      },
    },
    {
      "@type": "Question",
      name: "Can dumbroof.ai help me file my roof claim faster?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. dumbroof.ai uses AI to generate forensic-grade documentation in 15 minutes per claim, including Xactimate-style estimates, causation reports, and carrier-ready cover letters. This eliminates weeks of manual documentation work and helps you file well before any deadline expires, reducing the risk of denial due to late filing.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline:
    "How Long Do I Have to File a Roof Insurance Claim? State Deadlines & Tips",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage:
    "https://www.dumbroof.ai/learn/how-long-to-file-roof-insurance-claim",
  description:
    "Learn how long you have to file a roof insurance claim. State-by-state deadlines, statute of limitations, prompt notice rules, and tips to avoid missing your filing window.",
};

const stateDeadlines = [
  { state: "Texas", deadline: "1 year", note: "Strict; no extensions" },
  { state: "Florida", deadline: "2 years", note: "Reduced from 5 years in 2023" },
  { state: "Colorado", deadline: "2 years", note: "From date of loss" },
  { state: "Georgia", deadline: "1 year", note: "Prompt notice enforced" },
  { state: "Louisiana", deadline: "1 year", note: "Prescription period" },
  { state: "North Carolina", deadline: "3 years", note: "From date of loss" },
  { state: "Oklahoma", deadline: "1 year", note: "Strict enforcement" },
  { state: "Illinois", deadline: "2 years", note: "From date of loss" },
  { state: "Ohio", deadline: "1 year", note: "Prompt notice required" },
  { state: "Minnesota", deadline: "6 years", note: "One of the longest" },
  { state: "California", deadline: "1 year", note: "From date of loss" },
  { state: "Alabama", deadline: "1 year", note: "Prompt notice enforced" },
];

export default function HowLongToFileRoofInsuranceClaim() {
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
              How Long to File a Roof Insurance Claim
            </span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Insurance Claims
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              How Long Do I Have to File a Roof Insurance Claim?
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 11 min read
            </p>
          </header>

          {/* Direct Answer */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">
              You typically have 1 to 2 years to file a roof insurance claim
              after storm damage
            </strong>
            , but the exact deadline depends on your state&apos;s statute of
            limitations and your insurance policy&apos;s &ldquo;prompt
            notice&rdquo; requirement. Some states give you as little as 12
            months from the date of loss. Miss the window and your carrier can
            deny the claim outright&mdash;no matter how severe the damage.
          </p>

          {/* Key Stat */}
          <div className="glass-card p-6 mb-10">
            <p className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Key Stat
            </p>
            <p className="text-xl text-[var(--white)] font-bold">
              An estimated 1 in 5 roof insurance claims is denied or
              underpaid due to late filing, missed deadlines, or insufficient
              documentation&mdash;issues that are entirely preventable with
              the right workflow.
            </p>
          </div>

          {/* Section 1: General Timelines */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="general-timelines"
          >
            What Is the General Timeline for Filing a Roof Insurance Claim?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Most homeowners insurance policies require you to file a claim
            within 1 to 2 years of the date of loss. This is governed by your
            state&apos;s statute of limitations for property insurance claims,
            which sets the legal maximum. However, your actual deadline may be
            shorter because your policy likely includes a &ldquo;prompt
            notice&rdquo; clause that requires you to report damage within a
            &ldquo;reasonable&rdquo; timeframe&mdash;often interpreted as 30 to
            60 days.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The 1-to-2-year range is a general guideline, not a guarantee. Some
            states set much shorter windows (Texas: 1 year), while others are
            more generous (Minnesota: 6 years). The critical point is that
            waiting costs you leverage. Every week you delay, the carrier has
            more reason to argue that damage was caused by wear and tear rather
            than a covered storm event.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            The clock starts ticking the moment the storm occurs. Not when you
            notice a leak. Not when you call a contractor. Not when you get
            around to it. The date of loss is the anchor, and every deadline
            flows from it.
          </p>

          {/* Section 2: State-by-State Deadlines */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="state-deadlines"
          >
            State-by-State Roof Claim Filing Deadlines
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Filing deadlines vary dramatically by state. The following table
            shows the statute of limitations for property insurance claims in
            common storm-damage states. These are legal maximums&mdash;your
            policy may impose shorter deadlines.
          </p>

          <div className="glass-card p-6 mb-8 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-[var(--white)] font-semibold py-3 pr-4">
                    State
                  </th>
                  <th className="text-left text-[var(--white)] font-semibold py-3 pr-4">
                    Statute of Limitations
                  </th>
                  <th className="text-left text-[var(--white)] font-semibold py-3">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {stateDeadlines.map((row) => (
                  <tr
                    key={row.state}
                    className="border-b border-white/5 last:border-0"
                  >
                    <td className="py-3 pr-4 text-[var(--white)] font-medium">
                      {row.state}
                    </td>
                    <td className="py-3 pr-4 text-[var(--cyan)] font-bold">
                      {row.deadline}
                    </td>
                    <td className="py-3 text-[var(--gray-muted)]">
                      {row.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-[var(--gray-dim)] mt-4">
              Deadlines reflect general statute of limitations for property
              insurance claims. Always verify your specific policy language and
              consult local counsel for legal advice.
            </p>
          </div>

          {/* Section 3: Policy-Specific Deadlines */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="policy-deadlines"
          >
            Policy-Specific Deadlines: Why Your Policy May Be Stricter Than
            State Law
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Even in states with generous statutes of limitations, your insurance
            policy may impose its own tighter deadlines. Many carriers include
            contractual limitation clauses that shorten the filing window to 1
            year or less, regardless of state law. These clauses are enforceable
            in most states as long as they give you a &ldquo;reasonable&rdquo;
            amount of time to file.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Read the &ldquo;Duties After Loss&rdquo; section of your
            homeowners policy. It will specify exactly when you must report
            damage and what documentation you must provide. If you cannot locate
            your policy, call your carrier or agent and request a copy
            immediately&mdash;before a storm hits.
          </p>

          {/* Section 4: Prompt Notice */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="prompt-notice"
          >
            What Does &ldquo;Prompt Notice&rdquo; Mean in Roof Insurance
            Claims?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Nearly every homeowners insurance policy contains a clause requiring
            you to provide &ldquo;prompt notice&rdquo; or &ldquo;timely
            notice&rdquo; of a loss. This means you must report damage to your
            carrier as soon as reasonably possible after discovering it. While
            the policy may not define an exact number of days, courts and
            carriers generally interpret prompt notice as 30 to 60 days from the
            date of loss or discovery.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Prompt notice is separate from the statute of limitations. You can
            be within the statute of limitations but still have your claim
            denied for failing to provide prompt notice. The carrier&apos;s
            argument is that delayed reporting prevented them from inspecting
            the damage in its original condition, which prejudiced their ability
            to evaluate the claim fairly. This is why filing fast matters more
            than filing perfectly.
          </p>

          {/* Stat block */}
          <div className="glass-card p-6 my-8">
            <p className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Filing Urgency
            </p>
            <p className="text-xl text-[var(--white)] font-bold">
              Claims filed within 30 days of a storm event are approved at
              significantly higher rates than claims filed after 6
              months&mdash;carriers treat delay as a red flag for pre-existing
              damage.
            </p>
          </div>

          {/* Section 5: Missing the Deadline */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="missed-deadline"
          >
            What Happens If You Miss the Filing Deadline?
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            If you miss your state&apos;s statute of limitations or your
            policy&apos;s contractual deadline, the consequences are severe and
            typically irreversible:
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                label: "Automatic denial",
                detail:
                  "The carrier can deny your claim outright with no obligation to evaluate the damage or negotiate.",
              },
              {
                label: "No legal recourse",
                detail:
                  "You cannot sue the carrier for bad faith or breach of contract because you failed to meet a condition precedent to coverage.",
              },
              {
                label: "Full financial liability",
                detail:
                  "You bear 100% of the repair cost out of pocket, even if the damage is catastrophic and clearly caused by a covered peril.",
              },
              {
                label: "Policy consequences",
                detail:
                  "Some carriers may non-renew or cancel your policy after a late filing attempt, viewing it as a sign of poor property maintenance.",
              },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">
                    &#x2715;
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--white)] text-sm">
                      {item.label}
                    </p>
                    <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Section 6: Exceptions */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="exceptions"
          >
            Exceptions to Filing Deadlines: The Discovery Rule
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Some states apply a &ldquo;discovery rule&rdquo; that starts the
            filing clock not from the date of the storm, but from the date you
            reasonably discovered (or should have discovered) the damage. This
            exception is critical for damage that is not immediately
            visible&mdash;such as a displaced pipe boot that causes a slow leak
            into the attic over months, or granule loss that only becomes
            apparent during a professional inspection.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            To benefit from the discovery rule, you must demonstrate that a
            reasonable homeowner would not have detected the damage earlier. If
            the carrier can prove you had visible signs of damage (water stains,
            missing shingles visible from ground level) and failed to act, the
            exception does not apply. Document the moment you discover damage
            with dated photos, written notes, and a call to your carrier on the
            same day.
          </p>

          {/* Section 7: Storm Dates */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="storm-dates"
          >
            How Storm Dates Affect Your Filing Window
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The date of loss is the single most important data point in your
            claim timeline. Insurance carriers use verified weather data (NOAA
            storm reports, SPC hail records, local weather station logs) to
            confirm that a covered weather event occurred on the claimed date.
            If you cannot tie your damage to a specific storm date, the carrier
            will argue the damage is pre-existing or caused by gradual wear.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            For areas with frequent storm activity, this becomes complex. A
            roof may sustain minor damage in March, additional damage in June,
            and catastrophic damage in September. Each event creates its own
            filing window. If you file in October citing the March storm, you
            may be outside the prompt-notice window for that event&mdash;even
            though the cumulative damage just became apparent.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Best practice: inspect your roof after every significant weather
            event and document findings with dated photos. This creates a
            timeline of damage progression that supports your claim no matter
            which storm the carrier attributes the loss to.
          </p>

          {/* Stat block */}
          <div className="glass-card p-6 my-8">
            <p className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Timeline Impact
            </p>
            <p className="text-xl text-[var(--white)] font-bold">
              Carriers reference NOAA storm data to validate your claimed date
              of loss. If no verified weather event matches your timeline, the
              claim is flagged for denial&mdash;regardless of visible damage.
            </p>
          </div>

          {/* Section 8: Documentation Tips */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="documentation-tips"
          >
            Tips for Documenting Your Claim Timeline
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Protecting your filing window starts with documentation. These
            steps ensure you have a clear, defensible timeline that carriers
            cannot dispute:
          </p>

          <div className="space-y-4 mb-6">
            {[
              {
                num: "01",
                title: "Photograph damage immediately after every storm",
                desc: "Take dated photos of your roof, gutters, siding, and soft metals (AC units, vents) within 48 hours of a storm. Smartphone metadata timestamps these automatically.",
              },
              {
                num: "02",
                title: "Record the date you first noticed damage",
                desc: "Write a dated note or send yourself an email describing what you observed. This establishes the discovery date if the discovery rule applies in your state.",
              },
              {
                num: "03",
                title: "Call your carrier within 48 hours",
                desc: "Even if you are not sure whether to file a claim, report the damage to your carrier to satisfy the prompt-notice requirement. You can decide later whether to proceed.",
              },
              {
                num: "04",
                title: "Save weather reports from the date of loss",
                desc: "Download NOAA storm reports, SPC hail data, or local news coverage confirming the weather event. This evidence ties your damage to a specific covered peril.",
              },
              {
                num: "05",
                title: "Get a professional inspection within 2 weeks",
                desc: "A qualified roofing contractor's inspection report with dated photos and damage measurements creates expert evidence that strengthens your claim and locks in the timeline.",
              },
              {
                num: "06",
                title: "Keep a claim timeline log",
                desc: "Record every interaction: calls, emails, adjuster visits, contractor inspections. Organized timelines demonstrate good faith and make carrier disputes harder to sustain.",
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

          {/* Section 9: How dumbroof.ai Helps */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-4"
            id="dumbroof-helps"
          >
            How dumbroof.ai Helps You File Faster and Beat the Deadline
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The number-one reason contractors and homeowners miss filing
            deadlines is not procrastination&mdash;it&apos;s documentation
            bottlenecks. Building a carrier-grade claim package manually takes
            days or weeks: measuring damage, writing scope, pulling weather
            data, formatting Xactimate-style estimates, drafting cover letters.
            By the time the paperwork is done, weeks have passed and the
            carrier&apos;s prompt-notice argument is already building.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai eliminates the bottleneck. Upload your photos and
            measurements, and the AI generates five professional documents in 15
            minutes: a forensic causation report, an Xactimate-style estimate
            with line-item detail, a carrier comparison, a supplement letter,
            and a cover email. The documentation is carrier-ready the same day
            damage is discovered&mdash;no waiting, no back-and-forth, no missed
            deadlines.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            For contractors processing dozens of claims after a major storm
            event, speed is survival. dumbroof.ai lets you document and file
            every claim within the first week while evidence is fresh, weather
            data is accessible, and carriers have no grounds to argue delayed
            reporting. Over{" "}
            <strong className="text-[var(--white)]">$12.5 million</strong> in
            claims have been processed through the platform with{" "}
            <strong className="text-[var(--white)]">$2.6 million</strong> in
            approved supplements.
          </p>

          {/* FAQ Section */}
          <h2
            className="text-2xl font-bold text-[var(--white)] mt-14 mb-6"
            id="faq"
          >
            Frequently Asked Questions About Roof Claim Filing Deadlines
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
              Don&apos;t Let the Clock Run Out
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              Upload your damage photos and measurements. Get 5 carrier-ready
              documents in 15 minutes&mdash;file your claim before the deadline
              becomes a problem.
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
