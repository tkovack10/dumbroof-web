"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PipelineCard {
  id: string;
  address: string;
  carrier: string | null;
  rcv: number;
  damage_score: number | null;
  damage_grade: string | null;
  rep_email: string;
  days_in_stage: number;
  created_at: string;
  homeowner_name: string | null;
  claim_number: string | null;
}

interface PipelineData {
  stages: Record<string, PipelineCard[]>;
  totals: Record<string, number>;
}

const stageConfig: {
  key: string;
  label: string;
  color: string;
  bgColor: string;
}[] = [
  { key: "new_leads", label: "New Leads", color: "#3b82f6", bgColor: "rgba(59, 130, 246, 0.15)" },
  { key: "processing", label: "Processing", color: "#f59e0b", bgColor: "rgba(245, 158, 11, 0.15)" },
  { key: "ready", label: "Ready", color: "#22d8ff", bgColor: "rgba(34, 216, 255, 0.15)" },
  { key: "needs_improvement", label: "Needs Work", color: "#f97316", bgColor: "rgba(249, 115, 22, 0.15)" },
  { key: "error", label: "Errors", color: "#ff5a6a", bgColor: "rgba(255, 90, 106, 0.15)" },
  { key: "won", label: "Won", color: "#22c55e", bgColor: "rgba(34, 197, 94, 0.15)" },
  { key: "installation", label: "Installation", color: "#f97316", bgColor: "rgba(249, 115, 22, 0.15)" },
  { key: "completed", label: "Completed", color: "#a855f7", bgColor: "rgba(168, 85, 247, 0.15)" },
  { key: "invoiced", label: "Invoiced", color: "#14b8a6", bgColor: "rgba(20, 184, 166, 0.15)" },
  { key: "paid", label: "Paid", color: "#16a34a", bgColor: "rgba(22, 163, 74, 0.15)" },
];

function fmtMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  if (val === 0) return "--";
  return `$${val.toFixed(0)}`;
}

function DamageScoreBadge({ score, grade }: { score: number | null; grade: string | null }) {
  if (score === null && !grade) return null;

  let ringColor = "var(--gray-dim)";
  if (grade === "A" || grade === "A+") ringColor = "var(--green)";
  else if (grade === "B" || grade === "B+") ringColor = "var(--cyan)";
  else if (grade === "C" || grade === "C+") ringColor = "var(--amber)";
  else if (grade === "D" || grade === "F") ringColor = "var(--red-accent)";

  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
      style={{
        border: `2px solid ${ringColor}`,
        color: ringColor,
      }}
      title={`Damage: ${score ?? "?"} (${grade ?? "?"})`}
    >
      {grade || "?"}
    </div>
  );
}

function KanbanCard({ card }: { card: PipelineCard }) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/dashboard/claim/${card.id}`)}
      className="glass-card p-3.5 cursor-pointer transition-all hover:scale-[1.02] hover:border-[var(--border-glass-active)]"
      style={{ borderRadius: "14px" }}
    >
      {/* Address */}
      <p className="text-sm font-medium text-[var(--white)] truncate" title={card.address}>
        {card.address.length > 30 ? card.address.slice(0, 28) + "..." : card.address}
      </p>

      {/* Carrier + Rep */}
      <div className="flex items-center justify-between mt-1.5">
        {card.carrier ? (
          <span className="text-xs text-[var(--gray-muted)] truncate max-w-[130px]">
            {card.carrier}
          </span>
        ) : (
          <span className="text-xs text-[var(--gray-dim)]">No carrier</span>
        )}
        <span className="text-xs text-[var(--gray-dim)] truncate max-w-[80px]">
          {card.rep_email.split("@")[0]}
        </span>
      </div>

      {/* Bottom row: RCV + Damage Score + Days */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[var(--border-glass)]">
        <span className="text-sm font-semibold font-mono text-[var(--cyan)]">
          {fmtMoney(card.rcv)}
        </span>

        <div className="flex items-center gap-2">
          <DamageScoreBadge score={card.damage_score} grade={card.damage_grade} />
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              background: card.days_in_stage > 7 ? "rgba(255, 90, 106, 0.15)" : "rgba(255, 255, 255, 0.06)",
              color: card.days_in_stage > 7 ? "var(--red-accent)" : "var(--gray-muted)",
            }}
          >
            {card.days_in_stage}d
          </span>
        </div>
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPipeline() {
      try {
        const res = await fetch("/api/admin/pipeline");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }

    fetchPipeline();
    const interval = setInterval(fetchPipeline, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-[1800px] mx-auto">
          <div className="mb-8 pl-10 lg:pl-0">
            <div className="h-8 w-48 bg-white/[0.06] rounded-lg animate-shimmer" />
            <div className="h-4 w-72 bg-white/[0.04] rounded mt-2 animate-shimmer" />
          </div>
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-[280px]">
                <div className="glass-card p-4 mb-3 animate-shimmer">
                  <div className="h-5 w-24 bg-white/[0.06] rounded" />
                </div>
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="glass-card p-4 mb-3 animate-shimmer">
                    <div className="h-4 w-40 bg-white/[0.06] rounded mb-2" />
                    <div className="h-3 w-28 bg-white/[0.04] rounded" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="glass-card p-8 text-center">
            <p className="text-[var(--red-accent)] text-lg font-semibold mb-2">Failed to load pipeline</p>
            <p className="text-[var(--gray-dim)] text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { stages, totals } = data;

  // Count total across all stages
  const totalClaims = Object.values(totals).reduce((a, b) => a + b, 0);

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="mb-6 pl-10 lg:pl-0">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-2xl font-bold gradient-text">Pipeline</h1>
            <span className="text-sm text-[var(--gray-muted)] font-mono">
              {totalClaims} claims
            </span>
          </div>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Track claims through every stage from upload to payment.
          </p>
        </div>

        {/* Stage summary bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          {stageConfig.map((stage) => {
            const count = totals[stage.key] || 0;
            if (count === 0) return null;
            return (
              <div
                key={stage.key}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
                style={{
                  background: stage.bgColor,
                  color: stage.color,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
                {stage.label}: {count}
              </div>
            );
          })}
        </div>

        {/* Kanban Board */}
        <div className="overflow-x-auto pb-4 -mx-6 px-6 lg:-mx-8 lg:px-8">
          <div className="flex gap-4" style={{ minWidth: "fit-content" }}>
            {stageConfig.map((stage) => {
              const cards = stages[stage.key] || [];
              // Skip completely empty non-essential columns to save space
              // Always show core stages even if empty
              const coreStages = ["new_leads", "processing", "ready", "won", "invoiced", "paid"];
              if (cards.length === 0 && !coreStages.includes(stage.key)) return null;

              return (
                <div
                  key={stage.key}
                  className="flex-shrink-0"
                  style={{ width: "280px" }}
                >
                  {/* Column header */}
                  <div
                    className="sticky top-0 z-10 rounded-xl px-4 py-3 mb-3 flex items-center justify-between"
                    style={{
                      background: `linear-gradient(135deg, ${stage.bgColor}, rgba(255,255,255,0.04))`,
                      borderBottom: `2px solid ${stage.color}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      <span className="text-sm font-semibold text-[var(--white)]">
                        {stage.label}
                      </span>
                    </div>
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{
                        background: stage.bgColor,
                        color: stage.color,
                      }}
                    >
                      {cards.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
                    {cards.length > 0 ? (
                      cards.map((card) => (
                        <KanbanCard key={card.id} card={card} />
                      ))
                    ) : (
                      <div className="text-center py-8 px-4">
                        <p className="text-xs text-[var(--gray-dim)]">No claims</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
