"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ExpenseUploadModal } from "@/components/expense-upload-modal";

/**
 * Phase 3 — bounded expense capture button for claim detail.
 * Floating "+ Receipt" pill. Team-membership gated (mirrors
 * ClaimMoneyActions / ClaimProductionActions pattern).
 */
export function ClaimExpenseActions({ claimId }: { claimId: string }) {
  const [canSubmit, setCanSubmit] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

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
          .select("company_id")
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

  if (!canSubmit) return null;

  return (
    <>
      <div className="fixed bottom-64 right-4 sm:bottom-44 sm:right-6 z-30">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="group flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.12] border border-[var(--amber)]/40 text-[var(--amber)] px-4 py-2.5 rounded-full text-sm font-bold shadow-lg backdrop-blur-md transition-all"
          aria-label="Add expense"
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
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span className="hidden group-hover:inline whitespace-nowrap pr-1">
            + Receipt
          </span>
        </button>
      </div>

      <ExpenseUploadModal
        claimId={claimId}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
