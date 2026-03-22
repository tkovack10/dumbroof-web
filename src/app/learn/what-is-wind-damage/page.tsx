import type { Metadata } from "next";
import { LearnPhotoGallery } from "@/components/learn-photo-gallery";

export const metadata: Metadata = {
  title: "What Is Wind Damage? How to Identify, Document & File Insurance Claims",
  description:
    "Wind damage to roofing occurs when sustained or gusting winds exceed the material's uplift resistance rating. Learn the key differences from hail damage, documentation methods, and how to file insurance claims with dumbroof.ai.",
  keywords: [
    "wind damage roof",
    "identify wind damage",
    "wind damage insurance claim",
    "wind damage vs hail",
    "roof wind damage documentation",
    "homeowners insurance wind coverage",
    "ASTM D3161 wind resistance",
  ],
  openGraph: {
    type: "article",
    title: "What Is Wind Damage? How to Identify, Document & File Insurance Claims",
    description:
      "Wind damage to roofing occurs when sustained or gusting winds exceed the material's uplift resistance rating. Learn the key differences from hail damage, documentation methods, and how to file insurance claims.",
  },
};

const FAQSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What does wind damage look like on a roof?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Wind damage typically appears as missing, creased, lifted, or sliding shingles concentrated on edges, ridges, and the windward-facing side of the roof. Unlike hail damage, which shows random patterns, wind damage follows a directional pattern matching the wind direction.",
      },
    },
    {
      "@type": "Question",
      name: "How is wind damage different from hail damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Wind damage follows a directional pattern aligned with wind direction and typically shows lifted or missing shingles, while hail damage appears as random circular impact marks across all roof exposures. Wind lifts shingle tabs by breaking the sealant bond, whereas hail creates localized strikes.",
      },
    },
    {
      "@type": "Question",
      name: "Does homeowners insurance cover wind damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, wind damage is generally covered under the dwelling protection component of homeowners insurance policies. However, many carriers apply separate wind or hail deductibles (particularly in high-risk states like Florida and Texas), which may be significantly higher than standard deductibles.",
      },
    },
    {
      "@type": "Question",
      name: "What wind speed causes roof damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Most 3-tab asphalt shingles begin showing damage at 60-70 mph sustained winds. Architectural shingles are rated for 110-130 mph. The threshold depends on the specific shingle grade, installation quality, and exposure direction. Testing standards like ASTM D3161 and D7158 establish these resistance ratings.",
      },
    },
    {
      "@type": "Question",
      name: "How does dumbroof.ai help with wind damage claims?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "dumbroof.ai uses AI-powered forensic documentation to capture wind damage patterns, measure damage concentration on windward exposures, correlate weather data to damage timeline, and generate proof-grade documentation that carriers accept without denial disputes.",
      },
    },
  ],
};

const ArticleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "What Is Wind Damage? How to Identify, Document & File Insurance Claims",
  description:
    "Wind damage to roofing occurs when sustained or gusting winds exceed the material's uplift resistance rating. Learn the key differences from hail damage, documentation methods, and how to file insurance claims.",
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

export default function WindDamagePage() {
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
            <span className="text-white">Wind Damage</span>
          </div>
        </div>
      </section>

      {/* Header */}
      <section className="px-6 pt-12 pb-8">
        <div className="max-w-4xl mx-auto">
          <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-[var(--red)] mb-3">
            Damage Identification
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-[var(--white)] mb-6 leading-tight">
            What Is Wind Damage? How to Identify, Document & File Insurance Claims
          </h1>

          {/* Direct Answer */}
          <div className="glass-card p-6 mb-10">
            <p className="text-lg text-[var(--gray-muted)] leading-relaxed">
              Wind damage occurs when sustained or gusting winds exceed a roofing material's uplift resistance rating, causing shingles to lift, crease, slide, or detach entirely. Unlike hail damage, which appears as random impacts, wind damage follows a directional pattern aligned with the wind direction and is concentrated on edges, ridges, and windward-facing surfaces.
            </p>
          </div>
        </div>
      </section>

      {/* Photo Gallery */}
      <section className="px-6 pb-12">
        <div className="max-w-4xl mx-auto">
          <LearnPhotoGallery
            damageType="wind"
            limit={6}
            heading="Real Wind Damage Examples"
          />
        </div>
      </section>

      {/* Content */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto space-y-12">
          {/* Section 1 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              What does wind damage look like on a roof?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Wind damage typically appears as missing, creased, lifted, or sliding shingles concentrated on edges, ridges, and the windward-facing side of the roof. You may see curled shingle tabs, exposed sealant strips where tabs have lifted, or complete shingle loss in specific zones. The damage pattern follows the direction the wind came from, creating a predictable geometry that differs fundamentally from random hail impacts.
            </p>
          </div>

          {/* Section 2 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How is wind damage different from hail damage?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Wind damage and hail damage are visually and mechanically distinct. Hail creates random circular impact marks scattered across all roof exposures regardless of wind direction. Wind damage shows a directional pattern aligned with prevailing wind, concentrated on windward faces and roof edges. The mechanism differs too: wind lifts shingle tabs by breaking the sealant bond strip connecting adjacent shingles, while hail strikes create localized crushing or punctures. Insurance carriers evaluate these damage patterns differently because the underlying cause determines whether the homeowner's policy covers the loss.
            </p>
          </div>

          {/* Stat block 1 */}
          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Key Statistic
            </div>
            <p className="text-xl text-[var(--white)] font-bold">
              60-70 mph is the uplift threshold for most 3-tab asphalt shingles; architectural shingles are rated to 110-130 mph depending on the product grade.
            </p>
          </div>

          {/* Section 3 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              What causes wind damage to roofs?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Wind damage is caused by sustained or gusting winds that exceed the uplift resistance rating of installed roofing materials. Each shingle product is tested per ASTM D3161 (wind uplift) or ASTM D7158 (increased wind resistance) standards, which simulate laboratory wind conditions to establish uplift values. Factors affecting real-world susceptibility include roof pitch (steeper roofs experience greater wind uplift), exposure location (hilltops and coastal areas see higher wind speeds), previous damage or poor installation (compromised sealant bonds fail at lower wind speeds), and age-related degradation (older shingles lose flexibility and sealant integrity).
            </p>
          </div>

          {/* Section 4 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How does wind damage affect the sealant bond on shingles?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Modern asphalt shingles contain a factory-applied adhesive strip (sealant bond) that thermally activates in heat to bond adjacent shingle tabs together and resist uplift. Wind force attempts to peel these tabs upward; if the wind speed exceeds the bond's rated strength, the sealant fails and tabs lift, curl, or tear away. This lifted position exposes the sealant strip itself to UV degradation and water intrusion, accelerating further shingle deterioration. Once tabs lift, subsequent wind events (even at lower speeds) more easily detach compromised shingles.
            </p>
          </div>

          {/* Stat block 2 */}
          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Documentation Insight
            </div>
            <p className="text-xl text-[var(--white)] font-bold">
              Wind damage claims require directional correlation: comparing damage location and pattern to documented wind direction during the loss event strengthens carrier approval and reduces denial disputes.
            </p>
          </div>

          {/* Section 5 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              Does homeowners insurance cover wind damage?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Yes, wind damage is generally covered under the "dwelling protection" component of homeowners insurance policies. However, many carriers apply separate wind or hail deductibles in high-risk states like Florida, Texas, Louisiana, and other coastal or tornado-prone regions. These deductibles may be significantly higher than standard deductibles (e.g., 2%, 5%, or 10% of dwelling coverage vs. a standard $500-$1,000 flat deductible). Some carriers exclude or limit wind coverage in certain high-risk areas, making it essential to review your policy details and contact your carrier directly to confirm coverage terms before filing a claim.
            </p>
          </div>

          {/* Section 6 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How do insurance carriers deny wind damage claims?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Common carrier denial tactics for wind damage include: (1) claiming the damage is "wear and tear" or "maintenance issue" rather than a covered wind event, (2) arguing that lifted shingles are due to installation defect rather than wind uplift, (3) disputing the wind speed during the loss event by referencing weather data from distant weather stations, and (4) citing missing documentation that correlates damage location to wind direction. Stronger documentation—combining photographic evidence, weather forensics, and directional analysis—reduces the likelihood of denial and forces carriers to provide valid coverage decisions.
            </p>
          </div>

          {/* Stat block 3 */}
          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Carrier Behavior
            </div>
            <p className="text-xl text-[var(--white)] font-bold">
              Carriers deny approximately 1 in 4 wind damage claims initially, with "wear and tear" being the most frequent denial reason—despite wind being an explicitly covered peril.
            </p>
          </div>

          {/* Section 7 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How do you document wind damage for an insurance claim?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              Effective wind damage documentation requires five key elements: (1) photograph damage from multiple angles showing lifted/missing shingles on the windward face and ridge areas; (2) measure wind direction from verified weather data (NOAA, Weather Underground, nearby weather stations) during the loss event; (3) plot damage concentration on roof diagrams to show directional pattern alignment; (4) record damage location relative to roof pitch, edges, and penetrations to establish geometric vulnerability; and (5) document date/time of loss event to establish causation timeline. dumbroof.ai automates this forensic process, capturing all these elements and generating carrier-grade documentation in minutes.
            </p>
          </div>

          {/* Section 8 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              What are ASTM D3161 and ASTM D7158 wind resistance standards?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              ASTM D3161 and ASTM D7158 are standardized test methods that measure asphalt shingle uplift resistance in laboratory conditions. D3161 is the original uplift test where shingles are mounted on a test specimen and subjected to increasing negative pressure until failure. D7158 is the newer "increased wind resistance" (IWR) protocol that simulates more realistic roof conditions including corner and edge stress concentrations. Shingles rated to these standards display uplift values in pounds per square foot (psf). These ratings inform insurance carrier coverage decisions and help identify products more resistant to wind damage. Most modern architectural shingles meet or exceed D7158 standards; older 3-tab shingles may only meet older D3161 ratings.
            </p>
          </div>

          {/* Stat block 4 */}
          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Product Rating Comparison
            </div>
            <p className="text-xl text-[var(--white)] font-bold">
              Standard 3-tab shingles: 60-70 mph uplift rating. Architectural/premium shingles: 110-130 mph uplift rating. Metal roofing: 150+ mph rating.
            </p>
          </div>

          {/* Section 9 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              Do wind and hail deductibles apply separately in all states?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              No. Separate wind and hail deductibles are mandatory in Florida, Texas, Louisiana, and some coastal states, but optional in other regions. In states without wind deductible mandates, carriers may apply standard deductibles. However, some carriers voluntarily offer wind deductible options even in states where not required. This variation makes it critical to review your specific policy documents or contact your carrier to confirm whether your wind damage claim is subject to a higher wind deductible rather than your standard flat deductible. For claims spanning multiple damage types (e.g., wind AND hail), some carriers apply both deductibles; others apply only the highest.
            </p>
          </div>

          {/* Section 10 */}
          <div>
            <h2 className="text-2xl font-bold text-[var(--white)] mb-4">
              How does dumbroof.ai help with wind damage claims?
            </h2>
            <p className="text-[var(--gray-muted)] mb-6 leading-relaxed">
              dumbroof.ai automates forensic-grade wind damage documentation by processing photos, measuring damage concentration, correlating weather data to loss timeline, and generating proof-grade reports that carriers accept without dispute. The AI identifies wind-specific patterns (directional lift, edge concentration), maps damage to roof diagrams, and cross-references weather records to validate wind speed claims. This eliminates common carrier denials rooted in insufficient documentation, reduces back-and-forth correspondence, and accelerates claim approval. Contractors and homeowners use dumbroof.ai to document wind damage within 15 minutes—turning photos into insurance-ready evidence before carriers have reason to deny.
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
                  href="/pricing"
                  className="text-[var(--cyan)] hover:underline text-sm"
                >
                  dumbroof.ai Pricing & Plan Comparison
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
            Upload your wind damage photos and measurements. Get 5 forensic-grade documents in 15 minutes—ready to send to your insurance carrier.
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
