import { HomeNav } from "@/components/home-nav";
import { Footer } from "@/components/footer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integrations | dumbroof.ai",
  description:
    "Connect AccuLynx, CompanyCam, JobNimbus, and EagleView to dumbroof.ai. Import photos, measurements, and job data directly from your CRM.",
};

const INTEGRATIONS = [
  {
    name: "AccuLynx",
    status: "live" as const,
    description:
      "Import jobs, contacts, insurance info, and documents directly from your AccuLynx account. No more copy-pasting addresses or re-uploading files.",
    features: [
      "Search and import jobs by address",
      "Pull homeowner and adjuster contact info",
      "Import insurance details (carrier, claim number, date of loss)",
      "Download job documents and photos",
    ],
    color: "from-blue-500 to-blue-700",
    icon: (
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z"
        />
      </svg>
    ),
  },
  {
    name: "CompanyCam",
    status: "live" as const,
    description:
      "Pull inspection photos directly from your CompanyCam projects. AI classifies each photo for damage type, severity, and material — no manual tagging.",
    features: [
      "Search projects by address",
      "Import all project photos with GPS data",
      "AI auto-classifies damage type and severity",
      "Photos flow directly into your claim package",
    ],
    color: "from-green-500 to-emerald-700",
    icon: (
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
        />
      </svg>
    ),
  },
  {
    name: "JobNimbus",
    status: "coming_soon" as const,
    description:
      "Connect your JobNimbus CRM to sync job data, contacts, and project documents with dumbroof.ai.",
    features: [
      "Import job and contact records",
      "Sync insurance and financial data",
      "Pull attached documents and photos",
    ],
    color: "from-orange-500 to-orange-700",
    icon: (
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
        />
      </svg>
    ),
  },
  {
    name: "EagleView",
    status: "coming_soon" as const,
    description:
      "Import aerial measurements directly from EagleView reports. Accurate roof dimensions without manual entry.",
    features: [
      "Auto-import roof measurements",
      "Pull ridge, hip, valley, and eave lengths",
      "Import total squares and pitch data",
    ],
    color: "from-sky-500 to-sky-700",
    icon: (
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
        />
      </svg>
    ),
  },
  {
    name: "HOVER",
    status: "coming_soon" as const,
    description:
      "Import 3D property models and measurements from HOVER. Exterior dimensions, roof geometry, and material detection.",
    features: [
      "Import 3D roof and wall measurements",
      "Pull siding, trim, and window dimensions",
      "Leverage HOVER's material detection",
    ],
    color: "from-violet-500 to-violet-700",
    icon: (
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25"
        />
      </svg>
    ),
  },
  {
    name: "GAF QuickMeasure",
    status: "coming_soon" as const,
    description:
      "Import roof measurements from GAF QuickMeasure reports. Fast aerial estimates for GAF-certified contractors.",
    features: [
      "Import roof area and pitch measurements",
      "Pull waste factor calculations",
      "GAF product compatibility data",
    ],
    color: "from-red-500 to-red-700",
    icon: (
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z"
        />
      </svg>
    ),
  },
  {
    name: "RoofLink",
    status: "coming_soon" as const,
    description:
      "Sync jobs, contacts, and production data from RoofLink CRM. Streamline your workflow from lead to claim package.",
    features: [
      "Import job and customer records",
      "Sync insurance and production data",
      "Connect via Zapier automation",
    ],
    color: "from-teal-500 to-teal-700",
    icon: (
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.702a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.53"
        />
      </svg>
    ),
  },
];

export default function IntegrationsPage() {
  return (
    <main className="min-h-screen">
      <HomeNav />

      {/* Hero */}
      <section className="relative pt-32 pb-16 px-6 bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block mb-6 px-4 py-1.5 rounded-full bg-white/10 border border-white/20">
            <span className="text-[var(--gold)] text-sm font-medium">
              CRM Integrations
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
            Works with the tools
            <br />
            <span className="text-[var(--red)]">you already use.</span>
          </h1>

          <p className="text-lg text-[var(--gray-dim)] max-w-2xl mx-auto mb-4 leading-relaxed">
            Connect your CRM and photo tools. Import jobs, photos, and
            measurements directly &mdash; no more manual uploads.
          </p>
          <p className="text-sm text-[var(--gray-muted)] max-w-xl mx-auto leading-relaxed">
            Enter your API key in Settings, and dumbroof.ai pulls everything it
            needs to build your claim package.
          </p>
        </div>
      </section>

      {/* Integration Cards */}
      <section className="py-16 px-6 bg-[var(--bg-deep)]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          {INTEGRATIONS.map((integration) => (
            <div
              key={integration.name}
              className="glass-card p-8 relative overflow-hidden"
            >
              {integration.status === "coming_soon" && (
                <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-white/10 border border-white/20">
                  <span className="text-[var(--gray-muted)] text-xs font-medium">
                    Coming Soon
                  </span>
                </div>
              )}
              {integration.status === "live" && (
                <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/30">
                  <span className="text-green-400 text-xs font-medium">
                    Live
                  </span>
                </div>
              )}

              <div className="flex items-start gap-4 mb-5">
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${integration.color} flex items-center justify-center flex-shrink-0`}
                >
                  {integration.icon}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-[var(--white)]">
                    {integration.name}
                  </h3>
                  <p className="text-sm text-[var(--gray-muted)] mt-1 leading-relaxed">
                    {integration.description}
                  </p>
                </div>
              </div>

              <ul className="space-y-2">
                {integration.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-[var(--gray-dim)]"
                  >
                    <svg
                      className={`w-4 h-4 mt-0.5 flex-shrink-0 ${integration.status === "live" ? "text-green-400" : "text-[var(--gray-dim)]"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-6 bg-[var(--navy)]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            Three steps. Zero manual uploads.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "Connect",
                desc: "Go to Settings and enter your AccuLynx or CompanyCam API key. We test the connection instantly.",
              },
              {
                step: "2",
                title: "Import",
                desc: "When creating a new claim, click 'Import from CRM.' Search your jobs, select one, and pick the files you need.",
              },
              {
                step: "3",
                title: "Generate",
                desc: "dumbroof.ai pulls your photos, measurements, and insurance data. Your 5-PDF claim package builds automatically.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center text-white font-bold text-lg mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-[var(--gray-muted)] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 bg-[var(--bg-deep)]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to stop uploading files?
          </h2>
          <p className="text-[var(--gray-muted)] mb-8">
            Your first 3 claims are free. No credit card required.
          </p>
          <a
            href="/login?mode=signup"
            className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors shadow-lg shadow-red-900/30"
          >
            Try 3 Free Claims
          </a>
        </div>
      </section>

      <Footer />
    </main>
  );
}
