import { unstable_cache } from "next/cache";
import { HeroSignupForm } from "@/components/hero-signup-form";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const metadata = {
  title: "Complex workflow made easy. — DumbRoof",
  description:
    "Upload photos → forensic report. Add measurements → Xactimate-style scope. Add insurance scope → supplement automation. 3 free claims, no card.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function fmtBigMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M+`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K+`;
  return `$${val.toLocaleString()}`;
}

const getStats = unstable_cache(
  async () => {
    try {
      const [webClaims, webWins, localClaims, localWins] = await Promise.all([
        supabaseAdmin.from("claims").select("contractor_rcv"),
        supabaseAdmin.from("claims").select("settlement_amount").eq("claim_outcome", "won"),
        supabaseAdmin.from("claim_outcomes").select("usarm_rcv").eq("source", "cli"),
        supabaseAdmin.from("claim_outcomes").select("settlement_amount").eq("source", "cli").eq("win", true),
      ]);
      const rcv =
        (webClaims.data || []).reduce((s, c) => s + (c.contractor_rcv ?? 0), 0) +
        (localClaims.data || []).reduce((s, c) => s + (c.usarm_rcv ?? 0), 0);
      const won =
        (webWins.data || []).reduce((s, c) => s + (c.settlement_amount ?? 0), 0) +
        (localWins.data || []).reduce((s, c) => s + (c.settlement_amount ?? 0), 0);
      return { processed: fmtBigMoney(rcv), approved: fmtBigMoney(won) };
    } catch {
      return { processed: "$6.9M+", approved: "$2.0M+" };
    }
  },
  ["fb-landing-stats"],
  { revalidate: 300, tags: ["hero-stats"] }
);

export default async function FbLanding() {
  const stats = await getStats();

  return (
    <main className="min-h-screen bg-[var(--navy)]">
      {/* Minimal top bar — logo only, no nav */}
      <header className="absolute top-0 left-0 right-0 z-10 px-6 py-5">
        <span className="text-2xl font-extrabold tracking-tight gradient-text">
          dumbroof<span className="font-normal opacity-70">.ai</span>
        </span>
      </header>

      {/* Hero */}
      <section className="relative pt-24 pb-12 px-5 bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
        <div className="max-w-xl mx-auto text-center">
          <div className="inline-block mb-5 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
            <span className="text-green-400 text-sm font-semibold">
              3 Free Claims &mdash; No Credit Card
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--gray-dim)] leading-tight mb-6">
            Complex workflow, <span className="gradient-text font-bold">made easy.</span>
          </h1>

          <div className="mb-8 space-y-3 text-left sm:text-center">
            <div className="text-xl sm:text-2xl font-bold text-white leading-tight">
              Photos <span className="text-[var(--gray-muted)] font-normal mx-1">=</span> <span className="gradient-text">Forensic Report.</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white leading-tight">
              <span className="text-[var(--gray-muted)] font-normal">+</span> Measurements <span className="text-[var(--gray-muted)] font-normal mx-1">=</span> <span className="gradient-text">Build Scope.</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white leading-tight">
              <span className="text-[var(--gray-muted)] font-normal">+</span> Carrier Scope <span className="text-[var(--gray-muted)] font-normal mx-1">=</span> <span className="gradient-text">Supplement.</span>
            </div>
          </div>

          <p className="text-sm text-[var(--gray-muted)] mb-8 italic">
            Start with what you have. Add more. Go further.
          </p>

          <div className="mb-6">
            <HeroSignupForm source="fb_landing" />
          </div>

          <a
            href="/sample/forensic-report-sample.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-[var(--cyan)] hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            See a Sample Report
          </a>
        </div>
      </section>

      {/* Proof row */}
      <section className="px-5 py-10 bg-white/[0.02] border-y border-white/10">
        <div className="max-w-xl mx-auto grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-white">{stats.processed}</div>
            <div className="text-xs text-[var(--gray-dim)] mt-1 uppercase tracking-wider">Claims Processed</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-white">{stats.approved}</div>
            <div className="text-xs text-[var(--gray-dim)] mt-1 uppercase tracking-wider">Approved Supplements</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-white">5&nbsp;min</div>
            <div className="text-xs text-[var(--gray-dim)] mt-1 uppercase tracking-wider">Avg Time to Report</div>
          </div>
        </div>
      </section>

      {/* Value ladder — each input unlocks the next document */}
      <section className="px-5 py-14">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-3">
            Start where you are.
          </h2>
          <p className="text-[var(--gray-dim)] text-center mb-10 text-sm">
            Every input unlocks the next deliverable. Stop whenever &mdash; or add more to go further.
          </p>

          <div className="space-y-5">
            {[
              {
                step: "1",
                input: "Upload inspection photos",
                output: "Forensic Causation Report",
                body: "AI annotates every photo, identifies damage type, cites building codes, and writes the narrative. PDF ready to hand the homeowner or adjuster.",
                accent: "from-[var(--pink)] to-[var(--purple)]",
              },
              {
                step: "2",
                input: "Add measurements (EagleView, HOVER, etc.)",
                output: "Xactimate-Style Build Scope",
                body: "Full line-item estimate with current market pricing — roofing, underlayments, flashings, gutters, siding. O&P auto-applied when 3+ trades.",
                accent: "from-[var(--purple)] to-[var(--blue)]",
              },
              {
                step: "3",
                input: "Add the insurance scope",
                output: "Supplement Automation",
                body: "AI finds every missing line, shorted quantity, and code violation the carrier ignored — then composes the supplement email and attaches the evidence package.",
                accent: "from-[var(--blue)] to-[var(--cyan)]",
              },
            ].map((s) => (
              <div key={s.step} className="relative rounded-2xl bg-white/[0.03] border border-white/10 p-5 sm:p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`shrink-0 w-9 h-9 rounded-full bg-gradient-to-br ${s.accent} flex items-center justify-center text-white font-bold`}>
                    {s.step}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs uppercase tracking-wider text-[var(--gray-muted)] mb-0.5">You add</div>
                    <div className="text-white font-semibold text-sm sm:text-base leading-tight">{s.input}</div>
                  </div>
                </div>
                <div className="pl-12">
                  <div className="text-xs uppercase tracking-wider text-[var(--gray-muted)] mb-1">AI delivers</div>
                  <div className="text-lg font-bold gradient-text mb-2">{s.output}</div>
                  <p className="text-[var(--gray-dim)] leading-relaxed text-sm">{s.body}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-[var(--gray-muted)] mt-8">
            All three deliverables included with every claim. No upsells, no tiers.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-5 py-12 bg-gradient-to-b from-[var(--navy)] to-[var(--navy-light)]">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Start with photos. Go as far as you want.
          </h2>
          <p className="text-[var(--gray-dim)] mb-6">
            First 3 claims are on us. No card. Cancel anytime.
          </p>
          <HeroSignupForm source="fb_landing_bottom" />
        </div>
      </section>

      {/* Minimal footer links */}
      <footer className="px-5 py-6 text-center text-xs text-[var(--gray-muted)] border-t border-white/10">
        <div className="max-w-xl mx-auto flex items-center justify-center gap-4">
          <a href="/terms" className="hover:text-white">Terms</a>
          <span>&middot;</span>
          <a href="/privacy" className="hover:text-white">Privacy</a>
          <span>&middot;</span>
          <span>&copy; 2026 Dumb Roof Technologies</span>
        </div>
      </footer>
    </main>
  );
}
