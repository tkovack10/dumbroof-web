"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Footer } from "@/components/footer";
import { PLANS, ADD_ONS, type PlanId } from "@/lib/stripe-config";

export default function PricingPage() {
  return <Suspense><PricingContent /></Suspense>;
}

function PricingContent() {
  const [loading, setLoading] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const searchParams = useSearchParams();
  const coupon = searchParams.get("coupon") || undefined;

  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setIsLoggedIn(true);
    });
  }, []);

  const handleCheckout = async (params: { planId?: PlanId; addOnId?: string }) => {
    setLoading(params.planId || params.addOnId || null);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, coupon }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      } else if (res.status === 401) {
        window.location.href = "/login?mode=signup&redirect=/pricing";
        return;
      } else {
        setCheckoutError(data.error || "Failed to create checkout session");
      }
    } catch {
      setCheckoutError("Network error — please try again");
    }
    setLoading(null);
  };

  const planOrder: PlanId[] = ["starter", "sales_rep", "pro", "growth", "enterprise"];

  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs text-lg">
              DR
            </div>
            <span className="text-white font-bold text-xl tracking-tight">
              dumb roof<sup className="text-[10px] font-medium align-super ml-0.5">&trade;</sup>
            </span>
          </a>
          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <a
                href="/dashboard"
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                Dashboard
              </a>
            ) : (
              <>
                <a href="/login" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">
                  Sign In
                </a>
                <a
                  href="/login?mode=signup"
                  className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  Create Account
                </a>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Header */}
      <section className="pt-20 pb-10 px-6 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--white)] mb-4">
          Simple, Transparent Pricing
        </h1>
        <p className="text-[var(--gray-muted)] max-w-xl mx-auto text-lg">
          Start free. Upgrade when you need more claims.
          Every plan includes the full 6-document forensic package.
        </p>
      </section>

      {/* Plans Grid */}
      <section className="pb-20 px-6">
        <div className="max-w-6xl mx-auto grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {planOrder.map((id) => {
            const plan = PLANS[id];
            const isPopular = id === "growth";
            const isLimitedOffer = id === "sales_rep";
            return (
              <div
                key={id}
                className={`relative rounded-2xl p-6 border flex flex-col ${
                  isPopular
                    ? "border-[var(--red)] bg-[var(--red)]/10 shadow-[var(--shadow-card)]"
                    : "glass-card"
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[var(--red)] text-white text-xs font-bold px-3 py-1 rounded-full">
                    Most Popular
                  </div>
                )}
                {isLimitedOffer && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[var(--pink)] to-[var(--cyan)] text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    Limited Time Offer
                  </div>
                )}
                <h3 className="text-lg font-bold text-[var(--white)]">
                  {plan.name}
                </h3>
                <div className="mt-3 mb-4">
                  <span className="text-4xl font-bold text-[var(--white)]">
                    ${plan.price}
                  </span>
                  {plan.price > 0 && (
                    <span className="text-[var(--gray-muted)] text-sm">/mo</span>
                  )}
                </div>
                <p className="text-sm text-[var(--gray-muted)] mb-2">
                  {id === "starter"
                    ? "3 claims, free forever"
                    : id === "sales_rep"
                    ? "$25 per claim, pay as you go"
                    : `${plan.claimsPerMonth} claims per month${plan.includedUsers ? ` · ${plan.includedUsers} users` : ""}`}
                </p>
                {id === "starter" && (
                  <p className="text-xs text-green-400 font-semibold mb-4">No credit card required</p>
                )}
                {id !== "starter" && <div className="mb-4" />}
                <ul className="space-y-2 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-[var(--gray)]">
                      <svg
                        className="w-4 h-4 text-green-500 mt-0.5 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {id === "starter" ? (
                  <a
                    href="/login?mode=signup"
                    className="block text-center bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white py-3 rounded-xl font-semibold transition-colors text-sm"
                  >
                    Try 3 Free Claims
                  </a>
                ) : (
                  <button
                    onClick={() => handleCheckout({ planId: id })}
                    disabled={loading === id}
                    className={`w-full py-3 rounded-xl font-semibold transition-colors text-sm disabled:opacity-50 ${
                      isPopular
                        ? "bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white"
                        : "bg-white/5 border border-white/10 text-[var(--white)] hover:bg-white/10"
                    }`}
                  >
                    {loading === id ? "Redirecting..." : "Subscribe"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Checkout error */}
        {checkoutError && (
          <div className="max-w-md mx-auto mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
            <p className="text-sm text-red-400">{checkoutError}</p>
          </div>
        )}

        {/* HAAG Inspection Add-On */}
        {ADD_ONS.length > 0 && (
          <div className="max-w-3xl mx-auto mt-16">
            <h2 className="text-2xl font-bold text-[var(--white)] text-center mb-2">
              Premium Services
            </h2>
            <p className="text-center text-[var(--gray-muted)] text-sm mb-8">
              Stand out from AI slop. Real boots on the roof.
            </p>
            <div className="grid grid-cols-1 gap-6">
              {ADD_ONS.map((addOn) => (
                <div
                  key={addOn.id}
                  className="relative rounded-2xl border border-[var(--pink)]/30 bg-gradient-to-br from-[var(--pink)]/[0.04] to-[var(--blue)]/[0.04] p-8"
                >
                  <div className="absolute -top-3 left-6">
                    <span className="bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                      HAAG Certified
                    </span>
                  </div>
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-[var(--white)] mb-2">{addOn.name}</h3>
                      <p className="text-sm text-[var(--gray-muted)] mb-4">{addOn.description}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {addOn.features.map((f) => (
                          <div key={f} className="flex items-center gap-2 text-sm text-[var(--gray)]">
                            <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            {f}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-center md:text-right shrink-0">
                      <div className="text-4xl font-bold text-[var(--white)]">
                        ${addOn.price}
                      </div>
                      <p className="text-xs text-[var(--gray-muted)] mb-4">one-time per inspection</p>
                      <button
                        onClick={() => handleCheckout({ addOnId: addOn.id })}
                        disabled={loading === addOn.id}
                        className="px-8 py-3 rounded-xl bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {loading === addOn.id ? "Redirecting..." : "Book Inspection"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inspector Club CTA */}
        <div className="max-w-3xl mx-auto mt-16">
          <div className="relative rounded-2xl border border-[var(--cyan)]/30 bg-gradient-to-br from-[var(--cyan)]/[0.04] to-transparent p-8">
            <div className="absolute -top-3 left-6">
              <span className="bg-[var(--cyan)] text-[var(--bg-dark)] text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                Free to Join
              </span>
            </div>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-[var(--white)] mb-2">
                  DumbRoof Inspection Club
                </h3>
                <p className="text-sm text-[var(--gray-muted)] mb-4">
                  HAAG-certified inspector? Earn <span className="text-[var(--cyan)] font-semibold">$300+ per inspection</span> on
                  your own schedule. No commitment, no fees. Set your coverage area and get notified when
                  an inspection is booked in your market. Accept the jobs you want — first come, first serve.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    "Set your own coverage area",
                    "$300+ per completed inspection",
                    "No monthly fees or commitments",
                    "Accept or pass on every job",
                    "Get paid via Stripe direct deposit",
                    "Grow your network & referrals",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-sm text-[var(--gray)]">
                      <svg className="w-4 h-4 text-[var(--cyan)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-center md:text-right shrink-0">
                <div className="text-4xl font-bold text-[var(--white)]">
                  Free
                </div>
                <p className="text-xs text-[var(--gray-muted)] mb-4">no cost to join</p>
                <a
                  href="/inspection-club"
                  className="inline-block px-8 py-3 rounded-xl bg-[var(--cyan)]/10 border border-[var(--cyan)]/30 text-[var(--cyan)] text-sm font-semibold hover:bg-[var(--cyan)]/20 transition-all"
                >
                  Join the Inspection Club
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ-ish note */}
        <div className="max-w-2xl mx-auto mt-12 text-center">
          <p className="text-[var(--gray-muted)] text-sm">
            All plans include the full 6-document forensic package, AI photo analysis,
            and company branding. Cancel anytime from your dashboard.
            Need more than 100 claims/month?{" "}
            <a href="mailto:TKovack@USARoofMasters.com" className="text-[var(--red)] font-medium hover:underline">
              Contact us
            </a>.
          </p>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto mt-16">
          <h2 className="text-2xl font-bold text-[var(--white)] text-center mb-8">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            {[
              {
                q: "How does it work? What do I need to get started?",
                a: "Upload your inspection photos and roof measurements (EagleView, HOVER, etc.) — that's it. You can even connect CompanyCam to pull photos directly. No onboarding, no training, no setup calls. Upload and go.",
              },
              {
                q: "I've never done storm damage claims before. Can I still use this?",
                a: "Absolutely — that's exactly who this is built for. Our AI Claim Brain walks you through every step: what hail damage looks like, what wind damage looks like, what line items to include, what codes apply, and how to respond to the carrier. Think of it as having a 20-year supplement expert sitting next to you on every claim.",
              },
              {
                q: "How fast do I get my documents back?",
                a: "Most claim packages are ready in 2-5 minutes after upload. You get a full forensic causation report, itemized estimate, code compliance report, scope comparison, and cover letter — all generated from your photos and measurements.",
              },
              {
                q: "What makes this different from other supplement services?",
                a: "Two things: speed and intelligence. Traditional supplement services take days and charge per claim. We deliver in minutes, and our AI learns from every claim — every carrier tactic, every denied line item, every successful argument. Plus, you can add a real HAAG-certified inspection for $500 when you need boots on the roof.",
              },
              {
                q: "Do I need to know building codes or Xactimate pricing?",
                a: "No. The AI automatically applies the correct building codes for your state (RCNYS for New York, IRC for PA/NJ), calculates Xactimate-style pricing using current regional rates for your ZIP code, and flags every code violation the carrier missed.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. No contracts, no cancellation fees. Cancel directly from your dashboard. Your 3 free claims on the Starter plan never expire.",
              },
              {
                q: "Is my data secure?",
                a: "All documents are encrypted in transit and at rest. Your claim data is never shared with carriers, competitors, or third parties. Each company's data is completely isolated.",
              },
            ].map((faq) => (
              <div key={faq.q} className="glass-card p-5">
                <h3 className="text-sm font-semibold text-[var(--white)] mb-2">{faq.q}</h3>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
