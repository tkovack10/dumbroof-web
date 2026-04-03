import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Learn — Roofing Insurance Claims & AI Technology",
  description:
    "Expert guides on roofing insurance claims, supplement strategies, hail damage identification, wind damage documentation, and AI-powered claim technology. Free educational resources from dumbroof.ai.",
  keywords: [
    "roofing insurance claims guide",
    "hail damage identification",
    "wind damage roof",
    "roofing supplement guide",
    "AI roofing technology",
    "insurance denied roof claim",
    "insurance didn't pay enough for roof",
    "hail damage asphalt shingles",
    "hail damage metal roof",
    "how to file roof insurance claim",
    "assignment of benefits roofing",
    "adjuster missed damage",
  ],
};

const articles = [
  {
    slug: "what-is-hail-damage",
    title: "What Is Hail Damage? Identification, Insurance Claims & Documentation Guide",
    excerpt: "Hail damage is physical deterioration caused by frozen precipitation striking roofing materials at high velocity. Learn to identify it across all roof types and document it for insurance claims.",
    category: "Damage Identification",
  },
  {
    slug: "what-is-wind-damage",
    title: "What Is Wind Damage? How to Identify, Document & File Insurance Claims",
    excerpt: "Wind damage to roofing occurs when sustained or gusting winds exceed the material's uplift resistance rating. Learn the key differences from hail damage and how to document for carriers.",
    category: "Damage Identification",
  },
  {
    slug: "hail-damage-to-slate-roofs",
    title: "Hail Damage to Slate Roofs: Identification, Repair & Insurance Claims",
    excerpt: "Slate roofs react to hail differently than asphalt — fractures are often linear rather than circular. Learn how to identify slate hail damage and navigate the unique insurance challenges.",
    category: "Material-Specific",
  },
  {
    slug: "hail-damage-to-tpo-roofing",
    title: "Hail Damage to TPO Roofing: Identification Signs & Commercial Claim Guide",
    excerpt: "TPO membrane hail damage shows as concentric circular fractures or star-shaped cracks in the top ply. Learn how to document and supplement commercial TPO claims.",
    category: "Material-Specific",
  },
  {
    slug: "hail-damage-to-epdm-roofing",
    title: "Hail Damage to EPDM Roofing: Detection, Documentation & Insurance Claims",
    excerpt: "EPDM rubber roofing absorbs hail impact differently — damage often hides beneath the membrane as crushed insulation. Learn detection methods and commercial claim strategies.",
    category: "Material-Specific",
  },
  {
    slug: "how-to-automate-insurance-invoicing",
    title: "How to Automate Insurance Invoicing for Roofing Contractors",
    excerpt: "Insurance invoicing is one of the most time-consuming tasks in roofing restoration. Learn how to automate it using CRM integrations, QuickBooks syncing, and AI-powered documentation.",
    category: "Business Operations",
  },
  {
    slug: "insurance-denied-my-roof-claim",
    title: "My Insurance Company Denied My Roof Claim — Now What?",
    excerpt: "A denied roof claim doesn't mean the fight is over. Learn exactly how to respond, what documentation to gather, and how to reopen your claim with evidence the carrier can't ignore.",
    category: "Insurance Claims",
  },
  {
    slug: "insurance-didnt-pay-enough-for-roof",
    title: "Insurance Didn't Pay Enough to Replace My Roof — What To Do",
    excerpt: "If your insurance payout doesn't cover the actual cost of replacing your roof, you're not stuck. Learn about supplements, missing line items, code upgrades, and how to recover what you're owed.",
    category: "Insurance Claims",
  },
  {
    slug: "contractor-says-hail-damage-but-i-dont-see-it",
    title: "My Contractor Says I Have Hail Damage But I Don't See It",
    excerpt: "Hail damage is nearly invisible from the ground. Learn what trained inspectors look for up close, how to verify your contractor's claims, and what independent analysis can confirm.",
    category: "Homeowner Guide",
  },
  {
    slug: "hail-damage-to-asphalt-shingles",
    title: "What Does Hail Damage Look Like on Asphalt Shingles?",
    excerpt: "Asphalt shingles are the most common roofing material in America — and the most frequently damaged by hail. Learn to identify granule loss, bruising, and mat exposure with real claim photos.",
    category: "Material-Specific",
  },
  {
    slug: "hail-damage-to-metal-roofing",
    title: "Hail Damage to Metal Roofing: Identification & Insurance Claims",
    excerpt: "Metal roof hail claims get denied more than any other material type. Learn the functional vs cosmetic damage debate, how to document dents properly, and how to win your claim.",
    category: "Material-Specific",
  },
  {
    slug: "how-to-file-roof-insurance-claim",
    title: "How to File a Roof Insurance Claim After a Storm (Step-by-Step)",
    excerpt: "The complete step-by-step guide to filing a roof insurance claim — from documenting damage to meeting the adjuster to collecting your check. What to do and what NOT to do.",
    category: "Insurance Claims",
  },
  {
    slug: "what-is-a-roofing-supplement",
    title: "What Is a Roofing Supplement and Why Do I Need One?",
    excerpt: "The first insurance estimate is almost always too low. A roofing supplement is how you recover the difference. Learn what it is, what gets missed, and how to file one successfully.",
    category: "Insurance Claims",
  },
  {
    slug: "adjuster-missed-damage-on-my-roof",
    title: "Insurance Adjuster Missed Damage on My Roof — What Now?",
    excerpt: "Insurance adjusters are under pressure to close claims fast — and they miss things. Learn what commonly gets overlooked, how to request a re-inspection, and how to document what they missed.",
    category: "Insurance Claims",
  },
  {
    slug: "how-long-to-file-roof-insurance-claim",
    title: "How Long Do I Have to File a Roof Insurance Claim?",
    excerpt: "Filing deadlines vary by state and carrier — miss yours and you lose your right to claim. Learn the timelines, exceptions, and how to protect yourself from deadline-related denials.",
    category: "Insurance Claims",
  },
  {
    slug: "what-is-aob-assignment-of-benefits-roofing",
    title: "What Is an AOB (Assignment of Benefits) for Roofing?",
    excerpt: "An Assignment of Benefits lets your contractor deal with the insurance company directly. Learn how AOBs work, the pros and cons, state laws, and how digital signatures streamline the process.",
    category: "Business Operations",
  },
];

export default function LearnIndex() {
  return (
    <main className="min-h-screen">
      <section className="pt-16 pb-10 px-6 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--white)] mb-4">
          Learn
        </h1>
        <p className="text-[var(--gray-muted)] max-w-xl mx-auto text-lg">
          Expert guides on roofing insurance claims, damage identification,
          building codes, and AI technology.
        </p>
      </section>

      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {articles.map((a) => (
            <a
              key={a.slug}
              href={`/learn/${a.slug}`}
              className="block glass-card p-6 hover:border-white/30 transition-colors group"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                {a.category}
              </span>
              <h2 className="text-lg font-bold text-[var(--white)] mt-1 group-hover:text-[var(--cyan)] transition-colors">
                {a.title}
              </h2>
              <p className="text-sm text-[var(--gray-muted)] mt-2 leading-relaxed">
                {a.excerpt}
              </p>
            </a>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="pb-20 px-6 text-center">
        <div className="glass-card max-w-2xl mx-auto p-10">
          <h2 className="text-2xl font-bold text-[var(--white)] mb-3">
            Stop Guessing. Start Proving.
          </h2>
          <p className="text-[var(--gray-muted)] mb-6">
            Upload your photos and measurements. Get 5 forensic-grade documents in 15 minutes.
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

      <Footer />
    </main>
  );
}
