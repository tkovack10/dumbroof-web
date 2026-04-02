"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Footer } from "@/components/footer";
import { PLANS, ADD_ONS, type PlanId } from "@/lib/stripe-config";

export default function PricingPage() {
  return <Suspense><PricingContent /></Suspense>;
}

function PricingContent() {
  const [loading, setLoading] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const coupon = searchParams.get("coupon") || undefined;

  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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
            <a href="/login" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">
              Sign In
            </a>
            <a
              href="/login?mode=signup"
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              Create Account
            </a>
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
                        : "bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white"
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
            <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
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
                q: "Do I need an Xactimate license?",
                a: "No. Our AI generates Xactimate-style line items with current regional pricing. You upload your documents, we handle the rest.",
              },
              {
                q: "What documents do I need to get started?",
                a: "At minimum: roof measurements (EagleView, HOVER, etc.) and inspection photos. If you have a carrier scope, upload that too for a full supplement package.",
              },
              {
                q: "How long does it take?",
                a: "Most claim packages are ready in 2-5 minutes after upload. Complex claims with 100+ photos may take slightly longer.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. Cancel directly from your dashboard settings. No contracts, no cancellation fees.",
              },
              {
                q: "Is my data secure?",
                a: "All documents are encrypted in transit and at rest. We never share your claim data with carriers or third parties.",
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
