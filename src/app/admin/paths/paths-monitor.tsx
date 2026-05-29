"use client";

import { useEffect, useState, useCallback } from "react";

type Data = {
  generatedAt: string;
  gaConnected: boolean;
  activeNow: number;
  realtime: { page: string; users: number; views: number }[];
  topPaths: { path: string; views: number; users: number; sessions: number }[];
  landingPages: { page: string; sessions: number; users: number }[];
  funnel: {
    adClicks7d: number;
    signups7d: number;
    signupsAll: number;
    activatedAll: number;
    paidAll: number;
    convAdToSignup: number | null;
    convSignupToActivated: number | null;
    convActivatedToPaid: number | null;
  };
};

const REFRESH_MS = 45_000;
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);
const n = (v: number) => v.toLocaleString();

export function PathsMonitor() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ago, setAgo] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/paths", { cache: "no-store" });
      if (!r.ok) {
        setErr(r.status === 403 ? "Admin access required." : r.status === 401 ? "Please sign in." : `Error ${r.status}`);
        setLoading(false);
        return;
      }
      setData(await r.json());
      setErr(null);
      setAgo(0);
    } catch {
      setErr("Failed to load");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    const a = setInterval(() => setAgo((s) => s + 1), 1000);
    return () => {
      clearInterval(t);
      clearInterval(a);
    };
  }, [load]);

  if (loading) return <Shell><div className="text-white/40 text-sm">Loading live funnel…</div></Shell>;
  if (err) return <Shell><div className="text-rose-300/80 text-sm">{err}</div></Shell>;
  if (!data) return null;

  const f = data.funnel;
  // The leak = the lowest conversion step (highlight it red).
  const convs = [
    { key: "ad→signup", v: f.convAdToSignup },
    { key: "signup→activated", v: f.convSignupToActivated },
    { key: "activated→paid", v: f.convActivatedToPaid },
  ].filter((c) => c.v != null);
  const worst = convs.length ? convs.reduce((a, b) => ((a.v ?? 1) <= (b.v ?? 1) ? a : b)).key : "";

  const steps = [
    { label: "Ad clicks", sub: "/fb/* · 7d", value: f.adClicks7d, conv: null as number | null, convKey: "" },
    { label: "Signups", sub: "7d", value: f.signups7d, conv: f.convAdToSignup, convKey: "ad→signup" },
    { label: "Activated", sub: "≥1 claim · all-time", value: f.activatedAll, conv: f.convSignupToActivated, convKey: "signup→activated" },
    { label: "Paid", sub: "all-time", value: f.paidAll, conv: f.convActivatedToPaid, convKey: "activated→paid" },
  ];

  return (
    <Shell>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white/95 text-lg font-medium tracking-tight">Live Funnel</h1>
          <div className="text-white/35 text-[12px]">
            GA4 paths + your activation funnel · auto-refresh 45s · updated {ago}s ago
            {!data.gaConnected && <span className="text-amber-400/80"> · GA4 not connected</span>}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
          </span>
          <span className="text-white/85 text-sm"><b className="text-white">{data.activeNow}</b> on site now</span>
          <button onClick={load} className="ml-2 text-white/40 hover:text-white/80 text-xs border border-white/10 rounded-lg px-2.5 py-1 transition-colors">Refresh</button>
        </div>
      </div>

      {/* Funnel chain */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-8">
        {steps.map((s, i) => {
          const isLeak = s.convKey === worst && s.conv != null;
          return (
            <div key={s.label} className="relative rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
              {i > 0 && (
                <div className={`absolute -left-[7px] top-1/2 -translate-y-1/2 text-[10px] hidden lg:block ${isLeak ? "text-rose-400" : "text-white/30"}`}>▶</div>
              )}
              <div className="text-[11px] uppercase tracking-wide text-white/35">{s.label}</div>
              <div className="text-white/45 text-[10px] mb-1.5">{s.sub}</div>
              <div className="text-2xl font-semibold text-white tabular-nums">{n(s.value)}</div>
              {s.conv != null && (
                <div className={`mt-1.5 text-[12px] ${isLeak ? "text-rose-400 font-medium" : "text-white/45"}`}>
                  {pct(s.conv)} convert{isLeak ? " ← biggest leak" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Realtime + tables */}
      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title={`On the site now (realtime)`}>
          {data.realtime.length === 0 ? (
            <Empty>No active visitors this moment</Empty>
          ) : (
            data.realtime.map((r, i) => (
              <Line key={i} left={r.page} right={`${r.users}`} />
            ))
          )}
        </Panel>
        <Panel title="Where visitors enter (landing pages · 7d)">
          {data.landingPages.slice(0, 10).map((r, i) => (
            <Line key={i} left={r.page} right={`${n(r.sessions)}`} />
          ))}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Top paths (7d) — views / users / sessions">
          {data.topPaths.slice(0, 20).map((r, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
              <span className="text-white/70 text-[13px] font-mono truncate pr-3">{r.path}</span>
              <span className="text-white/45 text-[12px] tabular-nums whitespace-nowrap">
                {n(r.views)} <span className="text-white/20">/</span> {n(r.users)} <span className="text-white/20">/</span> {n(r.sessions)}
              </span>
            </div>
          ))}
        </Panel>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#08080c] text-white px-5 py-7">
      <div className="max-w-4xl mx-auto">{children}</div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="text-white/45 text-[11px] uppercase tracking-wide mb-2.5">{title}</div>
      <div>{children}</div>
    </div>
  );
}
function Line({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-white/70 text-[13px] truncate pr-3">{left}</span>
      <span className="text-white/85 text-[13px] tabular-nums">{right}</span>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-white/30 text-[13px] py-2">{children}</div>;
}
