"use client";

import { useEffect, useMemo, useState } from "react";
import { HighlightsPanel } from "./highlights-panel";
import { TabBar } from "./tab-bar";
import { Inspector, InspectorMobileSheet } from "./inspector";
import { OverviewTab } from "./tabs/overview-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { ScopeTab } from "./tabs/scope-tab";
import { PhotosTab } from "./tabs/photos-tab";
import { CommsTab } from "./tabs/comms-tab";
import { CloseoutTab } from "./tabs/closeout-tab";
import { RichardTab } from "./tabs/richard-tab";
import { RichardIcon } from "@/components/richard-icon";
import { V2_DESKTOP_TABS, type V2Props, type V2TabKey } from "./types";

/**
 * V2 per-claim layout — Phase 2 of the per-claim page redesign.
 *
 * Architecture:
 *   - Sticky highlights panel (always visible)
 *   - Tab bar (top desktop / bottom mobile)
 *   - All 7 tab contents (incl. the first-class "Ask Richard" tab) mounted via
 *     `display: none`/`block` rather than conditional render — Richard's
 *     auto-chain expects components to stay live across tab switches.
 *   - Right-rail Inspector on lg+ screens; bottom sheet on smaller screens.
 *   - Conditional banners (Win, PendingChanges, NeedsImprovement, QAReview,
 *     FlashSale) come pre-rendered as `slots.conditionalBanners` so they
 *     keep firing identically to v1.
 */
export function V2Layout({ claim, slots, userId, isReprocessing, onUpload, onReprocess, win, activeSupplementItem }: V2Props) {
  const [active, setActive] = useState<V2TabKey>("overview");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // When a new active selection arrives from the SupplementComposer, auto-open
  // the mobile inspector sheet so the user sees the linked context immediately.
  // No-op on lg+ where the inspector is already visible in the right rail.
  useEffect(() => {
    if (activeSupplementItem && window.matchMedia("(max-width: 1023px)").matches) {
      setInspectorOpen(true);
    }
  }, [activeSupplementItem?.id]);

  // Phase-aware primary action mirrors ClaimActionBar logic but surfaces
  // inline in the highlights panel on desktop.
  const primary = useMemo(() => {
    const hasPDFs = (claim.output_files?.length ?? 0) > 0;
    const hasScope = Array.isArray(claim.scope_comparison) && claim.scope_comparison.length > 0;
    if (claim.claim_outcome === "won") {
      return { label: "Open Closeout", onClick: () => setActive("closeout") };
    }
    if (hasScope) {
      return { label: "Supplement Composer", onClick: () => setActive("scope") };
    }
    if (hasPDFs) {
      return { label: "Send to Carrier", onClick: () => setActive("documents") };
    }
    return { label: isReprocessing ? "Generating…" : "Generate Reports", onClick: onReprocess };
  }, [claim.output_files, claim.scope_comparison, claim.claim_outcome, isReprocessing, onReprocess]);

  // Tab badges — surface pending counts so users see them from any tab.
  const badges = useMemo<Partial<Record<V2TabKey, number>>>(() => {
    const out: Partial<Record<V2TabKey, number>> = {};
    const drafts = claim.pending_drafts ?? 0;
    const edits = claim.pending_edits ?? 0;
    if (drafts + edits > 0) out.comms = drafts + edits;
    return out;
  }, [claim.pending_drafts, claim.pending_edits]);

  return (
    <>
      <HighlightsPanel
        claim={claim}
        win={win}
        isReprocessing={isReprocessing}
        onUpload={onUpload}
        onReprocess={onReprocess}
        onPrimaryAction={primary.onClick}
        primaryActionLabel={primary.label}
        onUploadGoToDocuments={() => setActive("documents")}
      />
      <TabBar active={active} onChange={setActive} badges={badges} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-0">
        {/* Main canvas */}
        <main className="flex-1 min-w-0 py-5 pb-32 sm:pb-24 lg:pb-10">
          {/* Reprocessing feedback — backend pipeline takes ~30s; without this
              banner the only visual cue is the Reprocess button text flipping. */}
          {isReprocessing && (
            <div className="mb-4 bg-[var(--cyan)]/10 border border-[var(--cyan)]/30 text-[var(--cyan)] text-sm rounded-xl px-4 py-3 flex items-center gap-3">
              <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>
                <strong className="text-white">Reprocessing your claim</strong> — this takes ~30 seconds. Reports will refresh when done.
              </span>
            </div>
          )}

          {/* Conditional banners (PendingChanges / NeedsImprovement / QAReview / FlashSale)
              render above tab content on every tab so urgent state is never hidden. */}
          {slots.conditionalBanners && (
            <div className="mb-4 space-y-3">{slots.conditionalBanners}</div>
          )}

          {/* All tabs mounted; inactive hidden via CSS. Smooth fade on switch. */}
          <TabPanel show={active === "overview"}>
            <OverviewTab claim={claim} slots={slots} goToTab={setActive} />
          </TabPanel>
          <TabPanel show={active === "documents"}>
            <DocumentsTab slots={slots} isReprocessing={isReprocessing} />
          </TabPanel>
          <TabPanel show={active === "scope"}>
            <ScopeTab
              slots={slots}
              claimId={claim.id}
              manualScopeLocked={Boolean(
                (claim as unknown as { claim_config?: { manual_scope_locked?: boolean } })
                  .claim_config?.manual_scope_locked
              )}
              currentTrades={
                ((claim as unknown as { claim_config?: { scope?: { trades?: string[] } } })
                  .claim_config?.scope?.trades) ?? []
              }
            />
          </TabPanel>
          <TabPanel show={active === "photos"}>
            <PhotosTab slots={slots} />
          </TabPanel>
          <TabPanel show={active === "comms"}>
            <CommsTab slots={slots} />
          </TabPanel>
          <TabPanel show={active === "closeout"}>
            <CloseoutTab claim={claim} slots={slots} />
          </TabPanel>
          <TabPanel show={active === "richard"}>
            <RichardTab claim={claim} userId={userId} />
          </TabPanel>

          {/* Mobile-only inspector trigger */}
          <button
            onClick={() => setInspectorOpen(true)}
            className="lg:hidden fixed top-3 right-3 z-30 w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.12] text-white hover:bg-white/[0.1] transition-colors flex items-center justify-center text-sm font-bold"
            aria-label="Show claim details"
            title="Claim details"
          >
            ⓘ
          </button>

          {/* Floating Richard launcher (mobile) — Tom wants a persistent Richard
              button in addition to the bottom "Ask Richard" tab. Opens the
              already-mounted Richard tab (no second chat instance → Richard
              never double-mounts). Sits above the bottom tab bar (z-40 > z-30). */}
          <button
            onClick={() => {
              setActive("richard");
              if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="sm:hidden fixed bottom-[96px] right-4 z-40 w-14 h-14 rounded-full overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/15 active:scale-95 transition-transform"
            aria-label="Ask Richard"
            title="Ask Richard"
          >
            <RichardIcon size={56} className="w-14 h-14" />
          </button>
        </main>

        {/* Desktop right-rail inspector */}
        <Inspector
          claim={claim}
          contactCard={slots.contactCard}
          editFieldsCard={slots.editFieldsCard}
          timelineRail={slots.timelineRail}
          activeSupplementItem={activeSupplementItem}
          onClearActive={() => {
            // No-op: clearing happens in page.tsx via onActiveItemChange(null).
            // Inspector close button just hides locally on the next render.
          }}
        />
      </div>

      {/* Mobile bottom sheet inspector */}
      <InspectorMobileSheet
        claim={claim}
        contactCard={slots.contactCard}
        editFieldsCard={slots.editFieldsCard}
        timelineRail={slots.timelineRail}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        activeSupplementItem={activeSupplementItem}
      />

      {/* Sentinel for the V2_DESKTOP_TABS import — ensures the bundler keeps
          the constant alive even though we only use V2TabKey here. The IA spec
          treats V2_DESKTOP_TABS as the canonical desktop tab order. */}
      <span className="sr-only" aria-hidden="true">{V2_DESKTOP_TABS.join("")}</span>
    </>
  );
}

/**
 * Tab panel — kept mounted for Richard tool-call safety. Inactive tabs are
 * `display: none` with their content tree live so any side-effects Richard
 * triggers (state updates, re-renders) continue to fire on any tab.
 *
 * 180ms fade matches the tab-bar active-underline transition.
 */
function TabPanel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      aria-hidden={!show}
      className={`transition-opacity duration-200 ${show ? "block opacity-100" : "hidden opacity-0"}`}
    >
      {children}
    </div>
  );
}
