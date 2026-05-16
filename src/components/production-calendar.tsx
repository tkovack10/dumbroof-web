"use client";

import { useMemo } from "react";

export interface Schedule {
  id: string;
  claim_id: string;
  crew_id: string | null;
  scheduled_at: string;
  end_at: string | null;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "superseded";
  notify_homeowner: boolean;
  notified_at: string | null;
  notes: string | null;
  claim?: {
    address: string | null;
    homeowner_name: string | null;
    homeowner_email: string | null;
    carrier_name: string | null;
  } | null;
}

export interface Crew {
  id: string;
  name: string;
  color: string;
}

interface Props {
  view: "week" | "month";
  cursor: Date; // any date inside the visible window
  schedules: Schedule[];
  crews: Crew[];
  onScheduleClick: (s: Schedule) => void;
  onEmptySlotClick: (date: Date) => void;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Build a YYYY-MM-DD key from local time components. Using toISOString()
 * here would shift the date back to UTC and bucket evening installs into
 * the previous day for any user west of UTC.
 */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay()); // Sunday-start
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDayHeader(d: Date, isToday: boolean): string {
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const num = d.getDate();
  return isToday ? `${day} ${num} · today` : `${day} ${num}`;
}

export function ProductionCalendar({
  view,
  cursor,
  schedules,
  crews,
  onScheduleClick,
  onEmptySlotClick,
}: Props) {
  const crewColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of crews) map.set(c.id, c.color);
    return map;
  }, [crews]);

  const days: Date[] = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
    }
    // Month view: build a 6x7 grid starting from the Sunday before the 1st
    const first = startOfMonth(cursor);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * DAY_MS));
  }, [view, cursor]);

  // Bucket schedules by local yyyy-mm-dd (NOT UTC — see localDateKey)
  const byDay = useMemo(() => {
    const m = new Map<string, Schedule[]>();
    for (const s of schedules) {
      const k = localDateKey(new Date(s.scheduled_at));
      const list = m.get(k) ?? [];
      list.push(s);
      m.set(k, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    }
    return m;
  }, [schedules]);

  const todayKey = localDateKey(new Date());
  const currentMonth = cursor.getMonth();

  if (view === "week") {
    return (
      <div className="glass-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-[var(--border-glass)]">
          {days.map((d) => {
            const key = localDateKey(d);
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`p-3 text-xs font-semibold uppercase tracking-wide ${
                  isToday ? "text-[var(--cyan)]" : "text-[var(--gray-muted)]"
                }`}
              >
                {fmtDayHeader(d, isToday)}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-7 min-h-[400px]">
          {days.map((d) => {
            const key = localDateKey(d);
            const items = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`border-r border-b border-[var(--border-glass)] last:border-r-0 p-2 space-y-1 min-h-[140px] ${
                  isToday ? "bg-[var(--cyan)]/[0.03]" : ""
                }`}
              >
                {items.map((s) => (
                  <ScheduleChip
                    key={s.id}
                    schedule={s}
                    color={crewColor.get(s.crew_id ?? "") ?? "#22D8FF"}
                    onClick={() => onScheduleClick(s)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => onEmptySlotClick(d)}
                  className="w-full text-left text-xs text-[var(--gray-dim)] hover:text-[var(--cyan)] py-1 transition-colors"
                >
                  + add
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Month grid
  return (
    <div className="glass-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[var(--border-glass)]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="p-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray-muted)] text-center"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const key = d.toISOString().slice(0, 10);
          const items = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const inMonth = d.getMonth() === currentMonth;
          return (
            <button
              type="button"
              key={key}
              onClick={() => onEmptySlotClick(d)}
              className={`min-h-[90px] border-r border-b border-[var(--border-glass)] last:border-r-0 p-1.5 text-left transition-colors hover:bg-white/[0.04] ${
                isToday
                  ? "bg-[var(--cyan)]/[0.05]"
                  : inMonth
                    ? ""
                    : "bg-black/20 opacity-50"
              }`}
            >
              <div
                className={`text-xs font-semibold mb-1 ${
                  isToday ? "text-[var(--cyan)]" : "text-[var(--gray)]"
                }`}
              >
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((s) => (
                  <div
                    key={s.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onScheduleClick(s);
                    }}
                    className="text-[10px] truncate px-1.5 py-0.5 rounded cursor-pointer hover:brightness-125"
                    style={{
                      background: `color-mix(in srgb, ${
                        crewColor.get(s.crew_id ?? "") ?? "#22D8FF"
                      } 25%, transparent)`,
                      color: crewColor.get(s.crew_id ?? "") ?? "#22D8FF",
                    }}
                  >
                    {s.claim?.address ?? "Scheduled"}
                  </div>
                ))}
                {items.length > 3 && (
                  <div className="text-[10px] text-[var(--gray-dim)]">
                    +{items.length - 3} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleChip({
  schedule,
  color,
  onClick,
}: {
  schedule: Schedule;
  color: string;
  onClick: () => void;
}) {
  const statusOpacity = schedule.status === "completed" ? 0.5 : 1;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg px-2 py-1.5 transition-all hover:brightness-110"
      style={{
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        borderLeft: `3px solid ${color}`,
        opacity: statusOpacity,
      }}
    >
      <div className="text-xs font-semibold text-white truncate">
        {schedule.claim?.address ?? "Scheduled claim"}
      </div>
      <div className="text-[10px] text-[var(--gray-muted)] flex items-center gap-1 mt-0.5">
        <span>{fmtTime(schedule.scheduled_at)}</span>
        {schedule.status === "completed" && (
          <span className="text-[var(--green)]">✓</span>
        )}
        {schedule.status === "in_progress" && (
          <span className="text-[var(--amber)]">◐</span>
        )}
        {schedule.notify_homeowner && !schedule.notified_at && (
          <span className="text-[var(--amber)]" title="Homeowner not yet notified">
            ✉
          </span>
        )}
        {schedule.notified_at && (
          <span className="text-[var(--green)]" title="Homeowner notified">
            ✉✓
          </span>
        )}
      </div>
    </button>
  );
}
