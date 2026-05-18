"use client";

import Link from "next/link";

export interface ClaimGridCheckpoints {
  forensic: { done: boolean; at: string | null };
  supplement: { done: boolean; at: string | null };
  coc: { done: boolean; at: string | null };
  engagement: { done: boolean; at: string | null };
  check_received: { done: boolean; at: string | null; amount_cents?: number | null };
}

export interface ClaimGridRow {
  id: string;
  address: string | null;
  homeowner_name: string | null;
  carrier_name: string | null;
  status: string | null;
  rep_user_id: string;
  rep_email: string | null;
  last_touched_at: string | null;
  contractor_rcv: number | null;
  checkpoints: ClaimGridCheckpoints;
  is_scheduled: boolean;
  all_lit: boolean;
}

// Checkpoint config — verb (what's NEEDED if not done), color, deep-link action key.
const DOTS: {
  key: keyof Omit<ClaimGridCheckpoints, "check_received">;
  verb: string;
  done: string;
  color: string;
  actionParam: string;
}[] = [
  { key: "forensic",   verb: "Send forensic",   done: "Forensic sent",   color: "var(--cyan)",  actionParam: "send_forensic" },
  { key: "supplement", verb: "Send supplement", done: "Supplement sent", color: "var(--amber)", actionParam: "send_supplement" },
  { key: "coc",        verb: "Send COC",        done: "COC sent",        color: "var(--blue)",  actionParam: "send_coc" },
  { key: "engagement", verb: "Engage homeowner",done: "Homeowner engaged",color: "var(--pink)", actionParam: "engage_homeowner" },
];

function fmtRcv(total?: number | null): string {
  if (!total) return "—";
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `$${(total / 1_000).toFixed(0)}K`;
  return `$${total.toFixed(0)}`;
}

function fmtMoneyCents(c: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return "today";
  if (d === 1) return "1d";
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

function repName(email: string | null): string {
  if (!email) return "—";
  return email
    .split("@")[0]
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function ClaimRowAction({ claim }: { claim: ClaimGridRow }) {
  const allLit = claim.all_lit;
  const checkDone = claim.checkpoints.check_received.done;
  const checkAmount = claim.checkpoints.check_received.amount_cents;

  return (
    <div
      className={`group rounded-xl border bg-white/[0.02] hover:bg-white/[0.04] transition-colors p-3 ${
        allLit
          ? "border-[var(--green)]/40"
          : "border-[var(--border-glass)]"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* All-lit pip */}
        <span
          className="w-1.5 self-stretch rounded-full flex-shrink-0"
          style={{
            background: allLit ? "var(--green)" : "var(--gray-dim)",
            opacity: allLit ? 1 : 0.3,
          }}
        />

        {/* Left: address + meta */}
        <div className="min-w-0 flex-1">
          <Link
            href={`/dashboard/claim/${claim.id}`}
            className="block text-sm font-semibold text-white hover:text-[var(--cyan)] truncate transition-colors"
          >
            {claim.address ?? claim.id.slice(0, 8)}
          </Link>
          <p className="text-xs text-[var(--gray-muted)] truncate">
            {[
              claim.carrier_name,
              claim.homeowner_name,
              claim.rep_email ? `@ ${repName(claim.rep_email)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {/* Center: checkpoint pills (4 dots).
            md+: full labeled pills. sm-: compact dot row with colored dots
            so reps on phones still see what's done at a glance. */}
        <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
          {DOTS.map((d) => {
            const slot = claim.checkpoints[d.key];
            const done = slot.done;
            return (
              <Link
                key={d.key}
                href={`/dashboard/claim/${claim.id}?action=${d.actionParam}`}
                title={done ? `${d.done}${slot.at ? ` ${timeAgo(slot.at)} ago` : ""}` : d.verb}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                  done
                    ? "opacity-50 hover:opacity-100"
                    : "hover:brightness-125"
                }`}
                style={{
                  color: done ? "var(--gray-muted)" : d.color,
                  background: done
                    ? "transparent"
                    : `color-mix(in srgb, ${d.color} 14%, transparent)`,
                  border: done
                    ? "1px solid var(--border-glass)"
                    : `1px solid color-mix(in srgb, ${d.color} 45%, transparent)`,
                }}
              >
                {done ? (
                  <svg
                    className="w-2.5 h-2.5"
                    style={{ color: "var(--green)" }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: d.color }}
                  />
                )}
                {d.key === "forensic"
                  ? "FOR"
                  : d.key === "supplement"
                    ? "SUP"
                    : d.key === "coc"
                      ? "COC"
                      : "ENG"}
              </Link>
            );
          })}
        </div>

        {/* Mobile-only compact dot row — same semantic info, less real estate */}
        <div className="flex md:hidden items-center gap-1 flex-shrink-0">
          {DOTS.map((d) => {
            const slot = claim.checkpoints[d.key];
            const done = slot.done;
            return (
              <Link
                key={d.key}
                href={`/dashboard/claim/${claim.id}?action=${d.actionParam}`}
                title={done ? `${d.done} (done)` : `Need: ${d.verb}`}
                aria-label={done ? `${d.done} done` : `${d.verb} pending`}
                className="w-3 h-3 rounded-full border transition-all hover:scale-125"
                style={{
                  background: done ? d.color : "transparent",
                  borderColor: done
                    ? d.color
                    : `color-mix(in srgb, ${d.color} 55%, transparent)`,
                }}
              />
            );
          })}
        </div>

        {/* The $ icon — distinct from checkpoint dots, prominent green when collected */}
        <Link
          href={`/dashboard/claim/${claim.id}?action=record_check`}
          title={
            checkDone
              ? `Check ${checkAmount ? fmtMoneyCents(checkAmount) + " " : ""}received ${timeAgo(claim.checkpoints.check_received.at)} ago`
              : "No check collected yet"
          }
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold flex-shrink-0 transition-all ${
            checkDone ? "hover:brightness-125" : "opacity-50 hover:opacity-100"
          }`}
          style={{
            color: checkDone ? "#000" : "var(--gray-muted)",
            background: checkDone ? "var(--green)" : "transparent",
            border: checkDone
              ? "1px solid var(--green)"
              : "1px solid var(--border-glass)",
            boxShadow: checkDone
              ? "0 0 12px color-mix(in srgb, var(--green) 30%, transparent)"
              : undefined,
          }}
        >
          <span className="text-sm leading-none">$</span>
          {checkDone && checkAmount ? (
            <span className="font-mono text-[10px]">{fmtMoneyCents(checkAmount)}</span>
          ) : null}
        </Link>

        {/* RCV + last activity */}
        <div className="text-right flex-shrink-0 hidden sm:block">
          <p className="text-xs font-mono text-white">{fmtRcv(claim.contractor_rcv ?? undefined)}</p>
          <p className="text-[10px] text-[var(--gray-muted)]">{timeAgo(claim.last_touched_at)}</p>
        </div>
      </div>
    </div>
  );
}
