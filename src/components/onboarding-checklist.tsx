"use client";

/**
 * Onboarding Checklist Widget — top of /dashboard.
 *
 * Five steps in Tom's exact priority order from Apr 26 plan:
 *   1. Add company info (appears on claim documents)
 *   2. Invite teammates / employees (push early — shared plan, free to add)
 *   3. Generate first claim
 *   4. Connect email (with Google OAuth beta warning)
 *   5. Connect a CRM (saved for last — non-technical confusion risk)
 *
 * Auto-hides when:
 *   - All 5 steps complete, OR
 *   - User clicks × (sets company_profiles.onboarding_dismissed_at via API).
 *
 * Anchor: ~/.claude/plans/glimmering-scribbling-steele.md (Phase B)
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface OnboardingState {
  hasCompanyInfo: boolean;
  hasInvitedTeam: boolean;
  hasFirstClaim: boolean;
  hasConnectedEmail: boolean;
  hasConnectedCRM: boolean;
  dismissed: boolean;
}

const STEPS = [
  {
    n: 1,
    title: "Add your company info",
    sub: "This info appears on every claim document — homeowners, adjusters, and carriers see it.",
    cta: "Open settings →",
    href: "/dashboard/settings#company",
    optional: false,
  },
  {
    n: 2,
    title: "Invite your team",
    sub: "Each teammate processes claims under your shared plan. Free to add.",
    cta: "Invite teammates →",
    href: "/dashboard/team",
    optional: false,
  },
  {
    n: 3,
    title: "Generate your first claim",
    sub: "Upload roof photos. Get a forensic report in 5 minutes.",
    cta: "Start a claim →",
    href: "/dashboard/new-claim",
    optional: false,
  },
  {
    n: 4,
    title: "Connect your Gmail",
    sub: "Claim emails will send from your address instead of noreply@dumbroof.ai. Adjusters and homeowners reply directly to you.",
    warning:
      "Heads up: Google will show a warning that says \"this app isn't verified.\" That's expected during our beta. Click Advanced → Go to dumbroof.ai (unsafe) to continue. We only request permission to send emails on your behalf.",
    cta: "Connect Gmail →",
    href: "/dashboard/settings#email-integration",
    optional: false,
  },
  {
    n: 5,
    title: "Connect a CRM",
    sub: "AccuLynx + CompanyCam pull jobs and photos automatically. You can skip this — most users add it later.",
    cta: "Open integrations →",
    href: "/dashboard/settings#integrations",
    optional: true,
  },
] as const;

export function OnboardingChecklist() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [hidden, setHidden] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      // One read of company_profiles covers steps 1, 4, 5, dismissed flag.
      // Falls back to all-false if no row exists yet.
      // - company_name (NOT "name" — column doesn't exist) is the brand shown
      //   on claim documents.
      // - gmail_refresh_token is populated by the existing /api/gmail-auth/callback
      //   backend flow when the user completes Google OAuth — Step 4's signal.
      const { data: profile } = await supabase
        .from("company_profiles")
        .select(
          "company_name, phone, company_id, companycam_api_key, acculynx_api_key, gmail_refresh_token, onboarding_dismissed_at"
        )
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      // No company_profiles row yet — completely fresh signup
      if (!profile) {
        if (!cancelled)
          setState({
            hasCompanyInfo: false,
            hasInvitedTeam: false,
            hasFirstClaim: false,
            hasConnectedEmail: false,
            hasConnectedCRM: false,
            dismissed: false,
          });
        return;
      }

      const hasCompanyInfo = !!(profile.company_name && profile.phone);
      const hasConnectedEmail = !!profile.gmail_refresh_token;
      const hasConnectedCRM = !!(
        profile.companycam_api_key || profile.acculynx_api_key
      );
      const dismissed = !!profile.onboarding_dismissed_at;

      // Step 2 — team grew OR an invite was sent
      let hasInvitedTeam = false;
      if (profile.company_id) {
        const { count: teamCount } = await supabase
          .from("company_profiles")
          .select("user_id", { count: "exact", head: true })
          .eq("company_id", profile.company_id);
        if ((teamCount ?? 0) > 1) {
          hasInvitedTeam = true;
        } else {
          const { count: inviteCount } = await supabase
            .from("company_invites")
            .select("id", { count: "exact", head: true })
            .eq("company_id", profile.company_id);
          hasInvitedTeam = (inviteCount ?? 0) > 0;
        }
      }

      // Step 3 — any claim under this user
      const { count: claimsCount } = await supabase
        .from("claims")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      const hasFirstClaim = (claimsCount ?? 0) > 0;

      if (cancelled) return;
      setState({
        hasCompanyInfo,
        hasInvitedTeam,
        hasFirstClaim,
        hasConnectedEmail,
        hasConnectedCRM,
        dismissed,
      });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const dismiss = useCallback(async () => {
    setHidden(true); // optimistic
    try {
      await fetch("/api/onboarding/dismiss", { method: "POST" });
    } catch {
      // server-side persistence failed — swallow; widget stays hidden for this
      // session, will reappear next reload. Acceptable degraded behavior.
    }
  }, []);

  if (!state || state.dismissed || hidden) return null;

  const checks = [
    state.hasCompanyInfo,
    state.hasInvitedTeam,
    state.hasFirstClaim,
    state.hasConnectedEmail,
    state.hasConnectedCRM,
  ];
  const completedCount = checks.filter(Boolean).length;
  if (completedCount === STEPS.length) return null;

  return (
    <div className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-glass)] overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-indigo-500/10 to-transparent">
        <div>
          <div className="text-sm font-semibold text-white">Get set up</div>
          <div className="text-xs text-white/50 mt-0.5">
            {completedCount} of {STEPS.length} complete
          </div>
        </div>
        <button
          onClick={dismiss}
          className="text-white/30 hover:text-white/70 text-sm transition-colors px-2 py-1"
          aria-label="Dismiss onboarding checklist"
        >
          ×
        </button>
      </div>

      {/* Progress bar — 5 segments */}
      <div className="flex gap-1 px-5 pt-3" aria-hidden="true">
        {checks.map((done, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              done ? "bg-emerald-500" : "bg-white/10"
            }`}
          />
        ))}
      </div>

      <ul className="p-3 space-y-1">
        {STEPS.map((step, i) => {
          const done = checks[i];
          return (
            <li key={step.n}>
              <a
                href={step.href}
                className={`group flex items-start gap-3 p-3 rounded-lg transition-colors ${
                  done ? "opacity-60" : "hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
                    done
                      ? "bg-emerald-500 text-emerald-950"
                      : "bg-white/5 border border-white/15 text-white/60"
                  }`}
                  aria-hidden="true"
                >
                  {done ? "✓" : step.n}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        done ? "text-white/50 line-through" : "text-white"
                      }`}
                    >
                      {step.title}
                    </span>
                    {step.optional && !done && (
                      <span className="text-[10px] uppercase tracking-wider text-white/30">Optional</span>
                    )}
                  </div>
                  {!done && (
                    <>
                      <div className="text-xs text-white/50 mt-0.5">{step.sub}</div>
                      {"warning" in step && step.warning && (
                        <div className="mt-2 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
                          ⚠ {step.warning}
                        </div>
                      )}
                      <div className="text-xs text-indigo-300 mt-1.5 group-hover:text-indigo-200">
                        {step.cta}
                      </div>
                    </>
                  )}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
