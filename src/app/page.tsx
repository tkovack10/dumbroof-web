"use client";

import { useState } from "react";

export default function Home() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleWaitlist = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <main className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--navy)]/95 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white text-lg">
              DR
            </div>
            <span className="text-white font-bold text-xl tracking-tight">
              dumb roof
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#how-it-works" className="text-gray-300 hover:text-white text-sm transition-colors hidden sm:block">
              How It Works
            </a>
            <a href="#results" className="text-gray-300 hover:text-white text-sm transition-colors hidden sm:block">
              Results
            </a>
            <a
              href="#waitlist"
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              Get Early Access
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block mb-6 px-4 py-1.5 rounded-full bg-white/10 border border-white/20">
            <span className="text-[var(--gold)] text-sm font-medium">
              Currently in Private Beta
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-tight mb-6">
            Stop leaving money
            <br />
            <span className="text-[var(--red)]">on the roof.</span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            Upload your source docs. Get a forensic-grade, code-cited appeal
            package back in 15 minutes. Built by roofers who got tired of
            carriers underpaying every claim.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <a
              href="#waitlist"
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors shadow-lg shadow-red-900/30"
            >
              Request Early Access
            </a>
            <a
              href="#how-it-works"
              className="border border-white/30 hover:border-white/60 text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
            >
              See How It Works
            </a>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {[
              { number: "$1.2M+", label: "Carrier Movement" },
              { number: "115%", label: "Avg. Claim Increase" },
              { number: "15 min", label: "Per Claim Package" },
              { number: "~$10", label: "Cost Per Claim" },
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

      {/* Problem / Solution */}
      <section className="py-20 px-6 bg-[var(--gray-50)]">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12">
            {/* Problem */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mb-5">
                <svg
                  className="w-6 h-6 text-[var(--red)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-[var(--navy)] mb-3">
                The Problem
              </h3>
              <ul className="space-y-3 text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-[var(--red)] mt-0.5">&#x2715;</span>
                  Carriers underpay every storm claim by 40-60%
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--red)] mt-0.5">&#x2715;</span>
                  Supplements take 1-3 months and cost $7,500-$30,000
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--red)] mt-0.5">&#x2715;</span>
                  5 out of 50 reps know how to fight a carrier scope
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--red)] mt-0.5">&#x2715;</span>
                  Estimate services write numbers &mdash; not arguments
                </li>
              </ul>
            </div>

            {/* Solution */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-[var(--navy)]/20">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mb-5">
                <svg
                  className="w-6 h-6 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-[var(--navy)] mb-3">
                The Dumb Roof Solution
              </h3>
              <ul className="space-y-3 text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">&#x2713;</span>
                  5-document forensic appeal package in 15 minutes
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">&#x2713;</span>
                  AI pairs building codes to specific photos to specific line items
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">&#x2713;</span>
                  Self-learning carrier playbooks &mdash; gets smarter every claim
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">&#x2713;</span>
                  Makes every rep look like a 20-year insurance veteran
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-6 bg-white scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] text-center mb-4">
            How It Works
          </h2>
          <p className="text-gray-500 text-center mb-14 max-w-xl mx-auto">
            Three steps. Fifteen minutes. A package that makes carriers take you
            seriously.
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Upload",
                desc: "Drop in your carrier scope, EagleView report, inspection photos, and HailTrace weather data.",
                icon: (
                  <svg
                    className="w-8 h-8 text-[var(--navy)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                    />
                  </svg>
                ),
              },
              {
                step: "02",
                title: "Process",
                desc: "AI reads every document, analyzes every photo, cross-references building codes, and builds your evidence chain.",
                icon: (
                  <svg
                    className="w-8 h-8 text-[var(--navy)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
                    />
                  </svg>
                ),
              },
              {
                step: "03",
                title: "Receive",
                desc: "Download 5 professional PDFs: forensic report, Xactimate estimate, supplement, appeal letter, and cover email.",
                icon: (
                  <svg
                    className="w-8 h-8 text-[var(--navy)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                ),
              },
            ].map((item) => (
              <div
                key={item.step}
                className="relative bg-[var(--gray-50)] rounded-2xl p-8 border border-gray-100 hover:border-[var(--navy)]/20 transition-colors"
              >
                <span className="absolute top-6 right-6 text-5xl font-bold text-gray-100">
                  {item.step}
                </span>
                <div className="mb-5">{item.icon}</div>
                <h3 className="text-xl font-bold text-[var(--navy)] mb-2">
                  {item.title}
                </h3>
                <p className="text-gray-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section className="py-20 px-6 bg-[var(--navy)]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-white text-center mb-4">
            The 5-Document Package
          </h2>
          <p className="text-gray-400 text-center mb-14 max-w-xl mx-auto">
            Every document is forensic-grade, code-cited, and built to make
            carriers move.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                num: "01",
                title: "Forensic Causation Report",
                desc: "Photo-annotated damage analysis with clinical forensic observations. Every finding tied to HAAG standards.",
              },
              {
                num: "02",
                title: "Xactimate Estimate",
                desc: "Line-item scope at current regional pricing. Every line item backed by building code citations.",
              },
              {
                num: "03",
                title: "Supplement Report",
                desc: "Line-by-line carrier vs. our scope. Exposes every underpayment, missed item, and pricing discrepancy.",
              },
              {
                num: "04",
                title: "Appeal Letter",
                desc: "Formal demand citing building codes, insurance regulations, and forensic evidence. Written to move adjusters.",
              },
              {
                num: "05",
                title: "Cover Email",
                desc: "Ready-to-send email with professional tone, attachment summary, and response deadline.",
              },
              {
                num: "++",
                title: "Carrier Intelligence",
                desc: "Every claim feeds self-learning playbooks. The system knows your carrier's tactics before you do.",
              },
            ].map((doc) => (
              <div
                key={doc.num}
                className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors"
              >
                <span className="text-[var(--red)] text-sm font-mono font-bold">
                  {doc.num}
                </span>
                <h4 className="text-white font-semibold mt-2 mb-2">
                  {doc.title}
                </h4>
                <p className="text-gray-400 text-sm leading-relaxed">
                  {doc.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Results */}
      <section id="results" className="py-20 px-6 bg-white scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--navy)] text-center mb-4">
            Real Results. Real Claims.
          </h2>
          <p className="text-gray-500 text-center mb-14 max-w-xl mx-auto">
            Not projections. Not estimates. Documented carrier movement from
            actual claims processed through the platform.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-14">
            {[
              {
                carrier: "Church Mutual",
                before: "$20,408",
                after: "$943,233",
                increase: "4,522%",
              },
              {
                carrier: "Allstate",
                before: "$81,170",
                after: "$120,312",
                increase: "48%",
              },
              {
                carrier: "Erie Insurance",
                before: "$32,048",
                after: "$72,145",
                increase: "125%",
              },
              {
                carrier: "Nationwide",
                before: "$77,019",
                after: "$122,155",
                increase: "59%",
              },
              {
                carrier: "Hanover",
                before: "$33,394",
                after: "$56,769",
                increase: "70%",
              },
              {
                carrier: "State Farm",
                before: "$37,669",
                after: "$80,963",
                increase: "115%",
              },
            ].map((result) => (
              <div
                key={result.carrier}
                className="bg-[var(--gray-50)] rounded-xl p-6 border border-gray-100"
              >
                <div className="text-sm font-semibold text-gray-500 mb-3">
                  {result.carrier}
                </div>
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="text-gray-400 line-through text-sm">
                    {result.before}
                  </span>
                  <span className="text-[var(--navy)] font-bold text-xl">
                    {result.after}
                  </span>
                </div>
                <div className="text-[var(--red)] font-bold text-sm">
                  +{result.increase}
                </div>
              </div>
            ))}
          </div>

          {/* Comparison Table */}
          <div className="bg-[var(--gray-50)] rounded-2xl p-8 border border-gray-100">
            <h3 className="text-xl font-bold text-[var(--navy)] mb-6 text-center">
              Dumb Roof vs. The Old Way
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-3 text-sm text-gray-500 font-medium"></th>
                    <th className="pb-3 text-sm text-gray-500 font-medium">
                      Traditional
                    </th>
                    <th className="pb-3 text-sm text-[var(--red)] font-bold">
                      Dumb Roof
                    </th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {[
                    ["Time per claim", "1-3 months", "15 minutes"],
                    ["Cost per claim", "$7,500 - $30,000", "~$10"],
                    ["Documents generated", "1 (maybe)", "5 professional PDFs"],
                    [
                      "Code citations",
                      "Rarely included",
                      "Every line item cited",
                    ],
                    [
                      "Photo forensics",
                      "Unlabeled photos",
                      "Annotated evidence chain",
                    ],
                    [
                      "Carrier intelligence",
                      "None",
                      "Self-learning playbooks",
                    ],
                    [
                      "Who can use it",
                      "Insurance specialists only",
                      "Any sales rep",
                    ],
                  ].map(([label, old, dr]) => (
                    <tr key={label} className="border-b border-gray-100">
                      <td className="py-3 font-medium text-gray-700">
                        {label}
                      </td>
                      <td className="py-3 text-gray-500">{old}</td>
                      <td className="py-3 font-semibold text-[var(--navy)]">
                        {dr}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" className="py-20 px-6 bg-[var(--navy)] scroll-mt-20">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Get Early Access
          </h2>
          <p className="text-gray-400 mb-10">
            We&apos;re onboarding contractors for private beta. Drop your email
            and we&apos;ll be in touch.
          </p>

          {!submitted ? (
            <form
              onSubmit={handleWaitlist}
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourcompany.com"
                className="flex-1 px-5 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--red)] transition-colors"
              />
              <button
                type="submit"
                className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3.5 rounded-xl font-semibold transition-colors whitespace-nowrap"
              >
                Join Beta
              </button>
            </form>
          ) : (
            <div className="bg-white/10 border border-white/20 rounded-xl p-6">
              <p className="text-white font-semibold text-lg">
                You&apos;re on the list.
              </p>
              <p className="text-gray-400 mt-1">
                We&apos;ll reach out when your spot opens up.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[var(--navy)] border-t border-white/10 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white text-sm">
              DR
            </div>
            <span className="text-gray-400 text-sm">
              Dumb Roof Technologies
            </span>
          </div>
          <p className="text-gray-500 text-sm">
            &copy; {new Date().getFullYear()} Dumb Roof Technologies. All
            rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
