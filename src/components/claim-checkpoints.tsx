"use client";

import { useEffect, useState } from "react";

export interface CheckpointStatus {
  done: boolean;
  at: string | null;
}

export interface CheckpointSet {
  forensic: CheckpointStatus;
  supplement: CheckpointStatus;
  coc: CheckpointStatus;
  engagement: CheckpointStatus;
  check_received: CheckpointStatus;
}

type Mode = "fetch" | "prefetched";

interface FetchProps {
  mode?: "fetch";
  claimId: string;
  size?: "sm" | "md";
}

interface PrefetchedProps {
  mode: "prefetched";
  checkpoints: CheckpointSet;
  size?: "sm" | "md";
}

type Props = FetchProps | PrefetchedProps;

const LABELS: Record<keyof CheckpointSet, string> = {
  forensic: "Forensic sent",
  supplement: "Supplement sent",
  coc: "COC sent",
  engagement: "Homeowner engagement",
  check_received: "Check received",
};

const ORDER: (keyof CheckpointSet)[] = [
  "forensic",
  "supplement",
  "coc",
  "engagement",
  "check_received",
];

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function ClaimCheckpoints(props: Props) {
  const size = props.size ?? "md";
  const [data, setData] = useState<CheckpointSet | null>(
    props.mode === "prefetched" ? props.checkpoints : null
  );
  const [loading, setLoading] = useState(props.mode !== "prefetched");

  useEffect(() => {
    if (props.mode === "prefetched") return;
    let cancelled = false;
    fetch(`/api/claim/${props.claimId}/checkpoints`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.checkpoints) setData(json.checkpoints);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props]);

  const dotSize = size === "sm" ? "w-2.5 h-2.5" : "w-3.5 h-3.5";
  const gap = size === "sm" ? "gap-1.5" : "gap-2";

  if (loading || !data) {
    return (
      <div className={`flex items-center ${gap}`}>
        {ORDER.map((k) => (
          <span
            key={k}
            className={`${dotSize} rounded-full bg-white/[0.06] animate-shimmer`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`flex items-center ${gap}`} role="status">
      {ORDER.map((key) => {
        const cp = data[key];
        const isMoney = key === "check_received";
        const doneColor = isMoney ? "var(--green)" : "var(--cyan)";
        return (
          <span
            key={key}
            className={`${dotSize} rounded-full border transition-colors`}
            style={{
              background: cp.done ? doneColor : "transparent",
              borderColor: cp.done ? doneColor : "var(--gray-dim)",
            }}
            title={
              cp.done
                ? `${LABELS[key]} — ${fmtWhen(cp.at)}`
                : `${LABELS[key]} — not yet`
            }
            aria-label={
              cp.done
                ? `${LABELS[key]} done ${fmtWhen(cp.at)}`
                : `${LABELS[key]} not done`
            }
          />
        );
      })}
    </div>
  );
}
