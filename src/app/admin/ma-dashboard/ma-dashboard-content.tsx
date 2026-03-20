"use client";

interface Props {
  webClaims: number;
  wins: number;
  saasUsers: number;
  inspectorApps: number;
}

function Panel({ title, badge, badgeColor, children }: {
  title: string;
  badge?: string;
  badgeColor?: string;
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    green: "bg-green-100 text-green-800",
    gold: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
    purple: "bg-purple-100 text-purple-800",
  };
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/[0.04] flex items-center justify-between">
        <span className="text-sm font-bold text-[var(--dark-navy)]">{title}</span>
        {badge && (
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${colors[badgeColor || "green"]}`}>
            {badge}
          </span>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const colorClass = color === "green" ? "text-green-600" : color === "gold" ? "text-amber-700" : color === "red" ? "text-red-600" : color === "teal" ? "text-sky-600" : color === "orange" ? "text-amber-500" : "";
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-white/[0.04] last:border-b-0">
      <span className="text-[13px] text-[var(--gray-muted)]">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${colorClass}`}>{value}</span>
    </div>
  );
}

function BarChart({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-xs font-semibold text-[var(--white)] min-w-[90px]">{label}</span>
      <div className="flex-1 bg-white/[0.06] rounded h-5 overflow-hidden relative">
        <div className={`h-full rounded flex items-center pl-2 text-[11px] font-bold text-white min-w-[30px]`} style={{ width: `${pct}%`, background: color }}>{value}</div>
      </div>
    </div>
  );
}

function TierCard({ name, price, claims, cpc, popular }: { name: string; price: string; claims: string; cpc: string; popular?: boolean }) {
  return (
    <div className={`border rounded-lg p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md ${popular ? "border-amber-400 bg-gradient-to-b from-amber-50 to-white" : "border-[var(--border-glass)]"}`}>
      {popular && <div className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Most Popular</div>}
      <div className="text-[13px] font-bold text-[var(--dark-navy)] mb-1">{name}</div>
      <div className="text-[28px] font-black text-[var(--dark-navy)]">{price}<small className="text-[13px] font-medium text-[var(--gray-dim)]">/mo</small></div>
      <div className="text-xs text-[var(--gray-muted)] mt-1">{claims}</div>
      <div className="text-[11px] font-bold text-green-600 mt-2 inline-block bg-green-100 px-2.5 py-0.5 rounded-full">{cpc}</div>
    </div>
  );
}

function TimelineItem({ date, title, desc, color, kpi, kpiColor }: { date: string; title: string; desc: string; color: string; kpi?: string; kpiColor?: string }) {
  const dotColors: Record<string, string> = {
    green: "bg-green-500 shadow-green-200",
    gold: "bg-amber-500 shadow-amber-200",
    teal: "bg-sky-500 shadow-blue-200",
    red: "bg-red-600 shadow-red-200",
    purple: "bg-purple-500 shadow-purple-200",
  };
  const kpiColors: Record<string, string> = {
    green: "bg-green-100 text-green-800",
    gold: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-800",
    red: "bg-red-100 text-red-800",
    purple: "bg-purple-100 text-purple-800",
  };
  return (
    <div className="relative pl-10 pb-5 last:pb-0">
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white/[0.04]" />
      <div className={`absolute left-[-4px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white shadow-[0_0_0_2px] ${dotColors[color] || "bg-white/[0.04] shadow-gray-200"}`} />
      <div className="text-[11px] font-bold text-[var(--gray-muted)] uppercase tracking-wider">{date}</div>
      <div className="text-[13px] font-bold text-[var(--dark-navy)] mt-0.5">{title}</div>
      <div className="text-xs text-[var(--gray-muted)] leading-relaxed mt-0.5">{desc}</div>
      {kpi && <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-lg mt-1 ${kpiColors[kpiColor || "green"]}`}>{kpi}</span>}
    </div>
  );
}

export function MADashboardContent({ webClaims, wins, saasUsers, inspectorApps }: Props) {
  return (
    <div className="min-h-screen bg-white/[0.04]">
      {/* Valuation Banner */}
      <div className="mx-4 sm:mx-8 mt-5 rounded-xl bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border border-amber-700/30 p-7 grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-widest text-white/50 font-semibold mb-2">Previous Estimate</div>
          <div className="text-white/30 line-through text-sm">$1.5M - $4M</div>
          <div className="text-[11px] text-white/40 mt-2">As of 2026-02-26</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-widest text-white/50 font-semibold mb-2">Current Valuation Estimate</div>
          <div className="text-[42px] font-black text-amber-400 tracking-tight">$3M <small className="text-lg font-semibold text-white/40">-</small> $8M</div>
          <div className="text-xs text-white/40 mt-1">Pre-revenue with demonstrated product-market fit</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-widest text-white/50 font-semibold mb-1.5">Target Valuation</div>
          <div className="text-[28px] font-extrabold text-amber-400">$40M</div>
          <div className="mt-2 bg-white/10 rounded-md h-1.5 overflow-hidden">
            <div className="h-full rounded-md bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: "15%" }} />
          </div>
          <div className="text-[11px] text-white/40 mt-1">~15% of target</div>
        </div>
      </div>

      {/* Key Metrics Bar */}
      <div className="mx-4 sm:mx-8 mt-4 grid grid-cols-3 md:grid-cols-6 gap-0.5 bg-[var(--dark-navy)] rounded-xl overflow-hidden">
        {[
          { label: "SaaS Users", value: String(saasUsers), color: "text-amber-400" },
          { label: "Web Claims", value: String(webClaims), color: "text-sky-400" },
          { label: "Total Claims", value: `${webClaims + 34}+`, color: "text-white" },
          { label: "Wins", value: String(wins > 0 ? wins : 10), color: "text-green-400" },
          { label: "Cost / Claim", value: "$1.91", color: "text-green-400" },
          { label: "Inspector Apps", value: String(inspectorApps), color: "text-amber-500" },
        ].map((m) => (
          <div key={m.label} className="py-3.5 px-4 text-center">
            <div className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1">{m.label}</div>
            <div className={`text-xl font-extrabold ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Growth Signals */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-5 pb-2">Growth Signals</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="User Acquisition" badge="First Multi-User Week" badgeColor="green">
          <MetricRow label="Distinct Users" value={String(saasUsers)} color="gold" />
          <MetricRow label="Web Claims Processed" value={String(webClaims)} color="teal" />
          <MetricRow label="Largest Batch Upload" value="14 claims (single user)" />
          <MetricRow label="Inspector Applications" value={String(inspectorApps)} color="orange" />
          <MetricRow label="Claims Last 7 Days" value="32" color="green" />
        </Panel>

        <Panel title="Claims Pipeline" badge={`${webClaims + 34}+ Processed`} badgeColor="blue">
          <BarChart label="Web Claims" value={String(webClaims)} pct={66} color="var(--teal)" />
          <BarChart label="Local Claims" value="34" pct={55} color="#1E3A5F" />
          <BarChart label="Wins" value={String(wins > 0 ? wins : 10)} pct={16} color="var(--green)" />
          <BarChart label="Pending" value="24" pct={39} color="var(--orange)" />
          <div className="mt-3 text-xs text-[var(--gray-muted)]">
            Win Rate: <strong className="text-[var(--white)]">29.4%</strong> (10/34 local) &mdash; web claims too new for outcomes
          </div>
        </Panel>

        <Panel title="Financial Summary" badge="$1.37M Moved" badgeColor="gold">
          <MetricRow label="USARM Total RCV" value="~$3.9M" />
          <MetricRow label="Carrier Total RCV" value="~$2.1M" />
          <MetricRow label="Total Variance" value="~$1.8M" color="green" />
          <MetricRow label="Carrier Movement (Wins)" value="$1.37M" color="gold" />
          <MetricRow label="Largest Win" value="$943K (46x)" color="green" />
        </Panel>
      </div>

      {/* Cost Audit */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-3 pb-2">Cost Audit &mdash; AI Processing Economics</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="Cost Per Claim (COGS)" badge="Under $2 Target" badgeColor="green">
          <div className="text-center py-3">
            <div className="text-5xl font-black text-[var(--dark-navy)]">$1.91</div>
            <div className="text-xs text-[var(--gray-muted)] mt-1">avg per claim (corrected telemetry, 30 claims)</div>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs">
            <span className="line-through text-red-500">$2.14</span>
            <span className="text-[var(--gray-dim)]">&rarr;</span>
            <span className="text-green-600 font-bold">$1.91</span>
            <span className="text-[var(--gray-dim)] ml-1">after Opus 3x fix</span>
          </div>
        </Panel>

        <Panel title="Cost by Model" badge="Corrected" badgeColor="blue">
          <div className="bg-white/[0.04] rounded-lg p-4 border border-white/[0.04] mb-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[13px] font-bold">Claude Sonnet 4.6</span>
              <span className="text-lg font-extrabold text-sky-500">$53.60</span>
            </div>
            <div className="text-xs text-[var(--gray-muted)]">93% of total &mdash; dominates web pipeline (photo analysis, config building, extraction)</div>
            <div className="text-[11px] text-[var(--gray-dim)] mt-1">$3/M input &bull; $15/M output</div>
          </div>
          <div className="bg-white/[0.04] rounded-lg p-4 border border-white/[0.04]">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[13px] font-bold">Claude Opus 4.6</span>
              <span className="text-lg font-extrabold text-purple-500">$3.58</span>
            </div>
            <div className="text-xs text-[var(--gray-muted)]">7% of total &mdash; forensic synthesis, repair diagnosis</div>
            <div className="flex items-center gap-2 text-xs mt-1">
              <span className="line-through text-red-500">$10.74 (was 3x overestimated)</span>
              <span className="text-[var(--gray-dim)]">&rarr;</span>
              <span className="text-green-600 font-bold">$3.58</span>
            </div>
          </div>
        </Panel>

        <Panel title="Cost Centers (Must Separate)" badge="Critical for Investors" badgeColor="red">
          {[
            { title: "Claim Processing (COGS)", amount: "$57.18", color: "border-green-500", amountColor: "text-green-600", desc: "processing_logs with claim_id — the metric investors care about" },
            { title: "R&D / Development", amount: "TBD", color: "border-purple-500", amountColor: "text-purple-500", desc: "Claude Code sessions (Tom, Kristen, Alfonso) — separate API key" },
            { title: "Operational Overhead", amount: "~$0", color: "border-amber-500", amountColor: "text-amber-500", desc: "Gmail poller, correspondence analysis — now tracked via telemetry" },
          ].map((c) => (
            <div key={c.title} className={`bg-white/[0.04] rounded-lg p-4 border-l-[3px] ${c.color} border border-white/[0.04] mb-3 last:mb-0`}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[13px] font-bold">{c.title}</span>
                <span className={`text-lg font-extrabold ${c.amountColor}`}>{c.amount}</span>
              </div>
              <div className="text-xs text-[var(--gray-muted)]">{c.desc}</div>
            </div>
          ))}
        </Panel>
      </div>

      {/* Revenue Model */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-3 pb-2">Revenue Model</div>

      {/* Stripe Tiers */}
      <div className="px-4 sm:px-8 pb-4">
        <Panel title="Stripe Billing Tiers (Live)" badge="Billing Active" badgeColor="gold">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <TierCard name="Starter" price="$0" claims="3 free claims" cpc="$0/claim" />
            <TierCard name="Pro" price="$499" claims="10 claims/mo" cpc="$49.90/claim" />
            <TierCard name="Growth" price="$999" claims="30 claims/mo" cpc="$33.30/claim" popular />
            <TierCard name="Enterprise" price="$2,999" claims="100 claims/mo" cpc="$29.99/claim" />
          </div>
          <div className="mt-4 flex flex-col sm:flex-row justify-between px-4 py-3 bg-green-50 rounded-lg text-xs gap-2">
            <span><strong>Gross Margin at Enterprise:</strong> $29.99 revenue - $1.91 COGS = <strong className="text-green-600">$28.08 (93.6%)</strong></span>
            <span><strong>25 users at avg $999:</strong> $24,975 MRR ($300K ARR)</span>
          </div>
        </Panel>
      </div>

      {/* Service Add-Ons + Network */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="Service Add-On Revenue Streams" badge="4 New Streams" badgeColor="purple">
          {[
            { name: "White Glove HAAG Inspection", desc: "HAAG-certified inspector dispatched within 48hrs. Full forensic evidence package feeds AI pipeline.", price: "$750", comps: ["Hancock $80-100", "Seek Now $75-150", "Pilot $50-100"], us: "Ours: 5-10x premium" },
            { name: "Inspector Club (Gig Network)", desc: "$300/job to inspector — 3x Hancock pay. Defection magnet for experienced inspectors.", price: "$300/job", comps: ["Market rate: $80-150"], us: "Ours: 2-3x pay" },
            { name: "Thermal Imaging Scans", desc: "FLIR thermal documentation for leak claims. AI-integrated moisture path detection.", price: "$999", comps: ["Market rate: $300-500"], us: "Ours: 2-3x (AI-integrated)" },
            { name: '"I Hate Dumbroof-ers Club"', desc: "PA/contractor matchmaking network. Free to join. Platform margin on matched claims. PAs = highest-LTV users.", price: "Network Effect", comps: [], us: "Three-way marketplace" },
          ].map((r) => (
            <div key={r.name} className="border border-[var(--border-glass)] rounded-lg p-4 mb-3 last:mb-0 hover:border-amber-400 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-sm font-bold text-[var(--dark-navy)]">{r.name}</div>
                  <div className="text-xs text-[var(--gray-muted)] mt-1 leading-relaxed">{r.desc}</div>
                </div>
                <div className="text-lg font-extrabold text-amber-500 whitespace-nowrap ml-4">{r.price}</div>
              </div>
              <div className="flex gap-2 flex-wrap mt-2">
                {r.comps.map((c) => <span key={c} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] text-[var(--gray-muted)]">{c}</span>)}
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{r.us}</span>
              </div>
            </div>
          ))}
        </Panel>

        <div className="flex flex-col gap-4">
          {/* Three-Way Marketplace */}
          <Panel title="Three-Way Marketplace Network">
            <div className="flex flex-wrap justify-center items-center gap-2 py-5">
              <div className="w-24 h-24 rounded-full bg-blue-100 border-[3px] border-blue-500 flex flex-col items-center justify-center text-[11px] font-bold text-blue-700 text-center">
                Contractor
                <span className="text-[9px] font-normal mt-0.5">Uploads claims</span>
              </div>
              <span className="text-xl text-[var(--gray-dim)]">&harr;</span>
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-[var(--dark-navy)] to-[var(--navy)] border-[3px] border-amber-400 flex flex-col items-center justify-center text-xs font-extrabold text-white text-center">
                Dumb Roof
                <span className="text-[9px] text-amber-400 font-semibold">Margin on all sides</span>
              </div>
              <span className="text-xl text-[var(--gray-dim)]">&harr;</span>
              <div className="w-24 h-24 rounded-full bg-purple-100 border-[3px] border-purple-500 flex flex-col items-center justify-center text-[11px] font-bold text-purple-700 text-center">
                Public Adj.
                <span className="text-[9px] font-normal mt-0.5">Supplements</span>
              </div>
            </div>
            <div className="text-center -mt-2 mb-2 text-xl text-[var(--gray-dim)]">&uarr;</div>
            <div className="flex justify-center">
              <div className="w-24 h-24 rounded-full bg-amber-100 border-[3px] border-amber-500 flex flex-col items-center justify-center text-[11px] font-bold text-amber-800 text-center">
                Inspector
                <span className="text-[9px] font-normal mt-0.5">$300/job</span>
              </div>
            </div>
            <div className="text-center mt-3 text-[11px] text-[var(--gray-muted)]">Each side makes the other more valuable &mdash; classic network effect</div>
          </Panel>

          {/* Inspector Competitive */}
          <Panel title="Inspector Pay Competitive Analysis" badge="Disruptive" badgeColor="green">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th className="pb-2 text-[10px] uppercase tracking-wider text-[var(--gray-muted)] font-bold">Company</th>
                  <th className="pb-2 text-[10px] uppercase tracking-wider text-[var(--gray-muted)] font-bold">Pay/Inspection</th>
                  <th className="pb-2 text-[10px] uppercase tracking-wider text-[var(--gray-muted)] font-bold">Our Premium</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { company: "Hancock Claims", pay: "$80 - $100", premium: "3 - 3.75x" },
                  { company: "Seek Now", pay: "$75 - $150", premium: "2 - 4x" },
                  { company: "Pilot Catastrophe", pay: "$50 - $100", premium: "3 - 6x" },
                ].map((r) => (
                  <tr key={r.company} className="border-t border-white/[0.04] hover:bg-white/[0.04]">
                    <td className="py-2.5">{r.company}</td>
                    <td className="py-2.5">{r.pay}</td>
                    <td className="py-2.5 font-extrabold text-green-600">{r.premium}</td>
                  </tr>
                ))}
                <tr className="border-t border-white/[0.04] bg-amber-50">
                  <td className="py-2.5 font-bold">Inspector Club</td>
                  <td className="py-2.5 font-extrabold text-amber-700">$300/job</td>
                  <td className="py-2.5 font-extrabold text-amber-700">Defection target</td>
                </tr>
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      {/* Product & IP */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-3 pb-2">Product &amp; Intellectual Property</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="Deployed Feature Set" badge="Full SaaS Live" badgeColor="green">
          <ul className="space-y-1.5">
            {[
              ["5-document PDF appeal package (forensic + estimate + scope comparison + appeal + email)", "v1.0"],
              ["AI photo analysis with auto-annotations (Claude Vision)", "v1.0"],
              ["Stripe billing: $499 / $999 / $2,999 tiers", "Mar 11"],
              ["Photo review swipe UI (approve/reject/correct)", "Mar 10"],
              ["Claims map with damage score pins", "Mar 10"],
              ["Damage scoring (DS + TAS dual scores)", "Mar 11"],
              ["Carrier correspondence AI (Socratic responses)", "Mar 3"],
              ["Email ingestion (claims@dumbroof.ai auto-routing)", "Mar 3"],
              ["Repair AI (leak diagnosis + repair documents)", "Mar 6"],
              ["Inspector recruitment form on landing page", "Mar 10"],
              ["NOAA weather integration + damage thresholds", "Mar 3"],
              ["Fraud detection (EXIF, GPS, duplicates, editing)", "Mar 2"],
              ["Admin dashboard with reprocess / file download", "Mar 6"],
              ["Self-service document replacement via email", "Mar 6"],
              ["Analytics dashboard with web-only filtering", "Mar 10"],
            ].map(([feat, date]) => (
              <li key={feat} className="flex items-start gap-2 py-1.5 border-b border-white/[0.04] last:border-b-0 text-xs">
                <span className="text-green-500 font-bold shrink-0">&#10003;</span>
                <span className="text-[var(--white)] flex-1">{feat}</span>
                <span className="text-[10px] text-[var(--gray-dim)] whitespace-nowrap">{date}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="IP Portfolio" badge="Patent Filed" badgeColor="gold">
            <MetricRow label="USPTO Provisional Patent" value="Filed 2026-02-26 (66 claims, 18 figs)" />
            <MetricRow label="Non-Provisional Deadline" value="2027-02-26" color="red" />
            <MetricRow label="Trademarks" value="dumbroof.ai (filed) + 3 pending" />
            <MetricRow label="Entity" value="Dumb Roof Technologies LLC (WY)" />
            <MetricRow label="Domains" value="dumbroof.ai + dumbroof.com" />
            <MetricRow label="Annotation Training Data" value="Proprietary (user corrections)" color="green" />
          </Panel>

          <Panel title="6 AI Modules (Production)">
            <div className="grid grid-cols-2 gap-2">
              {[
                { name: "Photo Analysis", desc: "Claude Vision annotations", color: "border-sky-500" },
                { name: "Damage Scoring", desc: "DS + TAS dual scores", color: "border-green-500" },
                { name: "Hail Detection", desc: "Evidence cascade + chalk", color: "border-purple-500" },
                { name: "NOAA Weather", desc: "Storm data + thresholds", color: "border-amber-500" },
                { name: "Fraud Detection", desc: "EXIF, GPS, duplicates", color: "border-red-500" },
                { name: "Repair AI", desc: "Leak diagnosis + docs", color: "border-amber-400" },
              ].map((m) => (
                <div key={m.name} className={`p-2.5 bg-white/[0.04] rounded-md border-l-[3px] ${m.color}`}>
                  <div className="text-xs font-bold">{m.name}</div>
                  <div className="text-[10px] text-[var(--gray-muted)]">{m.desc}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Data Moat */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-3 pb-2">Data Moat &amp; Infrastructure</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-4 sm:px-8 pb-4">
        {[
          { value: "123,942", label: "Data Warehouse Rows", sub: "51 tables in Supabase" },
          { value: "40,000+", label: "Accessible Photos", sub: "23K scraped + 17K CompanyCam" },
          { value: "16", label: "Carrier Playbooks", sub: "Tactics, arguments, outcomes" },
          { value: "8+", label: "API Integrations", sub: "AccuLynx, EagleView, HailTrace..." },
        ].map((d) => (
          <div key={d.label} className="bg-white rounded-xl shadow-sm p-5 text-center">
            <div className="text-4xl font-black text-[var(--dark-navy)]">{d.value}</div>
            <div className="text-[11px] text-[var(--gray-muted)] uppercase tracking-wider font-semibold mt-1">{d.label}</div>
            <div className="text-[11px] text-[var(--gray-dim)] mt-1">{d.sub}</div>
          </div>
        ))}
      </div>

      {/* GTM & Audience */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-3 pb-2">Go-to-Market &amp; Audience</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="Audience Intelligence">
          <MetricRow label="Named Prospects" value="469" />
          <MetricRow label="Storm Restoration Warm Leads" value="26" color="gold" />
          <MetricRow label="Marketing Assets" value="42+ files" />
          <MetricRow label="Ad Channels Ready" value="FB, Google, TikTok, X" />
          <MetricRow label="#1 Influence Target" value="Mike Coday (469-member group owner)" />
        </Panel>

        <Panel title="ARR Projections">
          <BarChart label="Conservative" value="$754K" pct={33} color="#1E3A5F" />
          <BarChart label="Moderate" value="$1.1M" pct={48} color="var(--teal)" />
          <BarChart label="Target" value="$2.3M" pct={100} color="var(--gold)" />
          <div className="mt-3 text-xs text-[var(--gray-muted)]">
            Month 12 projections. At avg $999/mo: need <strong>192 users</strong> for target.
          </div>
        </Panel>

        <Panel title="Proven Win Results">
          <MetricRow label="Total Wins" value={String(wins > 0 ? wins : 10)} color="green" />
          <MetricRow label="Largest Win" value="$943K (46.1x)" color="green" />
          <MetricRow label="Avg Win Movement" value="+$137K" color="green" />
          <MetricRow label="First Web Portal Win" value="421 June St (+$32K)" color="gold" />
          <MetricRow label="First Denial Reversal" value="$0 → $40.7K" color="green" />
        </Panel>
      </div>

      {/* Development Timeline */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-3 pb-2">Recent Development Timeline</div>
      <div className="px-4 sm:px-8 pb-4">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <TimelineItem date="Mar 12" title="Cost Audit + M&A Report Refresh" desc="Telemetry bugs fixed (Opus 3x, cache tracking, retry logging). Gmail + repair calls instrumented. Service add-ons documented." color="gold" kpi="Cost/claim: $1.91" kpiColor="gold" />
          <TimelineItem date="Mar 11" title="Stripe Pricing: $499/$999/$2999" desc="3 new Stripe prices, 3 archived. Layout.tsx JSON-LD fix (E091). Shared billing hook extracted." color="green" kpi="Revenue per claim: 2x at enterprise" kpiColor="green" />
          <TimelineItem date="Mar 11" title="Repair Pipeline: 9 Bug Fixes" desc="Non-blocking poller (E086), stuck recovery (E087), input validation (E088), min charge $450 (E090), PDF error handling (E089)." color="green" kpi="9 failure modes eliminated" kpiColor="green" />
          <TimelineItem date="Mar 10" title="Photo Review + Claims Map + Scoring Live" desc="Tinder-style swipe UI, Leaflet/OSM map with damage pins, dual scoring (DS+TAS) in web pipeline, annotation_feedback table." color="teal" kpi="Proprietary training data accumulating" kpiColor="blue" />
          <TimelineItem date="Mar 10" title="GTM Launch: 469-Person Audience + Technical SEO" desc="42+ marketing files, Facebook group extraction, ad copy for 4 channels, interactive pricing calculator, robots.ts/sitemap/OG tags/JSON-LD." color="teal" kpi="GTM readiness: 90%" kpiColor="blue" />
          <TimelineItem date="Mar 9" title="11 Systemic PDF Bugs Fixed" desc="QA review of 42 PDFs across 9 web claims. Dynamic demand items, AI name sanitization, per-field defaults. Railway deploy fix discovered." color="purple" kpi="PDFs production-ready" kpiColor="purple" />
          <TimelineItem date="Mar 6" title="Self-Service Email + Admin Dashboard" desc="Document replacement via email, Gmail poller live on Railway, admin cross-user matching, reprocess button." color="green" />
          <TimelineItem date="Mar 4" title="Data Warehouse Backfill: 123K+ Rows" desc="9-script batch pipeline. 2,494 claim outcomes, 23,132 workplace photos, 5 API integrations. Data moat established." color="red" kpi="Data asset: $1-2M standalone" kpiColor="red" />
          <TimelineItem date="Mar 3" title="Email Ingestion + NOAA Weather + Hail AI" desc="Full email pipeline (Cloudflare Worker + Edge Function + AI analysis). NOAA storm data auto-query. Hail detection with evidence cascade." color="purple" />
          <TimelineItem date="Feb 26" title="USPTO Provisional Patent Filed" desc="66 claims, 18 figures. Covers AI photo analysis, forensic synthesis, damage scoring, evidence cascade methodology." color="gold" kpi="Non-provisional due Feb 2027" kpiColor="gold" />
        </div>
      </div>

      {/* KPI Scorecard */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-3 pb-2">Full KPI Scorecard</div>
      <div className="px-4 sm:px-8 pb-4">
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-white/[0.04]">
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-[var(--gray-muted)] font-bold w-[35%]">KPI</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-[var(--gray-muted)] font-bold w-[22%]">Current</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-[var(--gray-muted)] font-bold w-[22%]">$40M Target</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-[var(--gray-muted)] font-bold w-[21%]">Gap / Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { kpi: "Valuation Estimate", current: "$3M - $8M", target: "$40M", gap: "$32M+", cColor: "text-amber-700 font-extrabold" },
                  { kpi: "ARR", current: "$0 (billing live)", target: "$2.3M", gap: "$2.3M", gColor: "text-red-600" },
                  { kpi: "MRR", current: "$0", target: "$192K", gap: "$192K", gColor: "text-red-600" },
                  { kpi: "Claims SaaS Users", current: String(saasUsers), target: "20-25", gap: `${20 - saasUsers} to go`, cColor: "text-amber-700 font-extrabold" },
                  { kpi: "Web Claims Processed", current: String(webClaims), target: "5,000+", gap: `~${5000 - webClaims}`, cColor: "text-sky-600 font-extrabold" },
                  { kpi: "Total Claims (all sources)", current: `${webClaims + 34}+`, target: "5,000+", gap: `~${5000 - webClaims - 34}` },
                  { kpi: "Win Rate", current: "29.4% (10/34)", target: "35%+", gap: "5.6% gap", gColor: "text-amber-500" },
                  { kpi: "Carrier Movement (Wins)", current: "$1.37M", target: "$10M+", gap: "$8.63M" },
                  { kpi: "Cost per Claim (COGS)", current: "$1.91", target: "<$2.00", gap: "On target", cColor: "text-green-600 font-extrabold", gColor: "text-green-600 font-bold" },
                  { kpi: "AI Modules", current: "6", target: "5+", gap: "Exceeds", gColor: "text-green-600 font-bold" },
                  { kpi: "Inspector Applications", current: String(inspectorApps), target: "50+", gap: `${50 - inspectorApps} to go`, cColor: "text-amber-500 font-bold" },
                  { kpi: "Data Warehouse Rows", current: "123,942", target: "100,000+", gap: "Exceeds", gColor: "text-green-600 font-bold" },
                  { kpi: "Carrier Playbooks", current: "16", target: "30+", gap: "14 to go" },
                  { kpi: "Named Prospects", current: "469", target: "1,000+", gap: "531 to go" },
                  { kpi: "GTM Assets", current: "42+ files", target: "Launch-ready", gap: "On track", gColor: "text-green-600 font-bold" },
                  { kpi: "API Integrations", current: "8+ connected", target: "N/A", gap: "Asset", gColor: "text-green-600 font-bold" },
                  { kpi: "Service Add-Ons Designed", current: "4 streams", target: "N/A", gap: "New revenue", gColor: "text-amber-600 font-bold" },
                ].map((r) => (
                  <tr key={r.kpi} className="border-t border-white/[0.04] hover:bg-white/[0.04]">
                    <td className="px-4 py-2.5 font-semibold">{r.kpi}</td>
                    <td className={`px-4 py-2.5 ${r.cColor || ""}`}>{r.current}</td>
                    <td className="px-4 py-2.5">{r.target}</td>
                    <td className={`px-4 py-2.5 ${r.gColor || ""}`}>{r.gap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Risks & Blockers */}
      <div className="text-xs uppercase tracking-widest text-[var(--gray-muted)] font-bold px-4 sm:px-8 pt-3 pb-2">Risks &amp; Blockers</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="Active Blockers" badge="Action Required" badgeColor="red">
          {[
            { label: "Stripe still in test mode", value: "Need live keys for first payment", lColor: "text-red-600", vColor: "text-red-600" },
            { label: "Dev costs unseparated", value: "Claude Code on same Anthropic bill", lColor: "text-amber-600", vColor: "text-amber-500" },
            { label: "Patent non-provisional", value: "Due 2027-02-26 (11.5 months)", lColor: "text-amber-600", vColor: "text-amber-500" },
          ].map((b) => (
            <div key={b.label} className="flex justify-between items-center py-2.5 border-b border-white/[0.04] last:border-b-0">
              <span className={`text-[13px] font-semibold ${b.lColor}`}>{b.label}</span>
              <span className={`text-xs font-bold ${b.vColor}`}>{b.value}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Priority Actions" badge="Next Steps" badgeColor="gold">
          {[
            { label: "1. First paying customer", value: "Everything built, billing live" },
            { label: "2. Deploy telemetry fixes", value: "Railway + Vercel push" },
            { label: "3. Separate API keys", value: "Dev vs. prod for cost reporting" },
            { label: "4. Mike Coday outreach", value: "469-member group owner" },
          ].map((a) => (
            <div key={a.label} className="flex justify-between items-center py-2.5 border-b border-white/[0.04] last:border-b-0">
              <span className="text-[13px] font-semibold">{a.label}</span>
              <span className="text-xs text-[var(--gray-muted)]">{a.value}</span>
            </div>
          ))}
        </Panel>
      </div>

      {/* Footer */}
      <div className="text-center py-6 px-8 border-t border-[var(--border-glass)] mx-4 sm:mx-8 mb-4 text-xs text-[var(--gray-muted)]">
        <strong className="text-[var(--white)]">Dumb Roof Technologies LLC</strong> &mdash; Confidential M&A Advisor Report
        <br />Tom Kovack Jr. &bull; TKovack@USARoofMasters.com &bull; 267-679-1504
      </div>
    </div>
  );
}
