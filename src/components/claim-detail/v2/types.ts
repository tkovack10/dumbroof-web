import type { ReactNode } from "react";
import type { Claim } from "@/types/claim";
import type { CodeCitation } from "@/types/scope-comparison";

/**
 * Cross-tab linked-selection state. When a user clicks a row in the
 * SupplementComposer (Scope tab), the Inspector reveals an "Active selection"
 * card with the item details + code citation. This is the v2-only Apple-Pages-
 * style "selection-binds-the-inspector" pattern Tom asked for.
 */
export interface ActiveSupplementItem {
  id: string;
  label: string;
  detail: string;
  amount: number;
  type: "missing" | "under" | "code" | "photo";
  codeCitation?: CodeCitation | null;
}

/**
 * Render slots — the v1 page.tsx already constructs every block inline with
 * tightly coupled local state (correspondence, drafts, edit requests, etc.).
 * Rather than re-plumb 30+ pieces of state into a fresh component tree, the
 * orchestrator passes pre-rendered JSX nodes here. Each slot is `null` when
 * the underlying block has no data to show.
 */
export interface V2Slots {
  // Tab content blocks (existing components or page.tsx-inline JSX)
  generatedDocs: ReactNode;        // Generated PDFs + SendDocumentsBlock
  sourceDocs: ReactNode;           // UploadedDocuments component
  scopeComparison: ReactNode;      // ScopeComparison component
  estimateView: ReactNode;         // EstimateView component (read-only browse/tabs/photos)
  estimateEditor: ReactNode;       // Embedded ScopeReviewContent (line-item edit/add/remove)
  estimateConfig: ReactNode;       // EstimateConfigPanel inline
  supplementComposer: ReactNode;   // SupplementComposer component
  roofPhotoMap: ReactNode;         // RoofPhotoMap component (per-slope diagram)
  photoEditor: ReactNode;          // Embedded PhotoReviewContent (per-photo approve/reject/edit/tag)
  communicationLog: ReactNode;     // CommunicationLog component
  communicationsCenter: ReactNode; // Edit requests + carrier correspondence + draft responses (consolidated)
  signatureManager: ReactNode;     // SignatureManager (AOB / Contingency)
  homeownerEngagement: ReactNode;  // HomeownerEngagementCard
  readyToBuild: ReactNode;         // ReadyToBuildCard
  installSupplements: ReactNode;   // InstallSupplementBuilder
  certificateOfCompletion: ReactNode; // CocBuilder
  invoicing: ReactNode;            // InvoiceBuilder
  uploadDocsBlock: ReactNode;      // Add Documents inline block (full upload UI)
  // Always-visible chrome
  conditionalBanners: ReactNode;   // PendingChanges / NeedsImprovement / QAReview / FlashSale, in order
  pathBar: ReactNode;              // ClaimLifecycleBar
  // Inspector content (right rail / mobile bottom-sheet)
  contactCard: ReactNode;          // ContactRegistryCard
  editFieldsCard: ReactNode;       // EditReportFieldsCard
  timelineRail: ReactNode;         // ClaimTimelineRail
  // Locked-state placeholders (when feature isn't unlocked yet)
  lockedScopeComparison: ReactNode | null;
  lockedEstimate: ReactNode | null;
  lockedInstall: ReactNode | null;
  lockedCoc: ReactNode | null;
  lockedInvoice: ReactNode | null;
}

export interface V2Props {
  claim: Claim;
  slots: V2Slots;
  // Action handlers (mirrored from Phase 1 ClaimActionBar so highlights-panel can hoist them)
  isReprocessing: boolean;
  onUpload: () => void;
  onReprocess: () => void;
  // Win celebration state — v2 highlights surface this differently from v1's WinBanner
  win?: { orig: number; updated: number; move: number; pct: number } | null;
  // Cross-tab selection — when set, the Inspector shows an "Active selection" panel
  activeSupplementItem?: ActiveSupplementItem | null;
}

export type V2TabKey = "overview" | "documents" | "scope" | "photos" | "comms" | "closeout";

export const V2_TAB_LABELS: Record<V2TabKey, string> = {
  overview: "Overview",
  documents: "Documents",
  scope: "Scope",
  photos: "Photos",
  comms: "Comms",
  closeout: "Closeout",
};

export const V2_TAB_ICONS: Record<V2TabKey, string> = {
  overview: "⚡",
  documents: "📄",
  scope: "⚖️",
  photos: "📸",
  comms: "💬",
  closeout: "🎯",
};

// Mobile collapses Documents into Overview (5 nav slots).
export const V2_MOBILE_TABS: V2TabKey[] = ["overview", "scope", "photos", "comms", "closeout"];
export const V2_DESKTOP_TABS: V2TabKey[] = ["overview", "documents", "scope", "photos", "comms", "closeout"];
