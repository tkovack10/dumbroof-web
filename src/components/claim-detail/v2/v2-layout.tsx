"use client";

import { useMemo, useState } from "react";
import { HighlightsPanel } from "./highlights-panel";
import { TabBar } from "./tab-bar";
import { Inspector, InspectorMobileSheet } from "./inspector";
import { OverviewTab } from "./tabs/overview-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { ScopeTab } from "./tabs/scope-tab";
import { PhotosTab } from "./tabs/photos-tab";
import { CommsTab } from "./tabs/comms-tab";
import { CloseoutTab } from "./tabs/closeout-tab";
import { V2_DESKTOP_TABS, type V2Props, type V2TabKey } from "./types";

/**
 * V2 per-claim layout — Phase 2 of the per-claim page redesign.
 *
 * Architecture:
 *   - Sticky highlights panel (always visible)
 *   - Tab bar (top desktop / bottom mobile)
 *   - All 6 tab contents mounted via `display: none`/`block` rather than
 *     conditional render — Richard's auto-chain expects components to stay
 *     live across tab switches.
 *   - Right-rail Inspector on lg+ screens; bottom sheet on smaller screens.
 *   - Conditional banners (Win, PendingChanges, NeedsImprovement, QAReview,
 *     FlashSale) come pre-rendered as `slots.conditionalBanners` so they
 *     keep firing identically to v1.
 */
export function V2Layout({ claim, slots, isReprocessing, onUpload, onReprocess, win }: V2Props) {
  const [active, setActive] = useState<V2TabKey>("overview");
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Phase-aware primary action mirrors ClaimActionBar logic but surfaces
  // inline in the highlights panel on desktop.
  const primary = useMemo(() => {
    const hasPDFs = (claim.output_files?.length ?? 0) > 0;
    const hasScope = Array.isArray(claim.scope_comparison) && claim.scope_comparison.length > 0;
    if (claim.claim_outcome === "won") {
      return { label: "Open Closeout", onClick: () => setActive("closeout") };
    }
    if (hasScope) {
      return { label: "Open Composer", onClick: () => setActive("scope") };
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
      />
      <TabBar active={active} onChange={setActive} badges={badges} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-0">
        {/* Main canvas */}
        <main className="flex-1 min-w-0 py-5 pb-32 sm:pb-24 lg:pb-10">
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
            <DocumentsTab slots={slots} />
          </TabPanel>
          <TabPanel show={active === "scope"}>
            <ScopeTab slots={slots} />
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

          {/* Mobile-only inspector trigger */}
          <button
            onClick={() => setInspectorOpen(true)}
            className="lg:hidden fixed top-3 right-3 z-30 w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.12] text-white hover:bg-white/[0.1] transition-colors flex items-center justify-center text-sm font-bold"
            aria-label="Show claim details"
            title="Claim details"
          >
            ⓘ
          </button>
        </main>

        {/* Desktop right-rail inspector */}
        <Inspector
          claim={claim}
          contactCard={slots.contactCard}
          editFieldsCard={slots.editFieldsCard}
          timelineRail={slots.timelineRail}
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
