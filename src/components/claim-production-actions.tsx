"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ScheduleClaimModal,
} from "@/components/schedule-claim-modal";

interface Crew {
  id: string;
  name: string;
  color: string;
}

interface ExistingSchedule {
  id: string;
  claim_id: string;
  crew_id: string | null;
  scheduled_at: string;
  end_at: string | null;
  status: string;
  notes: string | null;
  notify_homeowner: boolean;
  notified_at: string | null;
}

/**
 * Phase 2 — bounded production actions for the claim detail page.
 * Floating "Schedule install" button. Same team-membership gate as
 * ClaimMoneyActions so homeowner share-link viewers never see it.
 */
export function ClaimProductionActions({ claimId }: { claimId: string }) {
  const [canSubmit, setCanSubmit] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [activeSchedule, setActiveSchedule] = useState<ExistingSchedule | null>(null);

  // Team-membership gate (mirrors ClaimMoneyActions)
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: profile }, { data: claim }] = await Promise.all([
        supabase
          .from("company_profiles")
          .select("company_id, is_admin")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("claims")
          .select("company_id")
          .eq("id", claimId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const ok = !!(
        profile?.is_admin &&
        profile?.company_id &&
        claim?.company_id &&
        profile.company_id === claim.company_id
      );
      setCanSubmit(ok);
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  // Preload crews + active schedule once gated in
  useEffect(() => {
    if (!canSubmit) return;
    let cancelled = false;
    async function load() {
      try {
        const [crewsRes, supabase] = [
          await fetch("/api/admin/crews"),
          createClient(),
        ];
        if (crewsRes.ok) {
          const j = await crewsRes.json();
          if (!cancelled) setCrews(((j.crews as Crew[]) || []).filter((c) => c));
        }
        const { data: schedules } = await supabase
          .from("production_schedules")
          .select("*")
          .eq("claim_id", claimId)
          .in("status", ["scheduled", "in_progress"])
          .order("scheduled_at", { ascending: false })
          .limit(1);
        if (!cancelled) {
          setActiveSchedule((schedules?.[0] as ExistingSchedule | null) ?? null);
        }
      } catch {
        // ignore — non-fatal
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [claimId, canSubmit, modalOpen]);

  if (!canSubmit) return null;

  const hasScheduled = !!activeSchedule;

  return (
    <>
      <div className="fixed bottom-52 right-4 sm:bottom-32 sm:right-6 z-30">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`group flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold shadow-lg transition-all ${
            hasScheduled
              ? "bg-white/[0.08] border border-[var(--green)]/40 text-[var(--green)] hover:bg-[var(--green)]/10"
              : "bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] text-white hover:shadow-[0_0_24px_var(--cyan)]"
          }`}
          aria-label={hasScheduled ? "Reschedule install" : "Schedule install"}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75"
            />
          </svg>
          <span className="hidden group-hover:inline whitespace-nowrap pr-1">
            {hasScheduled
              ? `Installed ${new Date(activeSchedule!.scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : "Schedule install"}
          </span>
        </button>
      </div>

      <ScheduleClaimModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        existing={activeSchedule}
        claimId={claimId}
        crews={crews}
        onSaved={() => {
          // Keep modal open until user closes (lets them follow up)
          // but force a refetch of activeSchedule on next mount.
        }}
      />
    </>
  );
}
