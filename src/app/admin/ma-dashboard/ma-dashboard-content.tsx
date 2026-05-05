"use client";

interface Props {
  totalClaims: number;
  wins: number;
  saasUsers: number;
  companies: number;
  companies30d: number;
  inspectorApps: number;
  claims7d: number;
  claims30d: number;
  last30dCost: number;
  last30dClaimCount: number;
  avgCostPerClaim30d: number;
  costByModel: Record<string, number>;
  costByStep: Record<string, number>;
  winSettlementTotal: number;
  winCarrierMovement: number;
  totalContractorRCV: number;
  totalCarrierRCV: number;
  totalVariance: number;
}

const fmtMoney = (n: number, fractionDigits = 0) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;

const fmtMoneyShort = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

function Panel({ title, badge, badgeColor, children, className = "" }: {
  title: string;
  badge?: string;
  badgeColor?: "green" | "gold" | "red" | "blue" | "purple" | "slate";
  children: React.ReactNode;
  className?: string;
}) {
  const badgeColors: Record<string, string> = {
    green: "bg-emerald-100 text-emerald-800 border-emerald-200",
    gold: "bg-amber-100 text-amber-800 border-amber-200",
    red: "bg-rose-100 text-rose-800 border-rose-200",
    blue: "bg-sky-100 text-sky-800 border-sky-200",
    purple: "bg-violet-100 text-violet-800 border-violet-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
      <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <span className="text-sm font-bold text-slate-900">{title}</span>
        {badge && (
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${badgeColors[badgeColor || "slate"]}`}>
            {badge}
          </span>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, color, sub }: {
  label: string;
  value: string;
  color?: "emerald" | "amber" | "rose" | "sky" | "violet" | "slate";
  sub?: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
    sky: "text-sky-700",
    violet: "text-violet-700",
    slate: "text-slate-900",
  };
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-b-0">
      <div className="flex flex-col">
        <span className="text-[13px] text-slate-700 font-medium">{label}</span>
        {sub && <span className="text-[11px] text-slate-500 mt-0.5">{sub}</span>}
      </div>
      <span className={`text-sm font-bold tabular-nums ${colorMap[color || "slate"]}`}>{value}</span>
    </div>
  );
}

function BarChart({ label, value, pct, color }: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-xs font-semibold text-slate-700 min-w-[100px]">{label}</span>
      <div className="flex-1 bg-slate-100 rounded h-5 overflow-hidden relative border border-slate-200">
        <div
          className="h-full rounded flex items-center pl-2 text-[11px] font-bold text-white min-w-[36px]"
          style={{ width: `${Math.max(pct, 6)}%`, background: color }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function TierCard({ name, price, claims, cpc, popular }: {
  name: string;
  price: string;
  claims: string;
  cpc: string;
  popular?: boolean;
}) {
  return (
    <div className={`border rounded-lg p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md ${
      popular
        ? "border-amber-400 bg-gradient-to-b from-amber-50 to-white"
        : "border-slate-200 bg-white"
    }`}>
      {popular && <div className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">Most Popular</div>}
      <div className="text-[13px] font-bold text-slate-900 mb-1">{name}</div>
      <div className="text-[28px] font-black text-slate-900">
        {price}<small className="text-[13px] font-medium text-slate-500">/mo</small>
      </div>
      <div className="text-xs text-slate-600 mt-1">{claims}</div>
      <div className="text-[11px] font-bold text-emerald-700 mt-2 inline-block bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full">{cpc}</div>
    </div>
  );
}

function TimelineItem({ date, title, desc, color, kpi, kpiColor }: {
  date: string;
  title: string;
  desc: string;
  color: "green" | "gold" | "teal" | "red" | "purple" | "slate";
  kpi?: string;
  kpiColor?: "green" | "gold" | "blue" | "red" | "purple";
}) {
  const dotColors: Record<string, string> = {
    green: "bg-emerald-500 ring-emerald-100",
    gold: "bg-amber-500 ring-amber-100",
    teal: "bg-sky-500 ring-sky-100",
    red: "bg-rose-600 ring-rose-100",
    purple: "bg-violet-500 ring-violet-100",
    slate: "bg-slate-400 ring-slate-100",
  };
  const kpiColors: Record<string, string> = {
    green: "bg-emerald-100 text-emerald-800 border-emerald-200",
    gold: "bg-amber-100 text-amber-800 border-amber-200",
    blue: "bg-sky-100 text-sky-800 border-sky-200",
    red: "bg-rose-100 text-rose-800 border-rose-200",
    purple: "bg-violet-100 text-violet-800 border-violet-200",
  };
  return (
    <div className="relative pl-10 pb-5 last:pb-0">
      <div className="absolute left-[3px] top-2 bottom-0 w-0.5 bg-slate-200" />
      <div className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ${dotColors[color]}`} />
      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{date}</div>
      <div className="text-[13px] font-bold text-slate-900 mt-0.5">{title}</div>
      <div className="text-xs text-slate-600 leading-relaxed mt-0.5">{desc}</div>
      {kpi && (
        <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-lg mt-1.5 border ${kpiColors[kpiColor || "green"]}`}>
          {kpi}
        </span>
      )}
    </div>
  );
}

function ValuationMethodCard({ name, low, high, basis, color }: {
  name: string;
  low: string;
  high: string;
  basis: string;
  color: "emerald" | "sky" | "amber";
}) {
  const colors: Record<string, { ring: string; text: string; bg: string }> = {
    emerald: { ring: "ring-emerald-300/40", text: "text-emerald-300", bg: "bg-emerald-500/10" },
    sky: { ring: "ring-sky-300/40", text: "text-sky-300", bg: "bg-sky-500/10" },
    amber: { ring: "ring-amber-300/40", text: "text-amber-300", bg: "bg-amber-500/10" },
  };
  const c = colors[color];
  return (
    <div className={`rounded-lg ${c.bg} ring-1 ${c.ring} p-4`}>
      <div className="text-[10px] uppercase tracking-widest text-white/60 font-bold mb-1">{name}</div>
      <div className={`text-2xl font-extrabold ${c.text}`}>{low} <span className="text-white/50 text-base font-semibold">–</span> {high}</div>
      <div className="text-[11px] text-white/70 mt-1.5 leading-snug">{basis}</div>
    </div>
  );
}

export function MADashboardContent(p: Props) {
  const opusShare = p.last30dCost > 0 ? ((p.costByModel["claude-opus-4-6"] || 0) / p.last30dCost * 100) : 0;
  const sonnetShare = p.last30dCost > 0 ? ((p.costByModel["claude-sonnet-4-6"] || 0) / p.last30dCost * 100) : 0;
  const photoCost = p.costByStep["analyze_photos"] || 0;
  const measurementCost = p.costByStep["extract_measurements"] || 0;
  const carrierScopeCost = p.costByStep["extract_carrier_scope"] || 0;
  const integrityCost = p.costByStep["photo_integrity"] || 0;
  const winRate = p.totalClaims > 0 ? (p.wins / p.totalClaims * 100) : 0;
  const avgWinSettlement = p.wins > 0 ? p.winSettlementTotal / p.wins : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page Header */}
      <div className="px-4 sm:px-8 pt-6 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">M&amp;A Dashboard</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Confidential investor overview · Live data from Supabase · Generated {new Date().toLocaleDateString("en-US", { dateStyle: "medium" })}
          </p>
        </div>
      </div>

      {/* Unbiased Valuation — three methodologies side-by-side */}
      <div className="mx-4 sm:mx-8 mt-4 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 ring-1 ring-amber-500/30 p-7">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-5">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-white/60 font-bold">Unbiased Current Valuation</div>
            <div className="text-3xl font-black text-amber-400 mt-1">
              {fmtMoneyShort(4_000_000)} <span className="text-white/40 text-xl">–</span> {fmtMoneyShort(12_000_000)}
            </div>
            <div className="text-xs text-white/60 mt-1">Triangulated from 3 independent methodologies (see below)</div>
          </div>
          <div className="text-xs text-white/50 leading-relaxed max-w-md">
            Pre-revenue (Stripe billing live · 0 paying users yet). Floor anchored by patent + data warehouse + production
            codebase. Ceiling anchored by comparable seed-stage InsurTech transactions with PMF signal.
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ValuationMethodCard
            color="emerald"
            name="Asset Floor (replacement cost)"
            low="$2.0M"
            high="$3.5M"
            basis="USPTO provisional patent ($150–300K) + 123K-row warehouse + 13-state Xactimate dataset ($800K–1.5M to recreate) + production codebase + brand/domains/trademarks"
          />
          <ValuationMethodCard
            color="sky"
            name="Comparable Pre-Revenue InsurTech"
            low="$5M"
            high="$10M"
            basis="Seed-stage vertical SaaS in InsurTech / claims automation with patent + production traction (Hover, Companion, Kanopi typical $5–15M)"
          />
          <ValuationMethodCard
            color="amber"
            name="Forward DCF on Unit Economics"
            low="$6M"
            high="$15M"
            basis={`93%+ gross margin (cost ${fmtMoney(p.avgCostPerClaim30d, 2)}/claim vs $30–50 revenue). 100 paying users at avg $999/mo = $1.2M ARR · 8–12× SaaS multiple`}
          />
        </div>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-white/70">
          <div>
            <span className="text-white/50">Path to $25M+:</span> first $1M ARR (≈100 paying users) + 2nd patent claim portfolio + first carrier partnership.
          </div>
          <div>
            <span className="text-white/50">Path to $100M+:</span> $10M ARR (Series A territory) + 5+ state DOI carrier-issue resolutions + acquisition discussions with carriers/PA networks.
          </div>
        </div>
      </div>

      {/* Key Metrics Bar */}
      <div className="mx-4 sm:mx-8 mt-4 grid grid-cols-3 md:grid-cols-6 gap-px bg-slate-300 rounded-xl overflow-hidden ring-1 ring-slate-300">
        {[
          { label: "Total Claims", value: String(p.totalClaims), accent: "text-slate-900" },
          { label: "Companies (Signups)", value: String(p.companies), accent: "text-amber-700" },
          { label: "Wins", value: String(p.wins), accent: "text-emerald-700" },
          { label: "30-Day Claims", value: String(p.claims30d), accent: "text-sky-700" },
          { label: "Avg Cost / Claim", value: fmtMoney(p.avgCostPerClaim30d, 2), accent: "text-emerald-700" },
          { label: "Inspector Apps", value: String(p.inspectorApps), accent: "text-amber-700" },
        ].map((m) => (
          <div key={m.label} className="bg-white py-3.5 px-4 text-center">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{m.label}</div>
            <div className={`text-xl font-extrabold ${m.accent}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Growth Signals */}
      <div className="text-xs uppercase tracking-widest text-slate-500 font-bold px-4 sm:px-8 pt-6 pb-2">Growth Signals (Live)</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="User Acquisition" badge={`+${p.companies30d} in 30d`} badgeColor="green">
          <MetricRow label="Total Companies (Signups)" value={String(p.companies)} color="amber" />
          <MetricRow label="Auth Users (incl. team)" value={String(p.saasUsers)} color="sky" />
          <MetricRow label="New Companies (Last 30d)" value={String(p.companies30d)} color="emerald" />
          <MetricRow label="Inspector Applications" value={String(p.inspectorApps)} color="amber" />
          <MetricRow label="Latest white-glove rescue" value="Team Builders, IA · 2026-05-05" sub="First-day signup save: logo conversion, Iowa pricing, profile enrichment" />
        </Panel>

        <Panel title="Claims Pipeline" badge={`${p.totalClaims} processed`} badgeColor="blue">
          <BarChart label="Total Claims" value={String(p.totalClaims)} pct={100} color="#0ea5e9" />
          <BarChart label="Last 30 days" value={String(p.claims30d)} pct={(p.claims30d / Math.max(p.totalClaims, 1)) * 100} color="#10b981" />
          <BarChart label="Last 7 days" value={String(p.claims7d)} pct={(p.claims7d / Math.max(p.totalClaims, 1)) * 100} color="#f59e0b" />
          <BarChart label="Wins (lifetime)" value={String(p.wins)} pct={(p.wins / Math.max(p.totalClaims, 1)) * 100} color="#059669" />
          <div className="mt-3 text-xs text-slate-700">
            Win Rate: <strong className="text-slate-900">{winRate.toFixed(1)}%</strong> ({p.wins}/{p.totalClaims} claims) ·
            most claims still pre-scope or in-flight
          </div>
        </Panel>

        <Panel title="Financial Track Record" badge={`${fmtMoneyShort(p.winCarrierMovement)} moved`} badgeColor="gold">
          <MetricRow label="Total DumbRoof RCV" value={fmtMoneyShort(p.totalContractorRCV)} sub={`${(p.totalContractorRCV / Math.max(p.totalClaims, 1)).toFixed(0)} avg per claim`} />
          <MetricRow label="Total Carrier RCV" value={fmtMoneyShort(p.totalCarrierRCV)} />
          <MetricRow label="Total Variance Identified" value={fmtMoneyShort(p.totalVariance)} color="emerald" />
          <MetricRow label="Won Settlements (sum)" value={fmtMoneyShort(p.winSettlementTotal)} color="amber" />
          <MetricRow label="Carrier Movement (Wins)" value={fmtMoneyShort(p.winCarrierMovement)} color="emerald"
                     sub={`Avg win: ${fmtMoneyShort(avgWinSettlement)} settlement`} />
        </Panel>
      </div>

      {/* Cost Audit */}
      <div className="text-xs uppercase tracking-widest text-slate-500 font-bold px-4 sm:px-8 pt-3 pb-2">
        Cost-per-Claim Economics (Last 30 Days, Live Telemetry)
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="Cost per Claim" badge="Live: processing_logs" badgeColor="green">
          <div className="text-center py-3">
            <div className="text-5xl font-black text-slate-900">{fmtMoney(p.avgCostPerClaim30d, 2)}</div>
            <div className="text-xs text-slate-600 mt-1.5">avg per claim · last 30 days · {p.last30dClaimCount} claims</div>
          </div>
          <div className="border-t border-slate-100 mt-2 pt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md bg-slate-50 p-2">
              <div className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider">30-day Spend</div>
              <div className="text-base font-extrabold text-slate-900">{fmtMoney(p.last30dCost, 2)}</div>
            </div>
            <div className="rounded-md bg-slate-50 p-2">
              <div className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider">Distinct Claims</div>
              <div className="text-base font-extrabold text-slate-900">{p.last30dClaimCount}</div>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-slate-600 leading-relaxed">
            Numerator: every <code className="bg-slate-100 px-1 rounded text-[10px]">total_cost</code> on{" "}
            <code className="bg-slate-100 px-1 rounded text-[10px]">processing_logs</code>. Denominator: distinct
            claim_ids in the same window. Includes reprocesses, which inflates the avg slightly above per-claim COGS.
          </div>
        </Panel>

        <Panel title="Cost by Model" badge={`Opus dominant (${opusShare.toFixed(0)}%)`} badgeColor="purple">
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 mb-3">
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[13px] font-bold text-slate-900">Claude Opus 4.6</span>
              <span className="text-lg font-extrabold text-violet-700">{fmtMoney(p.costByModel["claude-opus-4-6"] || 0, 2)}</span>
            </div>
            <div className="text-xs text-slate-600">{opusShare.toFixed(1)}% of total spend · governance v2 default model (forensic, photo, synthesis)</div>
            <div className="text-[11px] text-slate-500 mt-1">$15/M input · $75/M output</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[13px] font-bold text-slate-900">Claude Sonnet 4.6</span>
              <span className="text-lg font-extrabold text-sky-700">{fmtMoney(p.costByModel["claude-sonnet-4-6"] || 0, 2)}</span>
            </div>
            <div className="text-xs text-slate-600">{sonnetShare.toFixed(1)}% · used for cheap extractions; mostly displaced by Opus after governance v2</div>
            <div className="text-[11px] text-slate-500 mt-1">$3/M input · $15/M output</div>
          </div>
        </Panel>

        <Panel title="Top Cost Centers (Steps)" badge="Photo analysis #1" badgeColor="red">
          {[
            { title: "Photo Analysis", amount: photoCost, color: "border-l-rose-500", desc: "Per-photo damage tagging + annotations (Vision)" },
            { title: "Measurements Extract", amount: measurementCost, color: "border-l-violet-500", desc: "EagleView PDF parse" },
            { title: "Carrier Scope Extract", amount: carrierScopeCost, color: "border-l-amber-500", desc: "Carrier-supplied scope PDF parse" },
            { title: "Photo Integrity", amount: integrityCost, color: "border-l-sky-500", desc: "EXIF + duplicate + edit-detection forensics" },
          ].map((c) => {
            const pct = p.last30dCost > 0 ? (c.amount / p.last30dCost * 100) : 0;
            return (
              <div key={c.title} className={`bg-slate-50 rounded-lg p-3 border border-slate-200 border-l-[4px] ${c.color} mb-2.5 last:mb-0`}>
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="text-[13px] font-bold text-slate-900">{c.title}</span>
                  <span className="text-base font-extrabold text-slate-900">{fmtMoney(c.amount, 2)} <span className="text-xs text-slate-500 font-medium">({pct.toFixed(0)}%)</span></span>
                </div>
                <div className="text-xs text-slate-600">{c.desc}</div>
              </div>
            );
          })}
        </Panel>
      </div>

      {/* Revenue Model */}
      <div className="text-xs uppercase tracking-widest text-slate-500 font-bold px-4 sm:px-8 pt-3 pb-2">Revenue Model</div>
      <div className="px-4 sm:px-8 pb-4">
        <Panel title="Stripe Billing Tiers (Live)" badge="Billing live · 0 paying users yet" badgeColor="gold">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <TierCard name="Starter" price="$0" claims="3 free claims" cpc="$0/claim" />
            <TierCard name="Pro" price="$499" claims="10 claims/mo" cpc="$49.90/claim" />
            <TierCard name="Growth" price="$999" claims="30 claims/mo" cpc="$33.30/claim" popular />
            <TierCard name="Enterprise" price="$2,999" claims="100 claims/mo" cpc="$29.99/claim" />
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
              <div className="text-emerald-800 font-bold mb-0.5">Gross Margin @ Enterprise</div>
              <div className="text-slate-700">$29.99 rev − {fmtMoney(p.avgCostPerClaim30d, 2)} COGS = <strong className="text-emerald-700">{fmtMoney(29.99 - p.avgCostPerClaim30d, 2)} ({((29.99 - p.avgCostPerClaim30d) / 29.99 * 100).toFixed(1)}%)</strong></div>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <div className="text-amber-800 font-bold mb-0.5">25 users @ avg $999</div>
              <div className="text-slate-700"><strong>$24.9K MRR</strong> · $300K ARR</div>
            </div>
            <div className="rounded-lg bg-sky-50 border border-sky-200 p-3">
              <div className="text-sky-800 font-bold mb-0.5">$75 overage live for paid plans</div>
              <div className="text-slate-700">Pro/Growth/Enterprise no longer hard-block at cap · soft-overage modal once per cycle</div>
            </div>
          </div>
        </Panel>
      </div>

      {/* IP Portfolio + AI Modules */}
      <div className="text-xs uppercase tracking-widest text-slate-500 font-bold px-4 sm:px-8 pt-3 pb-2">Intellectual Property &amp; Data Moat</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 sm:px-8 pb-4">
        <Panel title="IP Portfolio" badge="Patent filed" badgeColor="gold">
          <MetricRow label="USPTO Provisional Patent" value="Filed 2026-02-26" sub="66 claims, 18 figures · covers AI photo analysis, forensic synthesis, damage scoring, evidence cascade" />
          <MetricRow label="Non-Provisional Deadline" value="2027-02-26" color="rose" sub="9.7 months remaining · firm hire decision pending" />
          <MetricRow label="Trademarks" value="dumbroof.ai (filed) + 3 pending" />
          <MetricRow label="Entity" value="Dumb Roof Technologies LLC" sub="Wyoming · EIN 41-4822546 · Member-managed" />
          <MetricRow label="Domains" value="dumbroof.ai + dumbroof.com" />
          <MetricRow label="Annotation Training Data" value="Proprietary" color="emerald" sub="Tom + customer corrections fed back into few-shot loop · 20-row cap per claim" />
        </Panel>

        <Panel title="Data Warehouse + Coverage" badge="51 tables" badgeColor="purple">
          <MetricRow label="Supabase Rows (warehouse)" value="123,942+" sub="51 tables · claim_outcomes, pricing_benchmarks, photos, line_items" />
          <MetricRow label="Xactimate Markets (live)" value="129 markets · 13 states" sub="NY/NJ/PA/MD/DE/OH/MI/IL/MN/TX/IA/KS/OK · added IA/KS/OK 2026-05-05" />
          <MetricRow label="ZIP Prefix Coverage" value="341 prefixes" sub="Auto-routes claims to nearest priced market" />
          <MetricRow label="Nearest-State Fallback" value="37 unpriced states + DC + 5 territories" sub="No more silent NY default · all 50 states have pricing now (native or substituted)" />
          <MetricRow label="Carrier Playbooks" value="16+" sub="Per-carrier tactics, arguments, settlement patterns" />
          <MetricRow label="API Integrations" value="AccuLynx, EagleView, HailTrace, NOAA, Apollo, Stripe, Resend, Supabase" sub="Plus Cloudflare for inbound email + Vercel for frontend" />
        </Panel>
      </div>

      {/* Recent Development Timeline */}
      <div className="text-xs uppercase tracking-widest text-slate-500 font-bold px-4 sm:px-8 pt-3 pb-2">Recent Development Timeline (last 60 days)</div>
      <div className="px-4 sm:px-8 pb-4">
        <Panel title="Shipping Velocity">
          <TimelineItem
            date="May 5"
            title="E209 / E210 / E210b — Logo + IA pricing white-glove rescue"
            desc="Team Builders (first IA contractor signup) PDF rescued: .ai logo converted to PNG, Iowa Waterloo native pricing applied, exec-summary cause-of-loss locked to user selection. 4 commits + memory updates + email shipped."
            color="green" kpi="First-day signup save" kpiColor="green"
          />
          <TimelineItem
            date="May 5"
            title="IA / KS / OK Xactimate pricing live"
            desc="Alfonso pushed Iowa (10 markets) + Kansas (5) + Oklahoma (6). Total priced states 10 → 13. 129 markets, 341 ZIP prefixes. Geographic-nearest-state fallback for the remaining 37 states."
            color="gold" kpi="13 priced states" kpiColor="gold"
          />
          <TimelineItem
            date="May 4"
            title="Richard Governance v2 SHIPPED"
            desc="9 PRs + 2 hotfixes. Pre-flight middleware, two-tier approval, rate-limited reprocess, auto-chain rules, working memory, 5 new mutation tools, externalized prompts, eval harness, health canary."
            color="purple" kpi="3-layer governance · Opus default" kpiColor="purple"
          />
          <TimelineItem
            date="May 3"
            title="Market-aware Xactimate pricing (E202)"
            desc="108 markets across NY/NJ/PA/MD/DE/OH/MI/IL/MN/TX wired into PDF builder + validator. Single source of truth via get_market_prices(). Fixed 6-week silent NY-fallback bug affecting every TX/OH/IL/MI/MN claim."
            color="teal" kpi="6-week silent bug killed" kpiColor="blue"
          />
          <TimelineItem
            date="May 1"
            title="Brand-leak isolation (E196 + E199 + E201)"
            desc="Personal-domain users (gmail, yahoo) no longer inherit cross-account brand identity. NOAA SWDI fallback for recent storms. QA auditor adds deterministic brand/PDF/NOAA checks before LLM prose."
            color="red" kpi="Brand-isolation hardened" kpiColor="red"
          />
          <TimelineItem
            date="Apr 25"
            title="Billing rebuild — team-pooled subs"
            desc="Two-layer quota gate, $99 universal seat price, $75/claim soft-overage for paid plans. USARM @ $3,791/mo recurring. Stripe metered prices via Billing Meters API."
            color="green" kpi="Billing architecture v2" kpiColor="green"
          />
          <TimelineItem
            date="Apr 17"
            title="Cloudflare WAF fix — Resend 0/9 → 9/9"
            desc="urllib hits to Resend / Apollo / Supabase were silently 403'd by Cloudflare bot-fight. Mozilla User-Agent on every urlopen + try/except for HTTPError body capture."
            color="gold" kpi="Email delivery restored" kpiColor="gold"
          />
          <TimelineItem
            date="Apr 14"
            title="Richard agentic — 14 → 43 tools"
            desc="Dual install: /dashboard scope=user + /admin scope=company (owner/admin role-gated). Floating RichardLauncher. Drop-AOB flagship flow live. Public x402 API + Coinbase pitch."
            color="purple" kpi="43-tool agentic Claim Brain" kpiColor="purple"
          />
          <TimelineItem
            date="Mar 16"
            title="Scope Comparison Engine"
            desc="EagleView-first methodology, intent search, carrier-trick detection, I&W formula. Multi-file extraction fix."
            color="teal"
          />
          <TimelineItem
            date="Mar 12"
            title="Cost telemetry rebuild"
            desc="Opus 3x cost overestimate fixed, cache tracking, retry logging, Gmail + repair calls instrumented. Service add-ons documented."
            color="slate" kpi="Cost-per-claim trustable" kpiColor="blue"
          />
          <TimelineItem
            date="Feb 26"
            title="USPTO Provisional Patent filed"
            desc="66 claims, 18 figures. Covers AI photo analysis, forensic synthesis, damage scoring, evidence cascade methodology."
            color="gold" kpi="Non-provisional due Feb 2027" kpiColor="gold"
          />
        </Panel>
      </div>

      {/* KPI Scorecard */}
      <div className="text-xs uppercase tracking-widest text-slate-500 font-bold px-4 sm:px-8 pt-3 pb-2">KPI Scorecard</div>
      <div className="px-4 sm:px-8 pb-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-600 font-bold w-[35%]">KPI</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-600 font-bold w-[22%]">Current</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-600 font-bold w-[22%]">Target ($25M+ valuation)</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-600 font-bold w-[21%]">Gap / Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { kpi: "Unbiased Valuation Range", current: "$4M – $12M", target: "$25M – $40M", gap: "Need first $1M ARR", cColor: "text-amber-700 font-extrabold" },
                  { kpi: "ARR (recognized)", current: "$0 (billing live)", target: "$1M+ (Series A floor)", gap: "Pre-revenue", gColor: "text-rose-700" },
                  { kpi: "Companies (signups)", current: String(p.companies), target: "100+", gap: `${Math.max(100 - p.companies, 0)} to go`, cColor: "text-amber-700 font-extrabold" },
                  { kpi: "30-Day Companies Added", current: String(p.companies30d), target: "20+/mo", gap: p.companies30d >= 20 ? "On track" : `${Math.max(20 - p.companies30d, 0)} to go`, gColor: p.companies30d >= 20 ? "text-emerald-700 font-bold" : "text-amber-700 font-bold" },
                  { kpi: "Total Claims Processed", current: String(p.totalClaims), target: "5,000+", gap: `${Math.max(5000 - p.totalClaims, 0)} to go`, cColor: "text-sky-700 font-extrabold" },
                  { kpi: "Win Rate", current: `${winRate.toFixed(1)}%`, target: "30%+", gap: winRate >= 30 ? "Exceeds" : `${(30 - winRate).toFixed(1)}% gap`, gColor: winRate >= 30 ? "text-emerald-700 font-bold" : "text-amber-700" },
                  { kpi: "Carrier Movement (Wins)", current: fmtMoneyShort(p.winCarrierMovement), target: "$10M+", gap: fmtMoneyShort(Math.max(10_000_000 - p.winCarrierMovement, 0)) },
                  { kpi: "Total Variance Identified", current: fmtMoneyShort(p.totalVariance), target: "—", gap: "Asset", gColor: "text-emerald-700 font-bold" },
                  { kpi: "Cost per Claim (COGS)", current: fmtMoney(p.avgCostPerClaim30d, 2), target: "<$5.00", gap: p.avgCostPerClaim30d < 5 ? "On target" : "Over target", cColor: "text-emerald-700 font-extrabold", gColor: p.avgCostPerClaim30d < 5 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold" },
                  { kpi: "Gross Margin @ Enterprise", current: `${((29.99 - p.avgCostPerClaim30d) / 29.99 * 100).toFixed(1)}%`, target: "85%+", gap: ((29.99 - p.avgCostPerClaim30d) / 29.99) >= 0.85 ? "Exceeds" : "Gap", gColor: ((29.99 - p.avgCostPerClaim30d) / 29.99) >= 0.85 ? "text-emerald-700 font-bold" : "text-amber-700" },
                  { kpi: "Inspector Applications", current: String(p.inspectorApps), target: "50+", gap: `${Math.max(50 - p.inspectorApps, 0)} to go`, cColor: "text-amber-700 font-bold" },
                  { kpi: "Priced Xactimate States", current: "13", target: "All 50", gap: "37 via nearest fallback", gColor: "text-emerald-700 font-bold" },
                  { kpi: "Data Warehouse Rows", current: "123,942+", target: "100,000+", gap: "Exceeds", gColor: "text-emerald-700 font-bold" },
                  { kpi: "Carrier Playbooks", current: "16+", target: "30+", gap: "14 to go" },
                  { kpi: "USPTO Non-Provisional", current: "Provisional filed", target: "Non-prov by 2027-02-26", gap: "9.7 months", gColor: "text-amber-700 font-bold" },
                  { kpi: "AI Modules in Production", current: "6", target: "5+", gap: "Exceeds", gColor: "text-emerald-700 font-bold" },
                  { kpi: "Code Coverage (E-numbers tracked)", current: "210", target: "—", gap: "Operational maturity signal", gColor: "text-slate-700" },
                ].map((r) => (
                  <tr key={r.kpi} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{r.kpi}</td>
                    <td className={`px-4 py-2.5 text-slate-900 ${r.cColor || ""}`}>{r.current}</td>
                    <td className="px-4 py-2.5 text-slate-700">{r.target}</td>
                    <td className={`px-4 py-2.5 ${r.gColor || "text-slate-700"}`}>{r.gap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Risks & Priority Actions */}
      <div className="text-xs uppercase tracking-widest text-slate-500 font-bold px-4 sm:px-8 pt-3 pb-2">Risks · Priority Actions</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 sm:px-8 pb-6">
        <Panel title="Active Blockers" badge="Action required" badgeColor="red">
          {[
            { label: "Zero recognized ARR", value: "Billing live; convert first paid customer", tone: "rose" },
            { label: "USPTO non-provisional", value: "Due 2027-02-26 · firm hire decision needed", tone: "amber" },
            { label: "Auto-convert pipeline", value: "Open work — manual logo conversion only (E209a)", tone: "amber" },
            { label: "First-claim profile enrichment", value: "Open work — manual scrape + patch only", tone: "amber" },
            { label: "BMP / TIFF logo support", value: "Magic-byte detector misses these (some Photoshop exports)", tone: "amber" },
            { label: "Anthropic credits auto-reload", value: "Out-of-credits = 400s mid-claim · enable Tier-4 auto-reload", tone: "rose" },
          ].map((b) => (
            <div key={b.label} className="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-b-0">
              <span className={`text-[13px] font-semibold ${b.tone === "rose" ? "text-rose-700" : "text-amber-700"}`}>{b.label}</span>
              <span className={`text-xs font-bold ${b.tone === "rose" ? "text-rose-600" : "text-amber-600"}`}>{b.value}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Priority Actions (Next 30 days)" badge="Compounding wins" badgeColor="gold">
          {[
            { label: "1. Convert Team Builders → first paid", value: "White-glove playbook proven; capture conversion" },
            { label: "2. Daily incomplete-profile cron", value: "Automate the white-glove rescue (E209a + signup-enrich)" },
            { label: "3. Tom's M&A advisor outreach", value: "Take refreshed valuation deck to Jared + Marcus" },
            { label: "4. Add 5 more carrier playbooks", value: "Liberty Mutual, Allstate, State Farm next-tier" },
            { label: "5. Mike Coday outreach", value: "469-member roofing-contractor FB group" },
            { label: "6. 100-signup ARR projection model", value: "Tighten DCF inputs for next valuation refresh" },
          ].map((a) => (
            <div key={a.label} className="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-b-0">
              <span className="text-[13px] font-semibold text-slate-900">{a.label}</span>
              <span className="text-xs text-slate-600">{a.value}</span>
            </div>
          ))}
        </Panel>
      </div>

      {/* Footer */}
      <div className="text-center py-6 px-8 border-t border-slate-200 mx-4 sm:mx-8 mb-4 text-xs text-slate-600">
        <strong className="text-slate-900">Dumb Roof Technologies LLC</strong> · Confidential M&amp;A Advisor Report
        <br />Tom Kovack Jr. · TKovack@USARoofMasters.com · 267-679-1504
        <br /><span className="text-slate-500 mt-1 inline-block">Live data from Supabase · Cost telemetry from processing_logs · Refreshes every page load</span>
      </div>
    </div>
  );
}
