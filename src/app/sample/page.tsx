import { HomeNav } from "@/components/home-nav";
import { Footer } from "@/components/footer";
import { getDeviceContext } from "@/lib/device-detection";

// MUST be dynamic — UA-based CTA at the bottom (mobile vs desktop link).
// ISR would cache the first request's HTML for everyone.
export const dynamic = "force-dynamic";

/**
 * Sample report preview page — NO signup wall.
 *
 * The whole point: let warm Meta retargeting traffic and curious cold
 * traffic experience the actual product output before being asked to
 * commit. Today's retargeting cost-per-trial is $118.61 because users
 * have to sign up before seeing what they're getting.
 *
 * Embeds the sample forensic report PDF directly. Mobile users can
 * scroll through the entire 5-doc package on their phone.
 */
export default async function SamplePage() {
  const device = await getDeviceContext();
  // Mobile in-app browser users get a "save my spot" CTA at the bottom
  // (matches the homepage strategy from Phase 1.3)
  const ctaHref = device.isInAppBrowser ? "/?from=sample" : "/signup?next=/dashboard/new-claim";

  return (
    <main className="min-h-screen bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
      <HomeNav />

      <section className="pt-28 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <div className="inline-block mb-4 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
              <span className="text-green-400 text-sm font-semibold">
                No Signup Required
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight mb-4">
              See exactly what dumbroof.ai produces.
            </h1>
            <p className="text-base sm:text-lg text-[var(--gray-dim)] max-w-2xl mx-auto">
              Real claim. Real photos. Real Xactimate format. Real RCNYS code citations.
              This is the forensic report we generated for a 14-square hail claim in 5 minutes.
            </p>
          </div>

          {/* What we received → What we produced */}
          <div className="grid md:grid-cols-2 gap-4 mb-10">
            <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-6">
              <p className="text-xs uppercase tracking-wider text-[var(--gray-muted)] font-semibold mb-2">
                What the contractor uploaded
              </p>
              <ul className="space-y-2 text-sm text-[var(--gray-dim)]">
                <li className="flex items-start gap-2">
                  <span className="text-[var(--cyan)] mt-0.5">✓</span>
                  <span>1 EagleView measurement report (PDF)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--cyan)] mt-0.5">✓</span>
                  <span>47 inspection photos (CompanyCam ZIP)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--cyan)] mt-0.5">✓</span>
                  <span>Carrier scope of loss (PDF)</span>
                </li>
              </ul>
              <p className="text-xs text-[var(--gray-muted)] mt-4">Total upload time: ~2 minutes</p>
            </div>

            <div className="bg-gradient-to-br from-[var(--pink)]/10 via-[var(--purple)]/10 to-[var(--blue)]/10 border border-[var(--pink)]/30 rounded-2xl p-6">
              <p className="text-xs uppercase tracking-wider text-[var(--pink)] font-semibold mb-2">
                What dumbroof.ai produced
              </p>
              <ul className="space-y-2 text-sm text-[var(--gray-dim)]">
                <li className="flex items-start gap-2">
                  <span className="text-[var(--pink)] mt-0.5">→</span>
                  <span>Forensic Causation Report (47 annotated photos)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--pink)] mt-0.5">→</span>
                  <span>Xactimate-style Estimate ($31,847 RCV)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--pink)] mt-0.5">→</span>
                  <span>Scope Comparison Report (carrier underscoped by $4,212)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--pink)] mt-0.5">→</span>
                  <span>Scope Clarification Letter</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--pink)] mt-0.5">→</span>
                  <span>Cover Email (carrier-ready)</span>
                </li>
              </ul>
              <p className="text-xs text-[var(--pink)] mt-4 font-semibold">Generated in 4 min 38 sec</p>
            </div>
          </div>

          {/*
            Mobile: iOS Safari doesn't render PDF iframes inline — the viewer
            shows a blank white rectangle. We render a clickable "open PDF"
            card instead. Desktop keeps the inline iframe.
          */}
          {device.isMobile ? (
            <a
              href="/sample/forensic-report-sample.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/[0.1] rounded-2xl overflow-hidden mb-10 active:scale-[0.99] transition-transform"
            >
              {/* Visual mockup of the PDF cover */}
              <div className="bg-gradient-to-br from-[var(--navy-light)] to-[var(--navy)] px-6 py-10 border-b border-white/[0.1]">
                <div className="max-w-[280px] mx-auto bg-white rounded-lg shadow-2xl overflow-hidden">
                  {/* Fake PDF page preview — styled to look like the real thing */}
                  <div className="bg-gradient-to-b from-slate-900 to-slate-800 px-5 py-4 text-white">
                    <div className="text-[9px] font-bold tracking-wider opacity-70 mb-1">
                      DUMBROOF.AI · FORENSIC REPORT
                    </div>
                    <div className="text-[11px] font-bold leading-tight">
                      Forensic Causation Report
                    </div>
                    <div className="text-[8px] opacity-60 mt-1">14-square hail claim · 47 photos</div>
                  </div>
                  <div className="px-5 py-4 space-y-2">
                    <div className="h-1.5 rounded bg-slate-300 w-full" />
                    <div className="h-1.5 rounded bg-slate-300 w-4/5" />
                    <div className="h-1.5 rounded bg-slate-200 w-full" />
                    <div className="h-1.5 rounded bg-slate-200 w-3/5" />
                    <div className="h-12 mt-3 rounded bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center text-white text-[8px] font-semibold">
                      PHOTO ANNOTATION · HAIL STRIKE 1/47
                    </div>
                    <div className="h-1.5 rounded bg-slate-300 w-full mt-3" />
                    <div className="h-1.5 rounded bg-slate-300 w-5/6" />
                    <div className="h-1.5 rounded bg-slate-200 w-4/5" />
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 text-center">
                <p className="text-base font-semibold text-white mb-1">
                  Tap to open the full PDF &rarr;
                </p>
                <p className="text-xs text-[var(--gray-muted)]">
                  ~18 pages · Xactimate estimate · code citations · 47 annotated photos
                </p>
              </div>
            </a>
          ) : (
            <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl overflow-hidden mb-10">
              <div className="px-5 py-3 border-b border-white/[0.1] flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Forensic Causation Report (preview)</p>
                <a
                  href="/sample/forensic-report-sample.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--cyan)] hover:text-white"
                >
                  Open full PDF &rarr;
                </a>
              </div>
              <div className="bg-white" style={{ height: "min(75vh, 800px)" }}>
                <iframe
                  src="/sample/forensic-report-sample.pdf#view=FitH"
                  className="w-full h-full border-0"
                  title="Sample forensic causation report"
                />
              </div>
            </div>
          )}

          {/* Bottom CTA */}
          <div className="text-center bg-white/[0.04] border border-white/[0.1] rounded-2xl p-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              Want one of these for your next claim?
            </h2>
            <p className="text-base text-[var(--gray-dim)] mb-6 max-w-xl mx-auto">
              3 free claims. No credit card. Built for roofing sales reps, contractors, and company owners.
            </p>
            <a
              href={ctaHref}
              className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl font-semibold text-base transition-all shadow-lg"
            >
              {device.isInAppBrowser ? "Get Started Free →" : "Try It Free →"}
            </a>
            <p className="text-xs text-[var(--gray-muted)] mt-4">
              {device.isInAppBrowser
                ? "We'll send you a desktop link to upload from your office"
                : "Sign in with Google or email — takes 30 seconds"}
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
