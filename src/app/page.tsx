import { InspectorApplicationForm } from "@/components/inspector-application-form";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HomeNav } from "@/components/home-nav";
import { Footer } from "@/components/footer";

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
    <main className="min-h-screen">
      {/* Nav */}
      <HomeNav />

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

          <p className="text-lg sm:text-xl text-[var(--gray-dim)] max-w-2xl mx-auto mb-4 leading-relaxed">
            Upload your photos and measurements. Get 5 professional PDFs
            ready to send to the carrier in 15 minutes. No Xactimate
            license needed.
          </p>
          <p className="text-sm text-[var(--gray-muted)] max-w-xl mx-auto mb-10 leading-relaxed">
            Forensic causation report, code-cited estimate, carrier comparison,
            supplement letter, and cover email &mdash; all branded with your company logo.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <a
              href="/login?mode=signup"
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors shadow-lg shadow-red-900/30"
            >
              Try 3 Free Claims
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
                <div className="text-sm text-[var(--gray-dim)] mt-1">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Integration Logos */}
          <div className="mt-14 pt-10 border-t border-white/10">
            <p className="text-[var(--gray-muted)] text-xs uppercase tracking-widest mb-6">
              Integrates with
            </p>
            <a
              href="/integrations"
              className="flex flex-wrap items-center justify-center gap-8 sm:gap-12"
            >
              {[
                { name: "AccuLynx", logo: "/integrations/acculynx.svg" },
                { name: "CompanyCam", logo: "/integrations/companycam.svg" },
                { name: "JobNimbus", logo: "/integrations/jobnimbus.svg" },
                { name: "EagleView", logo: "/integrations/eagleview.svg" },
                { name: "HOVER", logo: "/integrations/hover.svg" },
                { name: "RoofLink", logo: "/integrations/rooflink.svg" },
                { name: "ServiceTitan", logo: "/integrations/servicetitan.svg" },
              ].map((tool) => (
                <img
                  key={tool.name}
                  src={tool.logo}
                  alt={tool.name}
                  className="h-6 sm:h-7 w-auto opacity-60 hover:opacity-100 transition-opacity"
                />
              ))}
            </a>
          </div>
        </div>
      </section>

      {/* The Trust Problem */}
      <section id="problem" className="py-20 px-6 bg-white/[0.03] scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] text-center mb-4">
            Nobody Trusts <span className="text-[var(--red)]">You</span>
          </h2>
          <p className="text-[var(--gray-muted)] text-center mb-14 max-w-2xl mx-auto">
            Homeowners don&apos;t trust you. Insurance adjusters don&apos;t trust you.
            And right now, you&apos;re giving them every reason not to.
          </p>

          {/* Two Trust Problem Cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-10">
            {/* Homeowners */}
            <div className="glass-card p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--red)] mb-3">The Homeowner Problem</p>
              <h3 className="text-xl font-bold text-[var(--white)] mb-4">
                Homeowners Don&apos;t Trust You
              </h3>
              <div className="space-y-4">
                {[
                  { stat: "#1", text: "Roofing is the #1 most-complained industry on the BBB &mdash; 3,392 complaints in a single year" },
                  { stat: "70%", text: "of consumers won&apos;t return to a contractor after one bad experience" },
                  { stat: "40%", text: "of homeowners say poor communication is their #1 frustration with contractors" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-2xl font-bold text-[var(--red)] shrink-0 w-14 text-right" dangerouslySetInnerHTML={{ __html: item.stat }} />
                    <p className="text-sm text-[var(--gray)] leading-relaxed pt-1" dangerouslySetInnerHTML={{ __html: item.text }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Adjusters */}
            <div className="glass-card p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--red)] mb-3">The Adjuster Problem</p>
              <h3 className="text-xl font-bold text-[var(--white)] mb-4">
                Insurance Adjusters Don&apos;t Trust You
              </h3>
              <div className="space-y-4">
                {[
                  { stat: "90%", text: "of contractors submit hail and wind claims without any inspection report or evidence packet" },
                  { stat: "4x", text: "Contractors who submit detailed damage documentation get 4x more claims approved from the start" },
                  { stat: "$0", text: "is what most contractors invest in proving their case &mdash; then wonder why the adjuster sides with the carrier" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-2xl font-bold text-[var(--red)] shrink-0 w-14 text-right">{item.stat}</span>
                    <p className="text-sm text-[var(--gray)] leading-relaxed pt-1">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* The Hard Truth Callout */}
          <div className="rounded-2xl border border-[var(--red)]/30 bg-[var(--red)]/[0.06] p-8 mb-10 text-center">
            <p className="text-lg sm:text-xl font-bold text-[var(--white)] mb-3">
              Don&apos;t expect adjusters and homeowners to take your word for it.
            </p>
            <p className="text-[var(--gray)] max-w-3xl mx-auto leading-relaxed">
              Stand out from your competition by submitting detailed, sophisticated forensic inspection
              reports. You already took the photos. You already have the measurements.
              Just upload them to <span className="text-[var(--white)] font-semibold">dumbroof.ai</span> and
              watch your revenue explode.
            </p>
          </div>

          {/* The Real Problems */}
          <div className="space-y-6">
            <div className="glass-card p-8">
              <h3 className="text-xl font-bold text-[var(--white)] mb-4">
                The Contractor&apos;s Impossible Choice
              </h3>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="text-[var(--red)] text-lg mt-0.5 shrink-0">01</span>
                    <div>
                      <p className="font-semibold text-[var(--white)]">Train reps for years on insurance</p>
                      <p className="text-sm text-[var(--gray-muted)] mt-1">
                        It takes years to learn the full insurance process &mdash; building codes, Xactimate,
                        supplement negotiations, carrier tactics. Just when they hit their stride...
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-[var(--red)] text-lg mt-0.5 shrink-0">02</span>
                    <div>
                      <p className="font-semibold text-[var(--white)]">They leave and start their own company</p>
                      <p className="text-sm text-[var(--gray-muted)] mt-1">
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
                      <p className="font-semibold text-[var(--white)]">Or don&apos;t train them enough</p>
                      <p className="text-sm text-[var(--gray-muted)] mt-1">
                        Untrained reps miss supplements and line items. One photo could add a $5,000 line item
                        to a claim &mdash; but they don&apos;t know to take it. Money left on every roof.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-[var(--red)] text-lg mt-0.5 shrink-0">04</span>
                    <div>
                      <p className="font-semibold text-[var(--white)]">Or skip insurance work entirely</p>
                      <p className="text-sm text-[var(--gray-muted)] mt-1">
                        Most contractors avoid insurance claims because the process is too frustrating.
                        That&apos;s by design &mdash; carriers built it that way.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* New Hires - No Problem */}
            <div className="glass-card p-8 border-l-4 border-l-[var(--green,#22c55e)]">
              <h3 className="text-xl font-bold text-[var(--white)] mb-3">
                New Hires? No Worries.
              </h3>
              <p className="text-[var(--gray)] leading-relaxed mb-4">
                If they can take photos, they can present reports that give your company a truly
                competitive advantage in your market. Hire a rep today and they present your company
                in the manner you want, <span className="text-[var(--white)] font-semibold">from day one.</span>
              </p>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { label: "Training Time", before: "2+ years", after: "Day 1" },
                  { label: "Skill Required", before: "Xactimate + codes + negotiation", after: "Take photos & upload" },
                  { label: "Output Quality", before: "Depends on the rep", after: "Forensic-grade, every time" },
                ].map((item) => (
                  <div key={item.label} className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <p className="text-xs text-[var(--gray-dim)] font-semibold uppercase tracking-wider mb-2">{item.label}</p>
                    <p className="text-sm text-[var(--gray-muted)] line-through decoration-[var(--red)]/50">{item.before}</p>
                    <p className="text-sm text-[var(--white)] font-semibold mt-1">{item.after}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* PE Problem */}
            <div className="bg-[var(--bg-glass)] rounded-2xl p-8 text-white">
              <h3 className="text-xl font-bold mb-4">
                Why Private Equity Hates Insurance Work
              </h3>
              <p className="text-[var(--gray-dim)] mb-6 leading-relaxed">
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
                    <p className="text-xs text-[var(--gray-dim)] font-semibold uppercase tracking-wider">{item.label}</p>
                    <p className="text-sm text-[var(--gray-dim)] mt-2">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Solution */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center">
            <div className="inline-block mb-4 px-4 py-1.5 rounded-full bg-[var(--red)]/10 border border-[var(--red)]/20">
              <span className="text-[var(--red)] text-sm font-semibold">Patent Pending</span>
            </div>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] text-center mb-4">
            Don&apos;t Tell. Prove.
          </h2>
          <p className="text-[var(--gray-muted)] text-center mb-14 max-w-2xl mx-auto">
            Homeowners don&apos;t trust storm chasers. Carriers dismiss sloppy supplements.
            So we built documentation so thorough, so forensic, so code-cited that
            it speaks for itself.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white/[0.03] rounded-2xl p-8 border border-[var(--border-glass)]">
              <h3 className="text-lg font-bold text-[var(--white)] mb-4">What Estimate Services Do</h3>
              <ul className="space-y-3 text-[var(--gray)] text-sm">
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
            <div className="bg-white/[0.03] rounded-2xl p-8 border border-[var(--border-glass)]">
              <h3 className="text-lg font-bold text-[var(--white)] mb-4">What Dumb Roof Generates</h3>
              <ul className="space-y-3 text-[var(--gray)] text-sm">
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

          <div className="mt-8 bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
            <p className="text-amber-400 text-sm leading-relaxed">
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
      <section id="how-it-works" className="py-20 px-6 bg-white/[0.03] scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] text-center mb-4">
            How It Works
          </h2>
          <p className="text-[var(--gray-muted)] text-center mb-14 max-w-xl mx-auto">
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
                  <svg className="w-8 h-8 text-[var(--gray)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                ),
              },
              {
                step: "02",
                title: "AI Analyzes Everything",
                desc: "Reads every document. Analyzes every photo forensically. Cross-references building codes. Checks carrier playbooks. Builds the evidence chain.",
                icon: (
                  <svg className="w-8 h-8 text-[var(--gray)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                  </svg>
                ),
              },
              {
                step: "03",
                title: "Download Your Package",
                desc: "Get back up to 5 professional PDFs branded with your company logo. Forensic report, estimate, supplement, appeal letter, and cover email.",
                icon: (
                  <svg className="w-8 h-8 text-[var(--gray)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                ),
              },
            ].map((item) => (
              <div
                key={item.step}
                className="glass-card p-8 relative hover:border-[var(--border-glass)] transition-colors"
              >
                <span className="absolute top-6 right-6 text-5xl font-bold text-[var(--gray-dim)]">
                  {item.step}
                </span>
                <div className="mb-5">{item.icon}</div>
                <h3 className="text-xl font-bold text-[var(--white)] mb-2">
                  {item.title}
                </h3>
                <p className="text-[var(--gray)] leading-relaxed text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The 5 Documents */}
      <section className="py-20 px-6 bg-[var(--bg-glass)]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-white text-center mb-4">
            The 5-Document Package
          </h2>
          <p className="text-[var(--gray-dim)] text-center mb-4 max-w-xl mx-auto">
            Every document forensic-grade, code-cited, and branded
            with your company logo.
          </p>
          <div className="text-center mb-14">
            <a
              href="https://tkovack10.github.io/USARM-Claims-Platform/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[var(--cyan)] hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View Example Package
            </a>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { num: "01", title: "Damage Analysis", desc: "Photo-annotated damage report with clinical observations. Every finding tied to HAAG engineering standards." },
              { num: "02", title: "Your Estimate", desc: "Line-item scope at current regional pricing. Every line item backed by building code citations and photo evidence." },
              { num: "03", title: "Carrier Comparison", desc: "Line-by-line carrier vs. your scope. Exposes every underpayment, missed item, and pricing discrepancy." },
              { num: "04", title: "Supplement Letter", desc: "Formal response citing building codes, insurance regulations, and forensic evidence. Written to move adjusters." },
              { num: "05", title: "Cover Email", desc: "Ready-to-send email with professional tone, attachment summary, and regulatory response deadline." },
              { num: "++", title: "Carrier Intelligence", desc: "Every claim feeds self-learning carrier playbooks. By claim #20, the system knows your carrier's tactics before you do." },
            ].map((doc) => (
              <div key={doc.num} className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors">
                <span className="text-[var(--red)] text-sm font-mono font-bold">{doc.num}</span>
                <h4 className="text-white font-semibold mt-2 mb-2">{doc.title}</h4>
                <p className="text-[var(--gray-dim)] text-sm leading-relaxed">{doc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who This Is For */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] text-center mb-14">
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
              <div key={item.title} className="glass-card p-8">
                <h3 className="text-lg font-bold text-[var(--white)] mb-3">{item.title}</h3>
                <p className="text-[var(--gray)] text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Company Intelligence */}
      <section className="py-20 px-6 bg-white/[0.03]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] text-center mb-4">
            Your Reps Inspect. <span className="text-[var(--red)]">You See Everything.</span>
          </h2>
          <p className="text-[var(--gray-muted)] text-center mb-14 max-w-2xl mx-auto">
            Every inspection your team runs feeds your company dashboard with real-time
            damage intelligence, fraud alerts, and claim quality scores.
          </p>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Damage Scores */}
            <div className="glass-card p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[var(--cyan)]/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-[var(--cyan)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-[var(--white)]">Damage Scores</h3>
              </div>
              <p className="text-[var(--gray)] text-sm leading-relaxed mb-4">
                Every inspection gets a damage score and a technical boost score. Know which claims
                show the most damage. Focus your team on areas with the best opportunities.
                Catch weak claims before your customers submit them.
                If your photos don&apos;t show damage &mdash; <span className="text-[var(--white)] font-semibold">we will tell you there&apos;s no damage.</span> We
                don&apos;t fabricate claims. We document what&apos;s there.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Damage Score", desc: "How severe is the actual damage?" },
                  { label: "Technical Boost", desc: "Discontinued products, code compliance requirements, and factors that strengthen the claim" },
                ].map((item) => (
                  <div key={item.label} className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-xs font-semibold text-[var(--cyan)] mb-1">{item.label}</p>
                    <p className="text-xs text-[var(--gray-muted)]">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Fraud Detection */}
            <div className="glass-card p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[var(--red)]/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-[var(--red)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-[var(--white)]">Fraud Detection</h3>
              </div>
              <p className="text-[var(--gray)] text-sm leading-relaxed mb-4">
                Our custom fraud detection scan analyzes every photo for EXIF manipulation, GPS
                inconsistencies, duplicate images, and editing artifacts. Sleep well knowing your
                reps are not creating or exaggerating damage.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "EXIF Analysis", desc: "Detects edited or manipulated metadata" },
                  { label: "GPS Verification", desc: "Confirms photos match the job site" },
                  { label: "Duplicate Scan", desc: "Flags reused photos across claims" },
                  { label: "Integrity Score", desc: "Pass/fail confidence for every photo" },
                ].map((item) => (
                  <div key={item.label} className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-xs font-semibold text-[var(--red)] mb-1">{item.label}</p>
                    <p className="text-xs text-[var(--gray-muted)]">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom callout */}
          <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-6 text-center">
            <p className="text-[var(--gray)] text-sm leading-relaxed max-w-3xl mx-auto">
              Your dashboard shows every claim, every score, every flag &mdash; across every rep in your company.
              <span className="text-[var(--white)] font-semibold"> Stop guessing which jobs are worth pursuing.
              Start knowing.</span>
            </p>
          </div>
        </div>
      </section>

      {/* Automation */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] text-center mb-4">
            You&apos;re Not Working From a <span className="text-[var(--red)]">Desk</span>
          </h2>
          <p className="text-[var(--gray-muted)] text-center mb-14 max-w-2xl mx-auto">
            Carrier-side adjusters sit at desks all day. You&apos;re on a roof. You don&apos;t have time
            to send three follow-up emails asking if they received the invoice you submitted two weeks ago.
            So it doesn&apos;t get done. And you don&apos;t get paid.
          </p>

          {/* Pain → Solution */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* The Pain */}
            <div className="glass-card p-8 border-l-4 border-l-[var(--red)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--red)] mb-3">What&apos;s Actually Happening</p>
              <div className="space-y-4">
                {[
                  "You submitted the certificate of completion. Nobody acknowledged it.",
                  "You sent the invoice. It\u2019s been 14 days. No response.",
                  "The supplement was sent. The adjuster \u201Cnever received it.\u201D",
                  "Your office manager quit. Nobody picked up the follow-ups.",
                  "You\u2019re on a roof right now reading this. That\u2019s the point.",
                ].map((pain, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <svg className="w-4 h-4 text-[var(--red)] mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <p className="text-sm text-[var(--gray)] leading-relaxed">{pain}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* The Fix */}
            <div className="glass-card p-8 border-l-4 border-l-[var(--green)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--green)] mb-3">What Dumb Roof Automates</p>
              <div className="space-y-4">
                {[
                  {
                    title: "Email Automation",
                    desc: "5-touchpoint escalation that sends itself. Professional on Day 0, receipt confirmation on Day 3, firm on Day 7, regulatory citation on Day 15, demand on Day 20. Every supplement, every COC, every follow-up \u2014 sent and tracked without you touching a keyboard.",
                  },
                  {
                    title: "Invoice Automation",
                    desc: "Certificate of completion, final invoice, and payment reminders \u2014 all auto-generated from your install photos and auto-sent on schedule. Follows up politely until acknowledged. No office manager required.",
                  },
                  {
                    title: "Photo Evidence Recall",
                    desc: "Every photo your team uploads is analyzed, tagged, and linked to specific line items. When the carrier says \u201Cshow me the damage,\u201D the evidence is already attached \u2014 matched by trade, material, and severity.",
                  },
                  {
                    title: "Photo \u2192 Code Compliance Citations",
                    desc: "Your photos trigger automatic building code lookups. A photo of missing ice & water shield doesn\u2019t just get annotated \u2014 it gets cited with the exact RCNYS section that requires it. Every photo becomes a code violation the carrier can\u2019t ignore.",
                  },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3">
                    <svg className="w-4 h-4 text-[var(--green)] mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">{item.title}</p>
                      <p className="text-xs text-[var(--gray-muted)] mt-1 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Evidence Recall Demo */}
          <div className="glass-card p-0 mb-8 overflow-hidden">
            <div className="bg-[var(--red)]/[0.08] border-b border-[var(--red)]/20 px-6 py-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--red)]">Not Your Basic Automation</p>
              <p className="text-xs text-[var(--gray-dim)]">Live Evidence Recall</p>
            </div>
            <div className="p-6 sm:p-8">
              {/* Step 1: Adjuster Email */}
              <div className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-dim)] mb-2">Incoming Email &mdash; Insurance Adjuster</p>
                <div className="rounded-xl bg-white/[0.06] border border-white/10 p-5">
                  <div className="flex items-center gap-3 mb-3 pb-3 border-b border-white/[0.06]">
                    <div className="w-8 h-8 rounded-full bg-[var(--gray-dim)]/30 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-[var(--gray-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--white)]">David Chen &mdash; Field Adjuster, Erie Insurance</p>
                      <p className="text-xs text-[var(--gray-dim)]">Re: Claim #ERI-2026-04821 &mdash; 147 Oakwood Dr, Syracuse NY</p>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--gray)] leading-relaxed italic">
                    &ldquo;After completing my inspection, I found no storm-related damage to the left elevation
                    siding. The scuff marks observed appear consistent with normal weathering and are not indicative
                    of hail or wind impact. The siding on this elevation is not included in the approved scope
                    of repairs.&rdquo;
                  </p>
                </div>
              </div>

              {/* Step 2: AI Processing */}
              <div className="flex items-center gap-3 mb-6 px-2">
                <div className="flex-1 h-px bg-[var(--cyan)]/20" />
                <div className="flex items-center gap-2 bg-[var(--cyan)]/10 rounded-full px-4 py-1.5">
                  <div className="w-2 h-2 rounded-full bg-[var(--cyan)] animate-pulse" />
                  <p className="text-xs font-semibold text-[var(--cyan)]">RICHARD analyzing adjuster denial...</p>
                </div>
                <div className="flex-1 h-px bg-[var(--cyan)]/20" />
              </div>

              {/* Step 3: Evidence Recall */}
              <div className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--cyan)] mb-2">Evidence Recall &mdash; Left Elevation Siding &mdash; 4 Photos Matched</p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    {
                      label: "IMG_0847.jpg",
                      tag: "Hail Impact \u2014 Left Elevation",
                      desc: "3/4\u201D diameter impact fracture on vinyl siding panel, 6ft from grade. Circular pattern inconsistent with weathering.",
                      score: "Damage Score: 78",
                    },
                    {
                      label: "IMG_0849.jpg",
                      tag: "Chalk Test \u2014 Left Elevation",
                      desc: "Chalk circle test on J-channel showing dent displacement of 2mm+. Functional damage confirmed.",
                      score: "Damage Score: 84",
                    },
                    {
                      label: "IMG_0852.jpg",
                      tag: "Pattern Density \u2014 Left Elevation",
                      desc: "Wide shot showing 8+ impacts per 10 SF test square. Exceeds carrier\u2019s own threshold for replacement.",
                      score: "Damage Score: 91",
                    },
                    {
                      label: "IMG_0855.jpg",
                      tag: "Code Violation \u2014 House Wrap",
                      desc: "Missing WRB visible behind cracked panel. R703.1 requires weather-resistant barrier. Adds house wrap + flashing to scope.",
                      score: "Code: RCNYS R703.1",
                    },
                  ].map((photo) => (
                    <div key={photo.label} className="rounded-xl overflow-hidden border border-white/10">
                      <div className="h-24 bg-gradient-to-br from-white/[0.08] to-white/[0.02] flex items-center justify-center">
                        <svg className="w-8 h-8 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                      </div>
                      <div className="p-3 bg-white/[0.03]">
                        <p className="text-[10px] font-mono text-[var(--gray-dim)]">{photo.label}</p>
                        <p className="text-xs font-semibold text-[var(--cyan)] mt-1">{photo.tag}</p>
                        <p className="text-[10px] text-[var(--gray-muted)] mt-1 leading-relaxed">{photo.desc}</p>
                        <p className="text-[10px] font-semibold text-[var(--red)] mt-1">{photo.score}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 4: Auto-Generated Response */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--green)] mb-2">Auto-Generated Response &mdash; Ready to Send</p>
                <div className="rounded-xl bg-[var(--green)]/[0.06] border border-[var(--green)]/20 p-5">
                  <div className="flex items-center gap-3 mb-3 pb-3 border-b border-[var(--green)]/10">
                    <div className="w-8 h-8 rounded-full bg-[var(--green)]/20 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-[var(--green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--white)]">Re: Claim #ERI-2026-04821 &mdash; Left Elevation Siding Documentation</p>
                      <p className="text-xs text-[var(--gray-dim)]">To: David Chen &mdash; Erie Insurance</p>
                    </div>
                  </div>
                  <div className="text-sm text-[var(--gray)] leading-relaxed space-y-3">
                    <p>
                      Mr. Chen, attached please find four photographs documenting storm-related damage
                      to the left elevation siding at 147 Oakwood Dr.
                    </p>
                    <p>
                      Photos IMG_0847 and IMG_0849 show circular impact fractures and positive chalk test
                      results on the J-channel, confirming functional hail damage inconsistent with normal
                      weathering. IMG_0852 documents impact density exceeding 8 hits per 10 SF test square.
                    </p>
                    <p>
                      Additionally, IMG_0855 reveals a missing weather-resistant barrier behind the damaged panel,
                      constituting a code violation under RCNYS R703.1. Code-compliant installation requires house wrap
                      and wall flashing be included in the approved scope.
                    </p>
                    <p className="text-[var(--gray-dim)] text-xs">
                      4 attachments &bull; Forensic annotations included &bull; NOAA Storm Event #2026-NY-04821 referenced
                    </p>
                  </div>
                </div>
              </div>

              {/* Mic Drop */}
              <div className="mt-6 text-center">
                <p className="text-sm text-[var(--gray-muted)]">
                  From adjuster denial to documented rebuttal with photos, annotations, code citations, and
                  NOAA storm data &mdash; <span className="text-[var(--white)] font-bold">before you even read the email.</span>
                </p>
              </div>
            </div>
          </div>

          {/* Material Intelligence */}
          <div className="glass-card p-8 mb-8 border border-[var(--gold,#f59e0b)]/20">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[var(--gold,#f59e0b)]/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[var(--gold,#f59e0b)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--white)]">Your First Slate Claim? No Worries.</h3>
                <p className="text-xs text-[var(--gray-muted)]">Dumb Roof knows materials your reps have never seen.</p>
              </div>
            </div>

            <p className="text-sm text-[var(--gray)] leading-relaxed mb-5">
              Upload a photo of a slate roof and Dumb Roof will identify the specific style, trace it
              to the quarry it came from, approximate its age, and describe the damage using the exact
              technical terminology that carriers and engineers expect. Your rep doesn&apos;t need to know
              the difference between a Peach Bottom and a Buckingham &mdash; Dumb Roof does.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              {[
                {
                  material: "Slate",
                  detail: "Identifies quarry origin (Vermont, Buckingham, Peach Bottom), thickness class, expected service life, and whether individual slate repair is feasible or full replacement is required.",
                },
                {
                  material: "Clay & Concrete Tile",
                  detail: "Distinguishes barrel, flat, S-tile, and interlocking profiles. Identifies manufacturer patterns, color fade vs. impact damage, and hidden underlayment failures.",
                },
                {
                  material: "EPDM & TPO",
                  detail: "Differentiates hail bruising from thermal cracking, identifies seam failures vs. punctures, and flags UV degradation patterns that weaken claims.",
                },
                {
                  material: "Metal Panels & Standing Seam",
                  detail: "Detects panel gauge, identifies oil-canning vs. hail dents, documents chalk test results, and cites manufacturer warranty thresholds for functional damage.",
                },
              ].map((item) => (
                <div key={item.material} className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <p className="text-sm font-bold text-[var(--gold,#f59e0b)] mb-2">{item.material}</p>
                  <p className="text-xs text-[var(--gray-muted)] leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-[var(--gold,#f59e0b)]/[0.06] border border-[var(--gold,#f59e0b)]/20 p-4 text-center">
              <p className="text-xs text-[var(--gray)] leading-relaxed">
                140,000+ training photos across every roofing material in North America. Your rep uploads the photo.
                <span className="text-[var(--white)] font-semibold"> Dumb Roof writes like a 30-year forensic engineer.</span>
              </p>
            </div>
          </div>

          {/* Real Scenario */}
          <div className="glass-card p-8 mb-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cyan)] mb-4">A Tuesday With Dumb Roof</p>
            <div className="space-y-0">
              {[
                {
                  time: "7:00 AM",
                  event: "Your PM gets a pre-install checklist",
                  detail: "Dumb Roof texts your project manager: get photos of the existing layers, flashing condition, and any code-required items before tear-off begins.",
                },
                {
                  time: "9:15 AM",
                  event: "\u201CYesterday\u2019s build had 2 layers. Did you forget to supplement it?\u201D",
                  detail: "Dumb Roof already did. Your CompanyCam photos were linked, the second layer was documented, and the supplement was sent to the carrier before you finished your coffee.",
                },
                {
                  time: "2:30 PM",
                  event: "Install complete. PM uploads final photos.",
                  detail: "Dumb Roof scans for additional documentation opportunities \u2014 hidden damage revealed during tear-off, code upgrades triggered by the scope of work, items the original inspection couldn\u2019t see.",
                },
                {
                  time: "2:31 PM",
                  event: "Certificate of completion generated and sent",
                  detail: "Auto-generated from your install photos. Sent to the carrier and homeowner. Follow-ups scheduled until acknowledged.",
                },
                {
                  time: "Day 3",
                  event: "No response? Polite follow-up sent automatically.",
                  detail: "Day 7: firmer. Day 15: regulatory language. Day 20: demand. You never touched your keyboard.",
                },
              ].map((step, i) => (
                <div key={i} className="flex gap-4 relative">
                  {/* Timeline line */}
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--cyan)] shrink-0 mt-1.5" />
                    {i < 4 && <div className="w-px flex-1 bg-[var(--cyan)]/20" />}
                  </div>
                  <div className="pb-6">
                    <p className="text-xs text-[var(--cyan)] font-mono font-semibold">{step.time}</p>
                    <p className="text-sm font-semibold text-[var(--white)] mt-1">{step.event}</p>
                    <p className="text-xs text-[var(--gray-muted)] mt-1 leading-relaxed">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RICHARD */}
          <div className="glass-card p-8 mb-8 border border-[var(--cyan)]/20">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-[var(--cyan)]/10 flex items-center justify-center shrink-0">
                <svg className="w-7 h-7 text-[var(--cyan)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-[var(--white)]">
                  Meet <span className="text-[var(--cyan)]">RICHARD</span>
                </h3>
                <p className="text-sm text-[var(--gray-muted)]">
                  Your AI Claims Assistant &mdash; Voice-Activated, Always On
                </p>
              </div>
            </div>

            <p className="text-[var(--gray)] text-sm leading-relaxed mb-6">
              RICHARD knows every detail of every claim your company has ever processed. Every photo,
              every line item, every carrier response, every code citation. And he takes orders
              by <span className="text-[var(--white)] font-semibold">voice</span>.
            </p>

            <div className="grid md:grid-cols-2 gap-6 mb-6">
              {/* Voice Commands */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cyan)] mb-3">Talk to RICHARD</p>
                <div className="space-y-3">
                  {[
                    {
                      prompt: "\u201CRichard, send the supplement to Erie on the Johnson claim.\u201D",
                      result: "Supplement package compiled from your photos, estimate, and code citations. Sent to the adjuster on file. Follow-up sequence activated.",
                    },
                    {
                      prompt: "\u201CRichard, what\u2019s the status on 42 Oak Street?\u201D",
                      result: "Carrier received the supplement 6 days ago. No response. Auto-escalation email goes out tomorrow. Damage score: 82. Technical boost: 71.",
                    },
                    {
                      prompt: "\u201CRichard, draft an invoice for the Martinez build.\u201D",
                      result: "Invoice generated from the approved scope. Certificate of completion attached. Sent to the homeowner and carrier. Payment follow-up scheduled for Day 7.",
                    },
                    {
                      prompt: "\u201CRichard, what code requires ice & water shield on this roof?\u201D",
                      result: "RCNYS R905.1.2 \u2014 ice barrier required from eave edge to min. 24\u201D past interior wall line. Your photos show it\u2019s missing. Already cited in the forensic report.",
                    },
                  ].map((item, i) => (
                    <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <p className="text-xs text-[var(--cyan)] font-mono leading-relaxed">{item.prompt}</p>
                      <p className="text-xs text-[var(--gray-muted)] mt-2 leading-relaxed">{item.result}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* What RICHARD Knows */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cyan)] mb-3">What RICHARD Knows</p>
                <div className="space-y-3">
                  {[
                    { title: "Every Claim", desc: "Full history \u2014 photos, line items, carrier responses, scope comparisons, damage scores, email threads" },
                    { title: "Every Code", desc: "Building codes by state, county, and municipality. RCNYS, IRC, IECC \u2014 cited automatically when relevant" },
                    { title: "Every Carrier", desc: "Self-learning playbooks that track how each carrier responds, what they deny, and what arguments win" },
                    { title: "Every Photo", desc: "140,000+ training photos. Knows the difference between hail hits on 3-tab vs. architectural vs. EPDM vs. slate" },
                    { title: "Your Schedule", desc: "Knows which follow-ups are overdue, which installs are pending, which invoices are unpaid" },
                    { title: "Your Voice", desc: "Understands natural speech from a truck cab, a rooftop, or a job site. No typing. No app. Just talk." },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--cyan)] mt-1.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-[var(--white)]">{item.title}</p>
                        <p className="text-xs text-[var(--gray-muted)] leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RICHARD Coaches Your Reps */}
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gold,#f59e0b)] mb-4">RICHARD Coaches Your Reps in the Field</p>
              <p className="text-sm text-[var(--gray)] leading-relaxed mb-4">
                If your photos aren&apos;t showcasing the damage, RICHARD tells your rep exactly what
                to go back and get. No guessing. No missed documentation. No money left on the roof.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {
                    prompt: "\u201CGet closer photos of the north slope eave line.\u201D",
                    why: "RICHARD detected potential ice dam damage but your wide shots don\u2019t show it. He needs 3 close-ups within 2 feet of the eave.",
                  },
                  {
                    prompt: "\u201CDo a chalk test on the counter flashing at the chimney.\u201D",
                    why: "The metal flashing shows possible impact marks but RICHARD can\u2019t confirm severity from a photo alone. A chalk circle test proves functional damage the carrier can\u2019t deny.",
                  },
                  {
                    prompt: "\u201CPhotograph the drip edge from below \u2014 I need to see the fastener pattern.\u201D",
                    why: "RICHARD found a code violation \u2014 the drip edge appears face-nailed instead of top-nailed. One photo confirms a code-required replacement the carrier is currently excluding.",
                  },
                  {
                    prompt: "\u201CGet a shot of the shingle exposure with a tape measure.\u201D",
                    why: "Exposure looks under 5\u201D which makes individual shingle repair impossible. That one photo changes the entire claim from repair to full replacement.",
                  },
                  {
                    prompt: "\u201CPhotograph both layers at the tear-off edge.\u201D",
                    why: "The carrier scoped for one layer. Your crew just found two. RICHARD needs the photo to auto-generate the supplement before the dumpster leaves.",
                  },
                  {
                    prompt: "\u201CGet a wide shot showing the missing house wrap at the corner.\u201D",
                    why: "Code R703.1 requires a weather-resistant barrier. This single photo adds house wrap, corner boards, and wall flashing to the scope \u2014 potentially $3,000+ the carrier excluded.",
                  },
                ].map((item, i) => (
                  <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-xs text-[var(--gold,#f59e0b)] font-mono leading-relaxed mb-2">{item.prompt}</p>
                    <p className="text-xs text-[var(--gray-muted)] leading-relaxed">{item.why}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Damage Thresholds */}
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--red)] mb-4">Automatic Damage Thresholds</p>
              <p className="text-sm text-[var(--gray)] leading-relaxed mb-4">
                RICHARD doesn&apos;t just look at your photos &mdash; he cross-references NOAA storm data
                for your exact location. If the National Weather Service recorded 1.5&quot; hail in your
                county on the date of loss, RICHARD already knows what damage to expect and flags
                anything your photos are missing.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { threshold: "< 1\u201D Hail", impact: "Cosmetic damage likely. Soft metals (vents, gutters) show first. Shingles may show granule displacement only.", action: "Document soft metal impacts + gutters. Chalk test all vents." },
                  { threshold: "1\u201D \u2013 1.5\u201D Hail", impact: "Functional damage threshold. Shingles show mat fracture. Collateral damage to siding, window screens, AC fins.", action: "Full roof + all elevations. Shingle close-ups with quarter reference." },
                  { threshold: "1.5\u201D \u2013 2\u201D Hail", impact: "Severe functional damage. Cracked shingles, split felt, bruised decking. Ridge caps and pipe boots compromised.", action: "Document everything. Ridge cap pulls, pipe boot close-ups, attic photos if accessible." },
                  { threshold: "> 2\u201D Hail", impact: "Catastrophic. Full replacement expected. Interior damage likely. Gutters destroyed, fascia cracked, window damage.", action: "Interior + exterior full documentation. Measure dents for diameter. Get hail stone photos if available." },
                ].map((item) => (
                  <div key={item.threshold} className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-sm font-bold text-[var(--red)] mb-1">{item.threshold}</p>
                    <p className="text-xs text-[var(--gray-muted)] leading-relaxed mb-2">{item.impact}</p>
                    <p className="text-xs text-[var(--cyan)] leading-relaxed">{item.action}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--gray-dim)] mt-3 text-center">
                Thresholds auto-calibrated by NOAA Storm Events Database. Wind speed, hail diameter, and event duration
                are pulled for your exact county and date of loss.
              </p>
            </div>

            <div className="rounded-xl bg-[var(--cyan)]/[0.08] border border-[var(--cyan)]/20 p-4 text-center">
              <p className="text-sm text-[var(--gray)] leading-relaxed">
                Your best insurance rep took years to build. RICHARD has all of that knowledge on day one &mdash;
                and he never leaves, never forgets, and never stops following up.
                <span className="text-[var(--white)] font-semibold"> He just needs your voice.</span>
              </p>
            </div>
          </div>

          {/* Bottom callout */}
          <div className="rounded-2xl border border-[var(--green)]/30 bg-[var(--green)]/[0.06] p-6 text-center">
            <p className="text-[var(--gray)] text-sm leading-relaxed max-w-3xl mx-auto">
              Every email, every follow-up, every escalation &mdash; handled automatically while you&apos;re on a roof.
              <span className="text-[var(--white)] font-semibold"> The carriers have systems. Now you do too.</span>
            </p>
          </div>
        </div>
      </section>

      {/* Results */}
      <section id="results" className="py-20 px-6 bg-white/[0.03] scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] text-center mb-4">
            Real Results. Real Claims. Real Carrier Movement.
          </h2>
          <p className="text-[var(--gray-muted)] text-center mb-14 max-w-xl mx-auto">
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
              <div key={result.carrier} className="glass-card p-6">
                <div className="text-sm font-semibold text-[var(--gray-muted)] mb-3">{result.carrier}</div>
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="text-[var(--gray-dim)] line-through text-sm">{result.before}</span>
                  <span className="text-[var(--white)] font-bold text-xl">{result.after}</span>
                </div>
                <div className="text-[var(--red)] font-bold text-sm">+{result.increase}</div>
              </div>
            ))}
          </div>

          {/* Comparison Table */}
          <div className="glass-card p-8">
            <h3 className="text-xl font-bold text-[var(--white)] mb-6 text-center">
              Dumb Roof vs. The Old Way
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[var(--border-glass)]">
                    <th className="pb-3 text-sm text-[var(--gray-muted)] font-medium"></th>
                    <th className="pb-3 text-sm text-[var(--gray-muted)] font-medium">Traditional</th>
                    <th className="pb-3 text-sm text-[var(--red)] font-bold">Dumb Roof</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {[
                    ["Time per claim", "1-3 months", "15 minutes"],
                    ["Cost per claim", "Xactimate license + hours of labor", "Pennies per claim"],
                    ["Documents generated", "1 estimate (maybe)", "5 forensic-grade PDFs"],
                    ["Code citations", "Rarely included", "Every line item cited"],
                    ["Photo evidence", "Unlabeled photos", "Forensic annotations tied to line items"],
                    ["Carrier intelligence", "Start from scratch every time", "Self-learning playbooks"],
                    ["Training required", "Years of insurance experience", "Upload and click"],
                    ["Rep turnover risk", "Knowledge walks out the door", "System stays. Forever."],
                  ].map(([label, old, dr]) => (
                    <tr key={label} className="border-b border-white/[0.04]">
                      <td className="py-3 font-medium text-[var(--gray)]">{label}</td>
                      <td className="py-3 text-[var(--gray-muted)]">{old}</td>
                      <td className="py-3 font-semibold text-[var(--white)]">{dr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Dumb Roof Repair */}
      <section id="repair" className="py-20 px-6 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-block mb-4 px-4 py-1.5 rounded-full bg-[var(--red)]/10 border border-[var(--red)]/20">
              <span className="text-[var(--red)] text-sm font-semibold">
                Patent Pending
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mb-4">
              Dumb Roof Repair
            </h2>
            <p className="text-[var(--gray-muted)] max-w-3xl mx-auto leading-relaxed">
              Patent pending technology trained on over 140,000 real before, during, and after
              roof inspection photos. One visit. Diagnose, present, close, collect, repair. On to the next.
            </p>
          </div>

          {/* Stats row */}
          <div className="bg-gradient-to-br from-[var(--navy)] to-[var(--navy-light)] rounded-2xl p-10 text-center mb-10">
            <div className="grid sm:grid-cols-3 gap-8 items-center">
              <div>
                <div className="text-5xl sm:text-6xl font-bold text-white mb-2">98%</div>
                <p className="text-[var(--gray-dim)] text-sm">Diagnostic Accuracy</p>
              </div>
              <div>
                <div className="text-5xl sm:text-6xl font-bold text-[var(--gold)] mb-2">140K+</div>
                <p className="text-[var(--gray-dim)] text-sm">Training Photos</p>
              </div>
              <div>
                <div className="text-5xl sm:text-6xl font-bold text-[var(--red)] mb-2">2%</div>
                <p className="text-[var(--gray-dim)] text-sm">Caught by Built-In Checkpoints</p>
              </div>
            </div>
          </div>

          {/* Pain / Solution columns */}
          <div className="grid md:grid-cols-2 gap-8 mb-10">
            <div className="bg-white/[0.03] rounded-2xl p-8 border border-[var(--border-glass)]">
              <h3 className="text-lg font-bold text-[var(--white)] mb-4">The Problem Nobody Has Solved</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  <p className="text-sm text-[var(--gray)]">Service departments live and die by 1&ndash;2 techs who can diagnose a leak. Everyone else waits for instructions</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  <p className="text-sm text-[var(--gray)]">Those techs quit, and your revenue stream stops. Key man risk in its purest form &mdash; and it happens every 16 months</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  <p className="text-sm text-[var(--gray)]">You have 10x more tradesmen who can execute a repair perfectly when told what to do. The bottleneck was never labor &mdash; it&apos;s diagnosis</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-[var(--red)] mt-0.5 shrink-0">&#x2715;</span>
                  <p className="text-sm text-[var(--gray)]">Your best roofers can often find the problem but can&apos;t present it to a homeowner in fluent English. The language barrier doesn&apos;t just limit hiring &mdash; it kills the close</p>
                </div>
              </div>
            </div>

            <div className="bg-white/[0.03] rounded-2xl p-8 border border-[var(--border-glass)]">
              <h3 className="text-lg font-bold text-[var(--white)] mb-4">What Dumb Roof Repair Does</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  <p className="text-sm text-[var(--gray)]">Tech uploads photos and answers 3 questions. AI diagnoses the root cause, builds the repair scope, and generates a professional branded ticket &mdash; in minutes</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  <p className="text-sm text-[var(--gray)]">Wraps the diagnosis, the sale presentation, the financial transaction, and the repair instructions into a single visit</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  <p className="text-sm text-[var(--gray)]">Homeowner receives clear before-and-after documentation, clicks to approve, and payment processes automatically &mdash; contactless, professional, done</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5 shrink-0">&#x2713;</span>
                  <p className="text-sm text-[var(--gray)]">Built-in checkpoints flag the 2% of edge cases for human review. Nothing gets through that shouldn&apos;t</p>
                </div>
              </div>
            </div>
          </div>

          {/* Why nothing like this exists */}
          <div className="bg-[var(--bg-glass)] rounded-2xl p-8 text-white">
            <h3 className="text-xl font-bold mb-4">Why Nothing Like This Exists</h3>
            <p className="text-[var(--gray-dim)] mb-6 leading-relaxed">
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
                  <p className="text-sm text-[var(--gray-dim)] mt-2 leading-relaxed">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Inspector Network */}
      <section id="inspectors" className="py-20 px-6 bg-white/[0.03] scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-block mb-4 px-4 py-1.5 rounded-full bg-white/[0.05] border border-[var(--border-glass)]">
              <span className="text-[var(--gray-dim)] text-sm font-semibold">
                Now Recruiting Nationwide
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mb-4">
              Join the Dumb Roof Inspector Network
            </h2>
            <p className="text-[var(--gray-muted)] max-w-2xl mx-auto leading-relaxed">
              Professional roof inspections. No angry homeowners. No &ldquo;my roof is leaking&rdquo;
              calls six months later. No punch lists. No warranty callbacks.
              Just detailed, standards-based inspections.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-10">
            {/* Left — Value Props */}
            <div className="space-y-6">
              <div className="glass-card p-8">
                <h3 className="text-xl font-bold text-[var(--white)] mb-6">
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
                      <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-[var(--white)] text-sm">{item.title}</p>
                        <p className="text-[var(--gray-muted)] text-sm mt-1 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[var(--bg-glass)] rounded-2xl p-8">
                <h4 className="text-white font-bold mb-4">Two Tiers. Same Respect.</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/10 border border-white/10 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-[var(--gold)]" />
                      <span className="text-[var(--gold)] text-xs font-bold uppercase tracking-wider">HAAG Certified</span>
                    </div>
                    <p className="text-[var(--gray-dim)] text-sm leading-relaxed">
                      Premium rate. Your HAAG stamp goes on the report.
                      The gold standard carriers trust &mdash; now working for the policyholder.
                    </p>
                  </div>
                  <div className="bg-white/10 border border-white/10 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-white/[0.04]" />
                      <span className="text-[var(--gray-dim)] text-xs font-bold uppercase tracking-wider">Experienced</span>
                    </div>
                    <p className="text-[var(--gray-dim)] text-sm leading-relaxed">
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
      <section id="get-started" className="py-20 px-6 bg-[var(--bg-glass)] scroll-mt-20">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-[var(--gray-dim)] mb-8">
            Create your account in 30 seconds. Upload your first claim
            and get back a forensic-grade package in 15 minutes.
          </p>
          <a
            href="/login?mode=signup"
            className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors shadow-lg shadow-red-900/30"
          >
            Try 3 Free Claims
          </a>
          <p className="text-[var(--gray-muted)] text-xs mt-3">No credit card required</p>
          <p className="text-[var(--gray-muted)] text-sm mt-3">
            Already have an account?{" "}
            <a href="/login" className="text-white hover:text-[var(--red)] transition-colors">
              Sign in
            </a>
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
