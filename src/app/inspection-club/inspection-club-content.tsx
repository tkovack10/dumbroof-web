"use client";

import { CoverageMap } from "@/components/coverage-map";
import { InspectorApplicationForm } from "@/components/inspector-application-form";
import { Footer } from "@/components/footer";

interface Props {
  activeStates: string[];
  isLoggedIn: boolean;
}

export function InspectionClubContent({ activeStates, isLoggedIn }: Props) {
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs text-lg">DR</div>
            <span className="text-white font-bold text-xl tracking-tight">
              dumb roof<sup className="text-[10px] font-medium align-super ml-0.5">&trade;</sup>
            </span>
          </a>
          <div className="flex items-center gap-4">
            <a href="/pa-club" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block">PA Club</a>
            <a href="/pricing" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block">Pricing</a>
            {isLoggedIn ? (
              <a href="/dashboard" className="text-[var(--gray-dim)] hover:text-white text-sm font-medium transition-colors">Dashboard</a>
            ) : (
              <a href="/login" className="text-[var(--gray-dim)] hover:text-white text-sm font-medium transition-colors">Sign In</a>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-20 pb-16 px-6 bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block mb-6 px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30">
            <span className="text-amber-400 text-sm font-semibold">Now Recruiting Nationwide</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-tight mb-6">
            DumbRoof<br />
            <span className="text-[var(--red)]">Inspection Club</span>
          </h1>
          <p className="text-lg sm:text-xl text-[var(--gray-dim)] max-w-2xl mx-auto mb-6 leading-relaxed">
            Join the forensic evidence network. Get paid $300/inspection &mdash; 3x the market rate.
            Just inspect, document, and get paid. No construction. No callbacks. No headaches.
          </p>
          <p className="text-amber-400 font-semibold">Free DumbRoof Inspection Club t-shirt for every approved inspector.</p>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-6 bg-white/[0.03]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Sign Up", desc: "Tell us your coverage area, experience level, and HAAG certification status. We review every application within 48 hours." },
              { step: "02", title: "Choose Inspections", desc: "Inspection requests appear in your area. Accept what works for your schedule. $300 per inspection — no quotas, no mandatory availability." },
              { step: "03", title: "Inspect & Upload", desc: "Follow the DumbRoof inspection template, take photos, document damage. Upload everything into dumbroof.ai — our AI generates the forensic report." },
            ].map((item) => (
              <div key={item.step} className="glass-card p-8 relative">
                <span className="absolute top-6 right-6 text-5xl font-bold text-[var(--gray-dim)]">{item.step}</span>
                <h3 className="text-xl font-bold text-[var(--white)] mb-3">{item.title}</h3>
                <p className="text-[var(--gray)] text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Join */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-12">Why Join the Inspection Club</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              { title: "$300 per inspection", desc: "3x the market rate. Hancock pays $80-100. Seek Now pays $75-150. We pay $300 — because policyholder-side inspections deserve policyholder-side pay." },
              { title: "Choose your own jobs", desc: "No quotas, no mandatory availability windows. Accept what works for your schedule, decline what doesn't. True gig-style flexibility." },
              { title: "No construction liability", desc: "You're not the contractor. You don't build anything, warranty anything, or manage crews. When the phone rings 6 months later — it's not your phone." },
              { title: "Free t-shirt", desc: "Every approved inspector gets a free DumbRoof Inspection Club t-shirt. Wear it on inspections. Wear it to the bar. We don't care." },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3 bg-white/[0.05] rounded-xl p-6 border border-[var(--border-glass)]">
                <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="font-bold text-[var(--white)] mb-1">{item.title}</p>
                  <p className="text-[var(--gray)] text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Competitive Comparison */}
      <section className="py-16 px-6 bg-white/[0.03]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-8">Pay Comparison</h2>
          <div className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.04] border-b border-white/[0.04]">
                  <th className="text-left px-6 py-3 text-xs font-bold text-[var(--gray-muted)] uppercase">Company</th>
                  <th className="text-left px-6 py-3 text-xs font-bold text-[var(--gray-muted)] uppercase">Pay / Inspection</th>
                  <th className="text-left px-6 py-3 text-xs font-bold text-[var(--gray-muted)] uppercase">Side</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { company: "Hancock Claims", pay: "$80 - $100", side: "Carrier" },
                  { company: "Seek Now", pay: "$75 - $150", side: "Carrier" },
                  { company: "Pilot Catastrophe", pay: "$50 - $100", side: "Carrier" },
                ].map((r) => (
                  <tr key={r.company} className="border-b border-white/[0.04]">
                    <td className="px-6 py-3">{r.company}</td>
                    <td className="px-6 py-3 text-[var(--gray)]">{r.pay}</td>
                    <td className="px-6 py-3 text-[var(--gray-muted)]">{r.side}</td>
                  </tr>
                ))}
                <tr className="bg-amber-500/10 border-t-2 border-amber-500/40">
                  <td className="px-6 py-3 font-bold text-[var(--white)]">DumbRoof Inspection Club</td>
                  <td className="px-6 py-3 font-extrabold text-amber-400 text-lg">$300</td>
                  <td className="px-6 py-3 font-semibold text-green-400">Policyholder</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Coverage Map */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-8">Coverage Map</h2>
          <CoverageMap activeStates={activeStates} />
          <p className="text-center text-sm text-[var(--gray-muted)] mt-4">
            {activeStates.length > 0
              ? `Active in ${activeStates.length} state${activeStates.length > 1 ? "s" : ""}. Growing every week.`
              : "Recruiting in all 50 states. Be the first in yours."}
          </p>
        </div>
      </section>

      {/* Requirements */}
      <section className="py-16 px-6 bg-white/[0.03]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-8">What We Expect</h2>
          <div className="glass-card p-8 space-y-4">
            {[
              "Follow the DumbRoof inspection template",
              "Upload photos and measurements into dumbroof.ai",
              "Complete inspection within 48 hours of accepting",
              "Carry valid 1099 insurance",
              "Professional communication with homeowners",
            ].map((req) => (
              <div key={req} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-[var(--bg-deep)] flex items-center justify-center shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-[var(--gray)] text-sm">{req}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sign Up CTA */}
      <section id="apply" className="py-16 px-6 scroll-mt-20">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-8">Join the Network</h2>
          {isLoggedIn ? (
            <InspectorApplicationForm />
          ) : (
            <div className="glass-card p-8 text-center">
              <h3 className="text-lg font-bold text-[var(--white)] mb-3">Create an account to apply</h3>
              <p className="text-[var(--gray-muted)] text-sm mb-6">Sign up for a free DumbRoof account, then come back to submit your inspector application.</p>
              <a
                href="/login?mode=signup&redirect=/inspection-club"
                className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-3 rounded-xl font-semibold transition-colors"
              >
                Create Account
              </a>
              <p className="text-sm text-[var(--gray-dim)] mt-4">
                Already have an account? <a href="/login?redirect=/inspection-club" className="text-[var(--white)] hover:underline">Sign in</a>
              </p>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
