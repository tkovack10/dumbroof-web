import type { Metadata } from "next";

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

      {/* Footer */}
      <footer className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-t border-white/10 py-8 px-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-sm">DR</div>
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
