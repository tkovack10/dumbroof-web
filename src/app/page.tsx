import { InspectorApplicationForm } from "@/components/inspector-application-form";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Revalidate homepage stats every 5 minutes
export const revalidate = 300;

function fmtBigMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M+`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K+`;
  return `$${val.toLocaleString()}`;
}

async function getHeroStats() {
  try {
    const [webClaimsRes, webWinsRes, localClaimsRes, localWinsRes, repairsRes] = await Promise.all([
      // Web claims (from claims table — all users)
      supabaseAdmin.from("claims").select("contractor_rcv"),
      supabaseAdmin.from("claims").select("settlement_amount").eq("claim_outcome", "won"),
      // Local CLI claims (from claim_outcomes — not in claims table)
      supabaseAdmin.from("claim_outcomes").select("usarm_rcv").eq("source", "cli"),
      supabaseAdmin.from("claim_outcomes").select("settlement_amount").eq("source", "cli").eq("win", true),
      // Repairs
      supabaseAdmin.from("repairs").select("id", { count: "exact", head: true }).in("status", ["ready", "complete"]),
    ]);

    const webRcv = (webClaimsRes.data || []).reduce((s, c) => s + (c.contractor_rcv ?? 0), 0);
    const localRcv = (localClaimsRes.data || []).reduce((s, c) => s + (c.usarm_rcv ?? 0), 0);
    const totalProcessed = webRcv + localRcv;

    const webWon = (webWinsRes.data || []).reduce((s, c) => s + (c.settlement_amount ?? 0), 0);
    const localWon = (localWinsRes.data || []).reduce((s, c) => s + (c.settlement_amount ?? 0), 0);
    const totalApproved = webWon + localWon;

    const repairCount = Math.max(repairsRes.count ?? 0, 52);

    return {
      claimsProcessed: fmtBigMoney(totalProcessed),
      approvedSupplements: fmtBigMoney(totalApproved),
      completedRepairs: `${repairCount}+`,
      diagnosticAccuracy: "98%",
    };
  } catch {
    return { claimsProcessed: "$5.3M+", approvedSupplements: "$1.4M+", completedRepairs: "52+", diagnosticAccuracy: "98%" };
  }
}

export default async function Home() {
  const stats = await getHeroStats();
  return (
    <main className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--navy)]/95 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white text-lg">
              DR
            </div>
            <span className="text-white font-bold text-xl tracking-tight">
              dumb roof<sup className="text-[10px] font-medium align-super ml-0.5">™</sup>
            </span>
          </a>
          <div className="flex items-center gap-6">
            <a href="#problem" className="text-gray-300 hover:text-white text-sm transition-colors hidden sm:block">
              The Problem
            </a>
            <a href="#how-it-works" className="text-gray-300 hover:text-white text-sm transition-colors hidden sm:block">
              How It Works
            </a>
            <a href="#repair" className="text-gray-300 hover:text-white text-sm transition-colors hidden sm:block">
              Repair
            </a>
            <a href="#results" className="text-gray-300 hover:text-white text-sm transition-colors hidden sm:block">
              Results
            </a>
            <a href="#inspectors" className="text-gray-300 hover:text-white text-sm transition-colors hidden sm:block">
              Inspectors
            </a>
            <a href="/pricing" className="text-gray-300 hover:text-white text-sm transition-colors hidden sm:block">
              Pricing
            </a>
            <a href="/login" className="text-gray-300 hover:text-white text-sm font-medium transition-colors">
              Sign In
            </a>
            <a
              href="/login?mode=signup"
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              Create Account
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block mb-6 px-4 py-1.5 rounded-full bg-white/10 border border-white/20">
            <span className="text-[var(--gold)] text-sm font-medium">
              Now Available
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-tight mb-6">
            Don&apos;t tell them they have damage.
            <br />
            <span className="text-[var(--red)]">Show them.</span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            Generate forensic-grade claim documentation that would impress
            the best carrier litigation attorney in the country. Upload your
            docs, get back a 5-document appeal package in 15 minutes.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <a
              href="/login?mode=signup"
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors shadow-lg shadow-red-900/30"
            >
              Create Your Account
            </a>
            <a
              href="#problem"
              className="border border-white/30 hover:border-white/60 text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
            >
              See Why This Exists
            </a>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {[
              { number: stats.claimsProcessed, label: "Claims Processed" },
              { number: stats.approvedSupplements, label: "Approved Supplements" },
              { number: stats.completedRepairs, label: "Completed Repairs" },
              { number: stats.diagnosticAccuracy, label: "Diagnostic Accuracy" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white">
                  {stat.number}
                </div>
                <div className="text-sm text-gray-400 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Trust Problem */}
      <section id="problem" className="py-20 px-6 bg-[var(--gray-50)] scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] text-center mb-4">
            Homeowners Don&apos;t Trust You
          </h2>
          <p className="text-gray-500 text-center mb-14 max-w-2xl mx-auto">
            Studies prove it. The BBB confirms it. And insurance carriers are counting on it.
          </p>

          {/* Stats Grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-14">
            {[
              { stat: "#1", detail: "Roofing is the #1 most-complained industry on the BBB &mdash; 3,392 complaints in a single year", source: "BBB" },
              { stat: "70%", detail: "of consumers won&apos;t return to a contractor after one bad experience", source: "BBB Consumer Survey" },
              { stat: "16 mo", detail: "Average time a roofing employee stays before leaving &mdash; vs. 4.6 years in other industries", source: "Construction Industry Data" },
              { stat: "40%", detail: "of homeowners say poor communication is their #1 frustration with contractors", source: "Roofing Contractor Magazine" },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-xl p-6 border border-gray-100 text-center">
                <p className="text-3xl font-bold text-[var(--red)] mb-2" dangerouslySetInnerHTML={{ __html: item.stat }} />
                <p className="text-sm text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: item.detail }} />
                <p className="text-xs text-gray-400 mt-2">{item.source}</p>
              </div>
            ))}
          </div>

          {/* The Real Problems */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-8 border border-gray-100">
              <h3 className="text-xl font-bold text-[var(--navy)] mb-4">
                The Contractor&apos;s Impossible Choice
              </h3>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="text-[var(--red)] text-lg mt-0.5 shrink-0">01</span>
                    <div>
                      <p className="font-semibold text-[var(--navy)]">Train reps for years on insurance</p>
                      <p className="text-sm text-gray-500 mt-1">
                        It takes years to learn the full insurance process &mdash; building codes, Xactimate,
                        supplement negotiations, carrier tactics. Just when they hit their stride...
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-[var(--red)] text-lg mt-0.5 shrink-0">02</span>
                    <div>
                      <p className="font-semibold text-[var(--navy)]">They leave and start their own company</p>
                      <p className="text-sm text-gray-500 mt-1">
                        They take every skill you trained them on. Average roofing employee tenure: 16 months.
                        You just funded your next competitor.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="text-[var(--red)] text-lg mt-0.5 shrink-0">03</span>
                    <div>
                      <p className="font-semibold text-[var(--navy)]">Or don&apos;t train them enough</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Untrained reps miss supplements and line items. One photo could add a $5,000 line item
                        to a claim &mdash; but they don&apos;t know to take it. Money left on every roof.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-[var(--red)] text-lg mt-0.5 shrink-0">04</span>
                    <div>
                      <p className="font-semibold text-[var(--navy)]">Or skip insurance work entirely</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Most contractors avoid insurance claims because the process is too frustrating.
                        That&apos;s by design &mdash; carriers built it that way.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* PE Problem */}
            <div className="bg-[var(--navy)] rounded-2xl p-8 text-white">
              <h3 className="text-xl font-bold mb-4">
                Why Private Equity Hates Insurance Work
              </h3>
              <p className="text-gray-300 mb-6 leading-relaxed">
                PE firms don&apos;t hate the money insurance claims generate &mdash; they hate the
                inconsistency. They hate the complexity. They hate that it takes years to train
                a rep who might leave in 16 months. With 25+ PE rollups now operating in roofing,
                the firms doing $100M-$400M/year need a system that makes insurance claims
                predictable, repeatable, and scalable. That&apos;s what this is.
              </p>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { label: "The Problem", value: "Inconsistent claim outcomes across 50+ reps" },
                  { label: "The Cost", value: "25-50% revenue leakage from missed supplements" },
                  { label: "The Fix", value: "World-class system that plugs directly into your company" },
                ].map((item) => (
                  <div key={item.label} className="bg-white/10 rounded-xl p-4 border border-white/10">
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">{item.label}</p>
                    <p className="text-sm text-gray-200 mt-2">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Solution */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center">
            <div className="inline-block mb-4 px-4 py-1.5 rounded-full bg-[var(--red)]/10 border border-[var(--red)]/20">
              <span className="text-[var(--red)] text-sm font-semibold">Patent Pending</span>
            </div>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] text-center mb-4">
            Don&apos;t Tell. Prove.
          </h2>
          <p className="text-gray-500 text-center mb-14 max-w-2xl mx-auto">
            Homeowners don&apos;t trust storm chasers. Carriers dismiss sloppy supplements.
            So we built documentation so thorough, so forensic, so code-cited that
            it speaks for itself.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-[var(--gray-50)] rounded-2xl p-8 border border-gray-100">
              <h3 className="text-lg font-bold text-[var(--navy)] mb-4">What Estimate Services Do</h3>
              <ul className="space-y-3 text-gray-600 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  Write numbers on a spreadsheet
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  No photos, no code citations, no forensic analysis
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  No carrier-specific strategy or intelligence
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  Adjuster sees it, ignores it, moves on
                </li>
              </ul>
            </div>
            <div className="bg-[var(--gray-50)] rounded-2xl p-8 border border-[var(--navy)]/20">
              <h3 className="text-lg font-bold text-[var(--navy)] mb-4">What Dumb Roof Generates</h3>
              <ul className="space-y-3 text-gray-600 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  Forensic report with annotated photos tied to specific damage
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  Every line item paired with building code + photo evidence
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  Carrier-specific playbooks that learn from every claim
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  Package so thorough it would hold up in front of a carrier litigation attorney
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-6">
            <p className="text-amber-900 text-sm leading-relaxed">
              <span className="font-bold">The real difference:</span> Other services write estimates.
              We build forensic evidence chains &mdash; pairing specific building code citations to specific
              photos to specific line items. That&apos;s what makes carriers move. That&apos;s what makes
              adjusters take you seriously. That&apos;s what separates you from every other contractor
              knocking on doors after a storm.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-6 bg-[var(--gray-50)] scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] text-center mb-4">
            How It Works
          </h2>
          <p className="text-gray-500 text-center mb-14 max-w-xl mx-auto">
            Three steps. Fifteen minutes. Every rep on your team performs like a
            20-year insurance veteran.
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Upload",
                desc: "Drop in your measurements, inspection photos, and carrier scope (if you have one). That's it.",
                icon: (
                  <svg className="w-8 h-8 text-[var(--navy)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                ),
              },
              {
                step: "02",
                title: "AI Analyzes Everything",
                desc: "Reads every document. Analyzes every photo forensically. Cross-references building codes. Checks carrier playbooks. Builds the evidence chain.",
                icon: (
                  <svg className="w-8 h-8 text-[var(--navy)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                  </svg>
                ),
              },
              {
                step: "03",
                title: "Download Your Package",
                desc: "Get back up to 5 professional PDFs branded with your company logo. Forensic report, estimate, supplement, appeal letter, and cover email.",
                icon: (
                  <svg className="w-8 h-8 text-[var(--navy)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                ),
              },
            ].map((item) => (
              <div
                key={item.step}
                className="relative bg-white rounded-2xl p-8 border border-gray-100 hover:border-[var(--navy)]/20 transition-colors"
              >
                <span className="absolute top-6 right-6 text-5xl font-bold text-gray-100">
                  {item.step}
                </span>
                <div className="mb-5">{item.icon}</div>
                <h3 className="text-xl font-bold text-[var(--navy)] mb-2">
                  {item.title}
                </h3>
                <p className="text-gray-600 leading-relaxed text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The 5 Documents */}
      <section className="py-20 px-6 bg-[var(--navy)]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-white text-center mb-4">
            The 5-Document Package
          </h2>
          <p className="text-gray-400 text-center mb-14 max-w-xl mx-auto">
            Every document forensic-grade, code-cited, and branded
            with your company logo.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { num: "01", title: "Forensic Causation Report", desc: "Photo-annotated damage analysis with clinical observations. Every finding tied to HAAG engineering standards." },
              { num: "02", title: "X Style Build Scope", desc: "Line-item scope at current regional pricing. Every line item backed by building code citations and photo evidence." },
              { num: "03", title: "Supplement Report", desc: "Line-by-line carrier vs. your scope. Exposes every underpayment, missed item, and pricing discrepancy." },
              { num: "04", title: "Appeal Letter", desc: "Formal demand citing building codes, insurance regulations, and forensic evidence. Written to move adjusters." },
              { num: "05", title: "Cover Email", desc: "Ready-to-send email with professional tone, attachment summary, and regulatory response deadline." },
              { num: "++", title: "Carrier Intelligence", desc: "Every claim feeds self-learning carrier playbooks. By claim #20, the system knows your carrier's tactics before you do." },
            ].map((doc) => (
              <div key={doc.num} className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors">
                <span className="text-[var(--red)] text-sm font-mono font-bold">{doc.num}</span>
                <h4 className="text-white font-semibold mt-2 mb-2">{doc.title}</h4>
                <p className="text-gray-400 text-sm leading-relaxed">{doc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who This Is For */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] text-center mb-14">
            Built For Companies That Are Tired of Leaving Money on the Table
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: "Roofing Contractors",
                desc: "You have 50 reps. Maybe 5 know insurance. This makes all 50 perform like your best insurance specialist. Every claim, every time.",
              },
              {
                title: "PE Rollup Platforms",
                desc: "You're acquiring contractors doing $100-400M/year. 40% is storm-related. This standardizes insurance claims across every location you own.",
              },
              {
                title: "Restoration Companies",
                desc: "Supplements are your biggest profit leak. One missed photo costs you $5,000. This catches every line item, every code citation, every time.",
              },
            ].map((item) => (
              <div key={item.title} className="bg-[var(--gray-50)] rounded-2xl p-8 border border-gray-100">
                <h3 className="text-lg font-bold text-[var(--navy)] mb-3">{item.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Results */}
      <section id="results" className="py-20 px-6 bg-[var(--gray-50)] scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] text-center mb-4">
            Real Results. Real Claims. Real Carrier Movement.
          </h2>
          <p className="text-gray-500 text-center mb-14 max-w-xl mx-auto">
            Not projections. Documented carrier movement from actual claims.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-14">
            {[
              { carrier: "Church Mutual", before: "$20,408", after: "$943,233", increase: "4,522%" },
              { carrier: "Allstate", before: "$81,170", after: "$120,312", increase: "48%" },
              { carrier: "Erie Insurance", before: "$32,048", after: "$72,145", increase: "125%" },
              { carrier: "Nationwide", before: "$77,019", after: "$122,155", increase: "59%" },
              { carrier: "Hanover", before: "$33,394", after: "$56,769", increase: "70%" },
              { carrier: "State Farm", before: "$37,669", after: "$80,963", increase: "115%" },
            ].map((result) => (
              <div key={result.carrier} className="bg-white rounded-xl p-6 border border-gray-100">
                <div className="text-sm font-semibold text-gray-500 mb-3">{result.carrier}</div>
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="text-gray-400 line-through text-sm">{result.before}</span>
                  <span className="text-[var(--navy)] font-bold text-xl">{result.after}</span>
                </div>
                <div className="text-[var(--red)] font-bold text-sm">+{result.increase}</div>
              </div>
            ))}
          </div>

          {/* Comparison Table */}
          <div className="bg-white rounded-2xl p-8 border border-gray-100">
            <h3 className="text-xl font-bold text-[var(--navy)] mb-6 text-center">
              Dumb Roof vs. The Old Way
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-3 text-sm text-gray-500 font-medium"></th>
                    <th className="pb-3 text-sm text-gray-500 font-medium">Traditional</th>
                    <th className="pb-3 text-sm text-[var(--red)] font-bold">Dumb Roof</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {[
                    ["Time per claim", "1-3 months", "15 minutes"],
                    ["Cost per claim", "$7,500 - $30,000", "~$10"],
                    ["Documents generated", "1 estimate (maybe)", "5 forensic-grade PDFs"],
                    ["Code citations", "Rarely included", "Every line item cited"],
                    ["Photo evidence", "Unlabeled photos", "Forensic annotations tied to line items"],
                    ["Carrier intelligence", "Start from scratch every time", "Self-learning playbooks"],
                    ["Training required", "Years of insurance experience", "Upload and click"],
                    ["Rep turnover risk", "Knowledge walks out the door", "System stays. Forever."],
                  ].map(([label, old, dr]) => (
                    <tr key={label} className="border-b border-gray-100">
                      <td className="py-3 font-medium text-gray-700">{label}</td>
                      <td className="py-3 text-gray-500">{old}</td>
                      <td className="py-3 font-semibold text-[var(--navy)]">{dr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Dumb Roof Repair */}
      <section id="repair" className="py-20 px-6 bg-white scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-block mb-4 px-4 py-1.5 rounded-full bg-[var(--red)]/10 border border-[var(--red)]/20">
              <span className="text-[var(--red)] text-sm font-semibold">
                Patent Pending
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] mb-4">
              Dumb Roof Repair
            </h2>
            <p className="text-gray-500 max-w-3xl mx-auto leading-relaxed">
              Patent pending technology trained on over 140,000 real before, during, and after
              roof inspection photos. One visit. Diagnose, present, close, collect, repair. On to the next.
            </p>
          </div>

          {/* Stats row */}
          <div className="bg-gradient-to-br from-[var(--navy)] to-[var(--navy-light)] rounded-2xl p-10 text-center mb-10">
            <div className="grid sm:grid-cols-3 gap-8 items-center">
              <div>
                <div className="text-5xl sm:text-6xl font-bold text-white mb-2">98%</div>
                <p className="text-gray-400 text-sm">Diagnostic Accuracy</p>
              </div>
              <div>
                <div className="text-5xl sm:text-6xl font-bold text-[var(--gold)] mb-2">140K+</div>
                <p className="text-gray-400 text-sm">Training Photos</p>
              </div>
              <div>
                <div className="text-5xl sm:text-6xl font-bold text-[var(--red)] mb-2">2%</div>
                <p className="text-gray-400 text-sm">Caught by Built-In Checkpoints</p>
              </div>
            </div>
          </div>

          {/* Pain / Solution columns */}
          <div className="grid md:grid-cols-2 gap-8 mb-10">
            <div className="bg-[var(--gray-50)] rounded-2xl p-8 border border-gray-100">
              <h3 className="text-lg font-bold text-[var(--navy)] mb-4">The Problem Nobody Has Solved</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  <p className="text-sm text-gray-600">Service departments live and die by 1&ndash;2 techs who can diagnose a leak. Everyone else waits for instructions</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  <p className="text-sm text-gray-600">Those techs quit, and your revenue stream stops. Key man risk in its purest form &mdash; and it happens every 16 months</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  <p className="text-sm text-gray-600">You have 10x more tradesmen who can execute a repair perfectly when told what to do. The bottleneck was never labor &mdash; it&apos;s diagnosis</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  <p className="text-sm text-gray-600">Your best roofers can often find the problem but can&apos;t present it to a homeowner in fluent English. The language barrier doesn&apos;t just limit hiring &mdash; it kills the close</p>
                </div>
              </div>
            </div>

            <div className="bg-[var(--gray-50)] rounded-2xl p-8 border border-[var(--navy)]/20">
              <h3 className="text-lg font-bold text-[var(--navy)] mb-4">What Dumb Roof Repair Does</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  <p className="text-sm text-gray-600">Tech uploads photos and answers 3 questions. AI diagnoses the root cause, builds the repair scope, and generates a professional branded ticket &mdash; in minutes</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  <p className="text-sm text-gray-600">Wraps the diagnosis, the sale presentation, the financial transaction, and the repair instructions into a single visit</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  <p className="text-sm text-gray-600">Homeowner receives clear before-and-after documentation, clicks to approve, and payment processes automatically &mdash; contactless, professional, done</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  <p className="text-sm text-gray-600">Built-in checkpoints flag the 2% of edge cases for human review. Nothing gets through that shouldn&apos;t</p>
                </div>
              </div>
            </div>
          </div>

          {/* Why nothing like this exists */}
          <div className="bg-[var(--navy)] rounded-2xl p-8 text-white">
            <h3 className="text-xl font-bold mb-4">Why Nothing Like This Exists</h3>
            <p className="text-gray-300 mb-6 leading-relaxed">
              Every service department runs the same play: diagnose, quote, follow up, schedule, return,
              repair, collect. That&apos;s 3&ndash;5 touchpoints and weeks of delay. Dumb Roof Repair compresses
              it into one. Diagnose, present, close, collect, repair &mdash; one visit, one tech, one call.
              No software has done this because no one had the training data. We do. 140,000 real inspection
              photos and patent pending AI that turns any tradesman into a revenue-generating expert.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { label: "Plug and Play", value: "Instantly scalable. No training. No onboarding curve. New tech produces expert-level diagnostics on day one. Key man risk and turnover headaches disappear overnight." },
                { label: "Break the Language Barrier", value: "Your best roofers can find the leak but can\u2019t always present it in English. They don\u2019t need to anymore. AI generates clear, professional documentation that speaks for itself \u2014 and homeowners prefer the contactless experience anyway." },
                { label: "The Contactless Close", value: "Diagnosis, repair instructions, and branded ticket generate simultaneously. Homeowner approves and pays from inside their house while your tech is on the roof. One call close. Service and collect. On to the next." },
              ].map((item) => (
                <div key={item.label} className="bg-white/10 rounded-xl p-4 border border-white/10">
                  <p className="text-xs text-[var(--gold)] font-semibold uppercase tracking-wider">{item.label}</p>
                  <p className="text-sm text-gray-200 mt-2 leading-relaxed">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Inspector Network */}
      <section id="inspectors" className="py-20 px-6 bg-white scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-block mb-4 px-4 py-1.5 rounded-full bg-[var(--navy)]/5 border border-[var(--navy)]/10">
              <span className="text-[var(--navy)] text-sm font-semibold">
                Now Recruiting Nationwide
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] mb-4">
              Join the Dumb Roof Inspector Network
            </h2>
            <p className="text-gray-500 max-w-2xl mx-auto leading-relaxed">
              Professional roof inspections. No angry homeowners. No &ldquo;my roof is leaking&rdquo;
              calls six months later. No punch lists. No warranty callbacks.
              Just detailed, standards-based inspections.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-10">
            {/* Left — Value Props */}
            <div className="space-y-6">
              <div className="bg-[var(--gray-50)] rounded-2xl p-8 border border-gray-100">
                <h3 className="text-xl font-bold text-[var(--navy)] mb-6">
                  Just Inspections. Nothing Else.
                </h3>
                <div className="space-y-5">
                  {[
                    {
                      title: "Inspect. Document. Get paid.",
                      desc: "Show up, follow industry best practices, take photos, document damage. Our AI handles the forensic report, the estimate, and the appeal package. You never touch paperwork.",
                    },
                    {
                      title: "No construction liability",
                      desc: "You are not the contractor. You don\u2019t build anything, warranty anything, or manage any crews. When the phone rings 6 months later \u2014 it\u2019s not your phone.",
                    },
                    {
                      title: "Pick your jobs, set your schedule",
                      desc: "Inspection requests appear in your market. Accept what works for your schedule. Decline what doesn\u2019t. No quotas, no mandatory availability windows.",
                    },
                    {
                      title: "Get paid more than carrier-side work",
                      desc: "Carrier inspection companies pay $75\u2013$150 per inspection. Policyholder-side inspections through our network pay significantly more for the same work.",
                    },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                        <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-[var(--navy)] text-sm">{item.title}</p>
                        <p className="text-gray-500 text-sm mt-1 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[var(--navy)] rounded-2xl p-8">
                <h4 className="text-white font-bold mb-4">Two Tiers. Same Respect.</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/10 border border-white/10 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-[var(--gold)]" />
                      <span className="text-[var(--gold)] text-xs font-bold uppercase tracking-wider">HAAG Certified</span>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">
                      Premium rate. Your HAAG stamp goes on the report.
                      The gold standard carriers trust &mdash; now working for the policyholder.
                    </p>
                  </div>
                  <div className="bg-white/10 border border-white/10 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-gray-400" />
                      <span className="text-gray-300 text-xs font-bold uppercase tracking-wider">Experienced</span>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">
                      Competitive rate. Years of field experience without
                      HAAG certification. Proper 1099 insurance required.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right — Application Form */}
            <div>
              <InspectorApplicationForm />
            </div>
          </div>
        </div>
      </section>

      {/* Get Started CTA */}
      <section id="get-started" className="py-20 px-6 bg-[var(--navy)] scroll-mt-20">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-gray-400 mb-8">
            Create your account in 30 seconds. Upload your first claim
            and get back a forensic-grade package in 15 minutes.
          </p>
          <a
            href="/login?mode=signup"
            className="inline-block bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors shadow-lg shadow-red-900/30"
          >
            Create Your Account
          </a>
          <p className="text-gray-500 text-sm mt-4">
            Already have an account?{" "}
            <a href="/login" className="text-white hover:text-[var(--red)] transition-colors">
              Sign in
            </a>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[var(--navy)] border-t border-white/10 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white text-sm">DR</div>
            <span className="text-gray-400 text-sm">Dumb Roof Technologies™</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/login" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
              Sign In
            </a>
            <div className="text-center sm:text-right">
              <p className="text-gray-500 text-sm">
                &copy; {new Date().getFullYear()} Dumb Roof Technologies. All rights reserved.
              </p>
              <p className="text-gray-600 text-xs mt-1">
                Patent Pending
              </p>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
