"use client";

import { useState } from "react";
import { CoverageMap } from "@/components/coverage-map";
import { Footer } from "@/components/footer";

interface Props {
  activeStates: string[];
  isLoggedIn: boolean;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
];

const SPECIALTIES = ["Roofing", "Siding", "Water Damage", "Wind Damage", "Hail", "Fire", "Commercial", "Multi-Family"];

function PAApplicationForm() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company_name: "",
    license_number: "",
    states_covered: [] as string[],
    experience: "",
    specialties: [] as string[],
    notes: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.states_covered.length === 0) {
      setError("Please select at least one state.");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/pa-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleState = (st: string) => {
    setForm((prev) => ({
      ...prev,
      states_covered: prev.states_covered.includes(st)
        ? prev.states_covered.filter((s) => s !== st)
        : [...prev.states_covered, st],
    }));
  };

  const toggleSpecialty = (sp: string) => {
    setForm((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(sp)
        ? prev.specialties.filter((s) => s !== sp)
        : [...prev.specialties, sp],
    }));
  };

  const update = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  if (submitted) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-[var(--white)] mb-2">Application Received</h3>
        <p className="text-[var(--gray-muted)] mb-1">We&apos;ll review your application and reach out within 48 hours.</p>
        <p className="text-sm text-[var(--gray-dim)]">Welcome to the club, {form.name.split(" ")[0] || "Partner"}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card p-8 space-y-5">
      <h3 className="text-lg font-bold text-[var(--white)]">Apply to Join</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Full Name</label>
          <input type="text" required value={form.name} onChange={(e) => update("name", e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Phone</label>
          <input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Email</label>
        <input type="email" required value={form.email} onChange={(e) => update("email", e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Company Name</label>
          <input type="text" value={form.company_name} onChange={(e) => update("company_name", e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">License Number</label>
          <input type="text" value={form.license_number} onChange={(e) => update("license_number", e.target.value)}
            placeholder="PA license #"
            className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Experience</label>
        <select value={form.experience} onChange={(e) => update("experience", e.target.value)}
          className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none text-sm">
          <option value="">Select</option>
          <option value="1-3">1 - 3 years</option>
          <option value="3-5">3 - 5 years</option>
          <option value="5-10">5 - 10 years</option>
          <option value="10+">10+ years</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
          States Covered <span className="text-[var(--red)]">*</span>
        </label>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-3 bg-[var(--bg-input)] rounded-lg border border-[var(--border-glass)]">
          {US_STATES.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => toggleState(st)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                form.states_covered.includes(st)
                  ? "bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white"
                  : "bg-white/[0.06] text-[var(--gray)] hover:bg-white/[0.04]"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
        {form.states_covered.length > 0 && (
          <p className="text-xs text-[var(--gray-dim)] mt-1">{form.states_covered.length} state{form.states_covered.length > 1 ? "s" : ""} selected</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Specialties</label>
        <div className="flex flex-wrap gap-2">
          {SPECIALTIES.map((sp) => (
            <button
              key={sp}
              type="button"
              onClick={() => toggleSpecialty(sp)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                form.specialties.includes(sp)
                  ? "bg-purple-600 text-white"
                  : "bg-white/[0.06] text-[var(--gray)] hover:bg-white/[0.04]"
              }`}
            >
              {sp}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Notes</label>
        <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)}
          rows={3} placeholder="Tell us about your practice, certifications, or anything else."
          className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none text-sm resize-none" />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <button type="submit" disabled={submitting}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-semibold transition-colors">
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Submitting...
          </span>
        ) : "Submit Application"}
      </button>

      <p className="text-xs text-[var(--gray-dim)] text-center">We review every application within 48 hours.</p>
    </form>
  );
}

export function PAClubContent({ activeStates, isLoggedIn }: Props) {
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
            <a href="/inspection-club" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block">Inspector Club</a>
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
          <div className="inline-block mb-6 px-4 py-1.5 rounded-full bg-purple-500/20 border border-purple-500/30">
            <span className="text-purple-300 text-sm font-semibold">Public Adjusters &amp; Appraisers</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-tight mb-6">
            iHate<br />
            <span className="text-purple-400">DumbRoof-ers Club</span>
          </h1>
          <p className="text-lg sm:text-xl text-[var(--gray-dim)] max-w-2xl mx-auto mb-6 leading-relaxed">
            We&apos;re so good at documentation that PAs hate us. But actually, we want to work together.
            Join the marketplace and get free leads from DumbRoof platform users.
          </p>
          <p className="text-purple-400 font-semibold">Free iHate DumbRoof-ers Club t-shirt for every approved member.</p>
        </div>
      </section>

      {/* The Marketplace */}
      <section className="py-16 px-6 bg-white/[0.03]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-12">How the Marketplace Works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              { step: "01", title: "Sign Up", desc: "Tell us which states you cover, your specialties, and your license info." },
              { step: "02", title: "Get Matched", desc: "DumbRoof users who need a PA or appraiser in your area get matched to you." },
              { step: "03", title: "Handle Advocacy", desc: "You handle the insurance advocacy side. The contractor handles the physical work." },
              { step: "04", title: "AI Pipeline", desc: "DumbRoof processes the claim through the AI pipeline — forensic reports make your job easier." },
            ].map((item) => (
              <div key={item.step} className="glass-card p-6 relative">
                <span className="absolute top-4 right-4 text-4xl font-bold text-[var(--gray-dim)]">{item.step}</span>
                <h3 className="text-lg font-bold text-[var(--white)] mb-2">{item.title}</h3>
                <p className="text-[var(--gray)] text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Join */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-12">Why Join</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              { title: "Free leads from the platform", desc: "Contractors using DumbRoof need PAs and appraisers. We connect them to you — no cold calling, no marketing spend." },
              { title: "AI reports make your job easier", desc: "Our forensic reports, code citations, and photo annotations give you a head start on every claim. Less research, more advocacy." },
              { title: "Free to join", desc: "No upfront cost. No monthly fee. Join the network and start receiving match requests in your coverage area." },
              { title: "Platform supports PA compliance mode", desc: "DumbRoof already generates documents with full advocacy language for PAs and attorneys. No compliance worries." },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3 bg-purple-500/10 rounded-xl p-6 border border-purple-500/20">
                <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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

      {/* Three-Way Marketplace */}
      <section className="py-16 px-6 bg-[var(--bg-glass)]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-10">The Three-Way Marketplace</h2>
          <div className="flex flex-wrap justify-center items-center gap-4 mb-6">
            <div className="w-28 h-28 rounded-full bg-blue-500/10 border-[3px] border-blue-500 flex flex-col items-center justify-center text-xs font-bold text-blue-400 text-center">
              Contractor
              <span className="text-[9px] font-normal mt-0.5">Uploads claims</span>
            </div>
            <span className="text-2xl text-white/40">&harr;</span>
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border-[3px] border-amber-400 flex flex-col items-center justify-center text-sm font-extrabold text-white text-center">
              Dumb Roof
              <span className="text-[9px] text-amber-400 font-semibold">AI Pipeline</span>
            </div>
            <span className="text-2xl text-white/40">&harr;</span>
            <div className="w-28 h-28 rounded-full bg-purple-500/10 border-[3px] border-purple-500 flex flex-col items-center justify-center text-xs font-bold text-purple-400 text-center">
              Public Adj.
              <span className="text-[9px] font-normal mt-0.5">Advocacy</span>
            </div>
          </div>
          <div className="text-center text-white/40 text-xl mb-4">&uarr;</div>
          <div className="flex justify-center mb-6">
            <div className="w-28 h-28 rounded-full bg-amber-500/10 border-[3px] border-amber-500 flex flex-col items-center justify-center text-xs font-bold text-amber-400 text-center">
              Inspector
              <span className="text-[9px] font-normal mt-0.5">$300/job</span>
            </div>
          </div>
          <p className="text-center text-[var(--gray-dim)] text-sm">Each side makes the other more valuable. Contractors get better claims. PAs get AI-backed documentation. Inspectors get above-market pay.</p>
        </div>
      </section>

      {/* Coverage Map */}
      <section className="py-16 px-6 bg-white/[0.03]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-8">PA Coverage Map</h2>
          <CoverageMap activeStates={activeStates} />
          <p className="text-center text-sm text-[var(--gray-muted)] mt-4">
            {activeStates.length > 0
              ? `PAs active in ${activeStates.length} state${activeStates.length > 1 ? "s" : ""}. Growing every week.`
              : "Recruiting PAs in all 50 states. Be the first in yours."}
          </p>
        </div>
      </section>

      {/* For Contractors */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-[var(--white)] mb-4">For Contractors</h2>
          <p className="text-[var(--gray)] leading-relaxed mb-8">
            Need a PA for your claim? We&apos;ll connect you with a licensed public adjuster
            in the homeowner&apos;s state. They handle the insurance advocacy while you handle
            the physical work. DumbRoof processes the claim through the AI pipeline — everyone wins.
          </p>
          <a href="/signup" className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-3 rounded-xl font-semibold transition-colors">
            Get Started
          </a>
        </div>
      </section>

      {/* Sign Up CTA */}
      <section id="apply" className="py-16 px-6 bg-white/[0.03] scroll-mt-20">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--white)] text-center mb-8">Join the Club</h2>
          {isLoggedIn ? (
            <PAApplicationForm />
          ) : (
            <div className="glass-card p-8 text-center">
              <h3 className="text-lg font-bold text-[var(--white)] mb-3">Create an account to apply</h3>
              <p className="text-[var(--gray-muted)] text-sm mb-6">Sign up for a free DumbRoof account, then come back to submit your PA application.</p>
              <a
                href="/signup?next=/pa-club"
                className="inline-block bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
              >
                Create Account
              </a>
              <p className="text-sm text-[var(--gray-dim)] mt-4">
                Already have an account? <a href="/login?redirect=/pa-club" className="text-[var(--white)] hover:underline">Sign in</a>
              </p>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
