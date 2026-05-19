"use client";

import { useState, useEffect } from "react";
import { CheckUploadModal } from "@/components/check-upload-modal";
import { CommissionRequestModal } from "@/components/commission-request-modal";
import { createClient } from "@/lib/supabase/client";
import { PUBLIC_DOMAINS } from "@/lib/public-domains";

/**
 * Phase 1 — bounded add-on to the claim detail page.
 * Renders two action buttons (Upload check, Submit commission) and owns
 * their modal state. Drops in via a single line at the page level so
 * the existing 1988-line claim page stays untouched.
 *
 * Gating: only renders if the caller is a team member of the claim's
 * company (claim.company_id matches the user's company_profiles row).
 * Prevents homeowners with share-link claim access from seeing these
 * buttons and getting into a confusing RLS-deny on submit.
 */
export function ClaimMoneyActions({ claimId }: { claimId: string }) {
  const [showCheck, setShowCheck] = useState(false);
  const [showCommission, setShowCommission] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);

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
          .select("company_id, email")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("claims")
          .select("company_id, user_id, assigned_user_id")
          .eq("id", claimId)
          .maybeSingle(),
      ]);
      if (cancelled || !claim) return;
      // Authorized when ANY of these hold:
      //   1. Same company_id (canonical)
      //   2. Caller is the claim owner (user_id)
      //   3. Caller is the assigned rep
      //   4. Same email domain (legacy pre-company_id teams) — covers the
      //      48 USARM claims with null company_id that the strict check missed
      const sameCompany = !!(
        profile?.company_id &&
        claim.company_id &&
        profile.company_id === claim.company_id
      );
      const owns = claim.user_id === user.id;
      const assigned = claim.assigned_user_id === user.id;
      const callerDomain = (user.email || profile?.email || "")
        .split("@")[1]
        ?.toLowerCase();
      const claimOwnerDomain = await (async () => {
        if (!callerDomain) return null;
        const { data: ownerProfile } = await supabase
          .from("company_profiles")
          .select("email")
          .eq("user_id", claim.user_id)
          .maybeSingle();
        return (ownerProfile?.email || "").split("@")[1]?.toLowerCase() ?? null;
      })();
      // Exclude public mailbox domains (gmail.com, etc.) so any
      // gmail user can't see floating actions on another gmail user's claim.
      const sameDomain = !!(
        callerDomain &&
        claimOwnerDomain &&
        callerDomain === claimOwnerDomain &&
        !PUBLIC_DOMAINS.has(callerDomain)
      );
      setCanSubmit(sameCompany || owns || assigned || sameDomain);
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  if (!canSubmit) return null;

  return (
    <>
      <div className="fixed bottom-24 right-4 sm:bottom-6 sm:right-6 z-30 flex flex-col gap-2 items-end">
        <button
          type="button"
          onClick={() => setShowCheck(true)}
          className="group flex items-center gap-2 bg-gradient-to-r from-[var(--green)] to-[var(--cyan)] hover:shadow-[0_0_24px_var(--green)] text-white px-4 py-2.5 rounded-full text-sm font-bold shadow-lg transition-all"
          aria-label="Upload check"
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
              d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 12a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V12zm-12 0h.008v.008H6V12z"
            />
          </svg>
          <span className="hidden group-hover:inline whitespace-nowrap pr-1">Upload check</span>
        </button>

        <button
          type="button"
          onClick={() => setShowCommission(true)}
          className="group flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.12] border border-[var(--border-glass)] text-white px-4 py-2.5 rounded-full text-sm font-bold shadow-lg backdrop-blur-md transition-all"
          aria-label="Submit commission"
        >
          <svg
            className="w-4 h-4 text-[var(--amber)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="hidden group-hover:inline whitespace-nowrap pr-1">My commission</span>
        </button>
      </div>

      <CheckUploadModal
        claimId={claimId}
        open={showCheck}
        onClose={() => setShowCheck(false)}
      />
      <CommissionRequestModal
        claimId={claimId}
        open={showCommission}
        onClose={() => setShowCommission(false)}
      />
    </>
  );
}
