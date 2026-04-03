import type { Metadata } from "next";
import { LearnPhotoGallery } from "@/components/learn-photo-gallery";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "My Contractor Says I Have Hail Damage But I Don't See It | Homeowner Guide",
  description:
    "Your contractor says you have hail damage but you can't see it from the ground. Learn why hail damage is nearly invisible to untrained eyes, what professionals look for up close, and how to verify the diagnosis independently with AI analysis.",
  keywords: [
    "contractor says hail damage",
    "can't see hail damage on roof",
    "is my contractor lying about hail damage",
    "how to tell if roof has hail damage",
    "hail damage hard to see",
    "verify hail damage on roof",
    "hail damage second opinion",
  ],
  openGraph: {
    title: "My Contractor Says I Have Hail Damage But I Don't See It",
    description: "Why hail damage is nearly invisible from the ground and how to verify your contractor's diagnosis independently.",
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
      name: "Can you see hail damage on a roof from the ground?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "In most cases, no. Hail damage to asphalt shingles appears as subtle circular bruises where granules have been displaced, typically 1 to 2 inches in diameter. From the ground — 15 to 30 feet below — these marks are virtually invisible. You may notice granule accumulation in gutters or downspouts, but the actual impact marks on the shingle surface require close-range inspection to identify.",
      },
    },
    {
      "@type": "Question",
      name: "How do I know if my roofing contractor is lying about hail damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Legitimate contractors will show you photo evidence from the roof, explain what they found using industry terminology (granule loss, mat exposure, bruising), offer to let you or a third party verify, and never pressure you to sign a contract on the spot. Red flags include refusing to provide photos, pressuring you to sign immediately, demanding large upfront payments, or lacking proper licensing and insurance. You can also request a HAAG-certified inspection or use an independent AI analysis tool like dumbroof.ai for verification.",
      },
    },
    {
      "@type": "Question",
      name: "What does hail damage look like up close on shingles?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Up close, hail damage on asphalt shingles appears as random circular depressions where granules have been knocked loose, exposing the dark asphalt mat underneath. The impact area feels soft or spongy when pressed compared to surrounding undamaged shingle. These marks have no pattern or alignment — they appear randomly across the roof surface, which distinguishes hail from foot traffic, manufacturing defects, or mechanical damage.",
      },
    },
    {
      "@type": "Question",
      name: "What is a HAAG-certified roof inspection?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "HAAG Engineering is the gold standard for forensic roof inspection certification. A HAAG-certified inspector has completed rigorous training in identifying storm damage across all roofing materials and can provide expert testimony that insurance carriers recognize and respect. HAAG certification covers hail damage, wind damage, and structural assessment. If you want an independent verification of your contractor's findings, a HAAG-certified inspector is the highest level of credibility available.",
      },
    },
    {
      "@type": "Question",
      name: "Can I get a second opinion on roof hail damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Absolutely. You have every right to get a second opinion on any roof damage assessment. You can hire an independent HAAG-certified inspector, ask another licensed contractor to evaluate, or use AI-powered analysis tools like dumbroof.ai to review inspection photos independently. Your insurance company may also send their own adjuster, which serves as another set of eyes. Getting multiple opinions is a smart move — it protects you from both storm chasers who exaggerate damage and from carriers who underestimate it.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "My Contractor Says I Have Hail Damage But I Don't See It",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage: "https://www.dumbroof.ai/learn/contractor-says-hail-damage-but-i-dont-see-it",
  description: "Why hail damage is nearly invisible from the ground, what contractors look for up close, and how to verify the diagnosis independently.",
};

export default function ContractorSaysHailDamage() {
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
            <span className="text-[var(--gray)]">Contractor Says Hail Damage But I Don&apos;t See It</span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Homeowner Guide
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              My Contractor Says I Have Hail Damage But I Don&apos;t See It
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 12 min read
            </p>
          </header>

          {/* Direct Answer — AEO optimized */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">Your skepticism is completely reasonable.</strong>{" "}
            When a contractor knocks on your door after a storm and tells you your roof has hail
            damage, but you look up and everything seems fine, it&apos;s natural to wonder if
            you&apos;re being misled. Here&apos;s the truth: most legitimate hail damage is genuinely
            invisible from the ground. Hailstones strike shingles at terminal velocity and displace
            tiny granules in circular impact patterns that are only 1 to 2 inches across — far too
            small to see from 20 or 30 feet below. That doesn&apos;t mean the damage isn&apos;t real.
            But it also doesn&apos;t mean every contractor telling you about it is honest.
            This guide helps you tell the difference.
          </p>

          <div className="bg-white/[0.03] rounded-xl border border-white/10 p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong> According to the Insurance
              Information Institute, hail damage accounts for roughly <strong className="text-[var(--white)]">$14 billion in annual
              insured losses</strong> across the United States. The National Roofing Contractors
              Association estimates that <strong className="text-[var(--white)]">70% of hail damage goes undetected
              </strong> by homeowners because the marks are too small to see without a roof-level
              inspection.
            </p>
          </div>

          {/* Section: Why Hail Damage Is Hard to See From the Ground */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="hard-to-see">
            Why Hail Damage Is Nearly Invisible From the Ground
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            This is the single most important thing to understand: the physics of hail impact
            work against your ability to see damage from your yard. Hailstones typically range
            from 1 to 2 inches in diameter when they cause meaningful roof damage. When a
            hailstone strikes an asphalt shingle, it compresses the granule layer and fractures
            the fiberglass mat underneath — but it doesn&apos;t tear a hole or rip off a section.
            The damage is a subtle depression, not a dramatic wound.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            From ground level, you&apos;re looking at your roof from a distance of 15 to 30 feet
            at a steep angle. At that distance and angle, a 1.5-inch circular mark on a
            dark-colored shingle is effectively invisible. You could have 50 impacts per
            10&times;10-foot section — more than enough for a full roof replacement under any
            insurance policy — and your roof would still look perfectly normal from your driveway.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            This isn&apos;t unique to roofing. A doctor can see bruising under your skin that
            you can&apos;t feel yet. A mechanic can hear a bearing failing that sounds fine to
            you. Roof damage works the same way — it&apos;s a trained-eye problem, not a
            visibility problem.
          </p>

          {/* Section: What Contractors Look for Up Close */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="what-they-look-for">
            What Contractors Actually Look for Up Close
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            When a qualified inspector examines your roof for hail damage, they&apos;re looking
            for three specific indicators that confirm impact from frozen precipitation. These
            signs are distinct from wear and tear, foot traffic, or manufacturing defects.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Granule Loss
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Asphalt shingles are coated with ceramic granules that protect the underlying
            asphalt from UV radiation. When a hailstone strikes, it displaces these granules
            in a circular pattern around the impact point. The exposed area is darker than the
            surrounding shingle because you&apos;re seeing the raw asphalt mat. Inspectors look
            for random, circular areas of granule loss — not linear streaks (which indicate
            rain wash) or uniform fading (which indicates age).
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Mat Exposure &amp; Fracture
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Beneath the granule layer, asphalt shingles have a fiberglass mat that provides
            structural integrity. When hail impact is severe enough to crack or fracture this
            mat, the shingle&apos;s waterproofing is compromised — even if the shingle still
            looks intact from a distance. Inspectors use their fingertip to press on suspected
            impact areas. Hail-damaged spots feel noticeably softer or spongier than the
            surrounding material because the mat underneath has been fractured by the force
            of impact.
          </p>

          <h3 className="text-lg font-bold text-[var(--white)] mt-8 mb-3">
            Bruising (Impact Marks Without Visible Granule Loss)
          </h3>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Some hail impacts are strong enough to fracture the mat and compress the shingle
            but don&apos;t displace enough granules to create a visible mark. These are called
            &ldquo;bruises&rdquo; — and they&apos;re the most commonly missed form of hail damage.
            An inspector identifies bruising by touch: running their hand across the shingle
            surface to find soft spots that shouldn&apos;t be there. A properly trained inspector
            can detect bruising that has zero visual signature from even a few feet away.
          </p>

          {/* Section: Soft Metals as Tell-Tales */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="soft-metals">
            Soft Metals: The Ground-Level Evidence You Can Check Yourself
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            You don&apos;t have to take your contractor&apos;s word for it entirely. Soft metals
            around your property act as &ldquo;tell-tale&rdquo; indicators that confirm whether
            hail actually hit your specific address. Unlike shingles, soft metal damage is visible
            from ground level:
          </p>
          <div className="space-y-3 mb-6">
            {[
              { item: "Aluminum gutters & downspouts", detail: "Check for small circular dents along the top edge and face of your gutters. Downspout elbows show impacts clearly because of their angled surface." },
              { item: "AC condenser unit", detail: "The thin aluminum fins on your outdoor AC unit dent easily. If you see rows of tiny dimples across the top and storm-facing side, hail hit your property." },
              { item: "Mailbox top", detail: "Aluminum or painted steel mailbox tops are one of the most reliable tell-tales. Circular dents on the top surface confirm hail size and presence." },
              { item: "Garage door panels", detail: "Aluminum and thin steel garage doors show hail dimples that catch light at certain angles. Check from the side, not straight on." },
              { item: "Painted wood surfaces", detail: "Deck railings, fence posts, and window sills show splatter marks — circular impact craters in the paint layer where hailstones struck." },
            ].map((item, i) => (
              <div key={i} className="glass-card p-4">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] font-bold text-sm mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--white)] mb-1">{item.item}</p>
                    <p className="text-sm text-[var(--gray-muted)] leading-relaxed">{item.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            If you find dents on soft metals at your property, that&apos;s objective evidence
            that hailstones large enough to cause damage struck your address. It doesn&apos;t
            guarantee roof damage, but it confirms the storm event was real and impactful at
            your specific location.
          </p>

          {/* Photo Gallery */}
          <LearnPhotoGallery
            damageType="hail"
            limit={4}
            heading="What Hail Damage Actually Looks Like Up Close"
          />

          {/* Section: Verifying Your Contractor Is Legitimate */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="verify-contractor">
            How to Verify Your Contractor Is Legitimate
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Healthy skepticism is smart. The roofing industry, unfortunately, attracts storm
            chasers — unlicensed operators who follow severe weather events and knock on doors
            in affected neighborhoods. Before accepting any contractor&apos;s damage assessment,
            verify their credentials:
          </p>
          <div className="space-y-3 mb-6">
            {[
              "Confirm active state contractor license — search your state's licensing board database online",
              "Verify general liability insurance and workers' compensation coverage with current certificates",
              "Check for a permanent local business address — not just a P.O. box or out-of-state phone number",
              "Look up their record on the BBB, Google Business Profile, and your state attorney general's complaint database",
              "Ask for references from insurance claim work completed in your area within the past 12 months",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--cyan)] font-bold mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>

          {/* Section: Red Flags vs Green Flags */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="red-flags-green-flags">
            Red Flags vs. Green Flags: What to Watch For
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-6">
            Not every door-knock contractor is a scammer, and not every polished presentation
            means you can trust them. Here are the behaviors that separate legitimate
            professionals from operators you should avoid:
          </p>

          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="glass-card p-5">
              <h3 className="text-sm font-bold text-[var(--red)] mb-3 uppercase tracking-wider">Red Flags</h3>
              <div className="space-y-2">
                {[
                  "Pressures you to sign a contract on the spot before the adjuster arrives",
                  "Refuses to show you close-up photos of the damage they found",
                  "Asks for a large upfront payment or your insurance check signed over to them",
                  "Cannot produce a state contractor license or proof of insurance",
                  "Offers to \"waive your deductible\" — this is insurance fraud",
                  "Uses scare tactics like \"your roof could collapse\" or \"you'll lose coverage\"",
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-[var(--gray-muted)]">
                    <span className="text-[var(--red)] shrink-0 mt-0.5">&#x2715;</span>
                    <p className="leading-relaxed">{item}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-card p-5">
              <h3 className="text-sm font-bold text-[var(--cyan)] mb-3 uppercase tracking-wider">Green Flags</h3>
              <div className="space-y-2">
                {[
                  "Shows you detailed photos from the roof with explanations of each damage type",
                  "Encourages you to get a second opinion or have a HAAG inspector verify",
                  "Explains the insurance process without pressuring a timeline",
                  "Provides license number, insurance certificate, and local references upfront",
                  "Offers a free inspection with no obligation to hire them",
                  "Can explain the difference between hail damage and normal wear",
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-[var(--gray-muted)]">
                    <span className="text-[var(--cyan)] shrink-0 mt-0.5">&#x2713;</span>
                    <p className="leading-relaxed">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section: HAAG Certification */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="haag-certification">
            What a HAAG-Certified Inspection Proves
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            HAAG Engineering is the gold standard in forensic roof assessment. A HAAG-certified
            inspector has completed rigorous training in identifying and documenting storm damage
            across every major roofing material. When an insurance carrier receives a report from
            a HAAG-certified professional, it carries significantly more weight than a standard
            contractor assessment.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A HAAG inspection proves (or disproves) hail damage through a systematic methodology:
          </p>
          <div className="space-y-3 mb-6">
            {[
              { step: "Test square analysis", detail: "The inspector selects multiple 10x10-foot areas across the roof and counts confirmed hail impacts in each square. Eight or more hits per test square typically qualifies for full replacement." },
              { step: "Collateral damage assessment", detail: "The inspector documents damage to soft metals, vents, and accessories on the roof to corroborate the hail event independently of the shingle damage itself." },
              { step: "Damage differentiation", detail: "HAAG training specifically addresses how to distinguish hail damage from blistering, foot traffic, manufacturing defects, and normal weathering — the exact objections carriers raise to deny claims." },
              { step: "Forensic documentation", detail: "Photos are annotated with measurements, damage descriptions, and material identification. The report follows a format insurance carriers recognize and cannot easily dismiss." },
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
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            If your contractor is telling the truth about hail damage, a HAAG inspection will
            confirm it. If they&apos;re exaggerating or fabricating damage, the HAAG report will
            reveal that too. Either way, you get an objective answer.
          </p>

          {/* Section: Your Right to a Second Opinion */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="second-opinion">
            Your Right to a Second Opinion
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            You are never obligated to accept a single contractor&apos;s assessment. Under every
            state&apos;s insurance regulations, you have the right to obtain independent
            evaluations of property damage. Here are your options:
          </p>
          <div className="space-y-3 mb-6">
            {[
              { option: "Hire an independent HAAG-certified inspector", detail: "Expect to pay $200-$500 for a forensic inspection. This is the highest level of credibility. The cost is worthwhile if you're uncertain about a contractor's assessment on a claim that could be worth $10,000 to $30,000." },
              { option: "Get estimates from multiple licensed contractors", detail: "Three opinions is a reasonable standard. If all three identify similar damage patterns in similar locations, you can be confident the damage is real." },
              { option: "Wait for the insurance adjuster", detail: "When you file a claim, your insurance company sends their own adjuster. This is another independent set of eyes — though be aware that carrier adjusters are incentivized to minimize scope." },
              { option: "Use AI-powered independent analysis", detail: "Tools like dumbroof.ai analyze roof inspection photos using AI trained on thousands of hail claims. Upload photos and receive an independent damage assessment that isn't tied to any contractor's financial interest." },
            ].map((item, i) => (
              <div key={i} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--red)] font-mono font-bold text-sm">{String(i + 1).padStart(2, "0")}</span>
                  <h4 className="text-[var(--white)] font-semibold text-sm">{item.option}</h4>
                </div>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed ml-9">{item.detail}</p>
              </div>
            ))}
          </div>

          {/* Section: dumbroof.ai Independent Analysis */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4" id="ai-analysis">
            How dumbroof.ai Provides Independent AI Analysis
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Whether you&apos;re a homeowner trying to verify a contractor&apos;s claim or a
            contractor trying to prove to a skeptical homeowner that the damage is real,
            dumbroof.ai removes the guesswork. The platform analyzes roof inspection photos
            using AI trained on thousands of processed insurance claims.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Here&apos;s how it works: upload your inspection photos — close-ups of suspected
            damage, wide shots of the roof field, soft metal evidence, and any other documentation.
            In under 15 minutes, the AI generates a complete forensic claim package including:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "A forensic causation report with annotated photos that clearly identify each damage type",
              "An Xactimate-style estimate with line items, building code citations, and accurate pricing",
              "A carrier comparison that maps your claim against known carrier response patterns",
              "A supplement letter pre-built to address the specific objections your carrier is likely to raise",
              "A professional cover email ready to send to the adjuster with all documentation attached",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-[var(--gray)]">
                <span className="text-[var(--cyan)] shrink-0 mt-0.5">&#x2713;</span>
                <p className="leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The AI analysis is independent — it has no financial incentive to find damage or to
            minimize it. It evaluates what the photos show based on engineering standards, not on
            what any contractor or carrier wants the outcome to be. For homeowners, this means
            peace of mind. For honest contractors, it means credible third-party validation that
            builds trust with skeptical homeowners.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai has processed over <strong className="text-[var(--white)]">$12.5 million in claims</strong> with{" "}
            <strong className="text-[var(--white)]">$2.6 million in approved supplements</strong> — evidence that the
            AI-generated documentation holds up when carriers scrutinize it.
          </p>

          {/* FAQ Section */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-6" id="faq">
            Frequently Asked Questions
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
              Not Sure If the Damage Is Real? Get an Independent AI Analysis.
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 max-w-lg mx-auto">
              Upload inspection photos to dumbroof.ai and get forensic-grade documentation
              in under 15 minutes. No contractor bias. No carrier bias. Just what the photos show.
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
