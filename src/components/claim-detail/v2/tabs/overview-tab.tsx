"use client";

import type { ReactNode } from "react";
import type { Claim } from "@/types/claim";
import type { V2Slots, V2TabKey } from "../types";

interface Props {
  claim: Claim;
  slots: V2Slots;
  goToTab: (k: V2TabKey) => void;
}

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Overview = "what's next" + the headline summary cards. Anything that needs
 * deeper interaction lives in the dedicated tab — Overview just orients you
 * and routes you. Apple HIG: progressive disclosure.
 */
export function OverviewTab({ claim, slots, goToTab }: Props) {
  const hasPDFs = (claim.output_files?.length ?? 0) > 0;
  const hasScope = Array.isArray(claim.scope_comparison) && claim.scope_comparison.length > 0;
  const variance = (claim.contractor_rcv ?? 0) - (claim.current_carrier_rcv ?? claim.original_carrier_rcv ?? 0);

  // Compute the "What's next" CTA based on phase state.
  const nextStep = (() => {
    if (claim.claim_outcome === "won") {
      return {
        title: "Document install supplements & invoice",
        body: "Carrier paid the supplement. Build install-time discoveries, generate the CoC, and send the invoice.",
        cta: "Open Closeout →",
        tab: "closeout" as const,
      };
    }
    if (hasScope && variance > 0) {
      return {
        title: `Send your supplement to ${claim.carrier || "the carrier"}`,
        body: `Carrier scope received. We've identified ${fmtMoney(variance)} in missing scope. Composer ready in Scope tab.`,
        cta: "Open Scope →",
        tab: "scope" as const,
      };
    }
    if (hasPDFs && !hasScope) {
      return {
        title: "Send your reports",
        body: "Forensic + estimate are ready. Send to the homeowner and the carrier to start the supplement loop.",
        cta: "Open Documents →",
        tab: "documents" as const,
      };
    }
    if (!hasPDFs && claim.status === "needs_improvement") {
      return {
        title: "Improve documentation, then reprocess",
        body: claim.improvement_guidance?.summary || "We need stronger evidence before generating reports. Upload more photos and reprocess.",
        cta: "Open Photos →",
        tab: "photos" as const,
      };
    }
    if (!hasPDFs) {
      return {
        title: "Generate your reports",
        body: "Once measurements + photos are in, generate the 5-document package.",
        cta: "Generate now",
        tab: null,
      };
    }
    return null;
  })();

  return (
    <div className="space-y-4">
      {nextStep && (
        <div className="bg-gradient-to-br from-[var(--pink)]/10 to-[var(--blue)]/10 border border-[var(--pink)]/30 rounded-xl p-5 sm:p-6">
          <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--cyan)] mb-1">⚡ What&apos;s next</div>
          <h2 className="text-lg sm:text-xl font-bold text-white">{nextStep.title}</h2>
          <p className="text-sm text-[var(--gray)] mt-1">{nextStep.body}</p>
          {nextStep.tab && (
            <button
              onClick={() => goToTab(nextStep.tab!)}
              className="mt-3 inline-flex items-center gap-2 bg-white/[0.06] border border-white/[0.12] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-white/[0.1] transition-colors"
            >
              {nextStep.cta}
            </button>
          )}
        </div>
      )}

      {/* KPI strip — claim-glance numbers */}
      <KpiStrip claim={claim} />

      {/* Lifecycle path — keep visible on Overview so users see where they are in the workflow */}
      {slots.pathBar && (
        <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4">
          {slots.pathBar}
        </div>
      )}

      {/* Generated documents — hero card on Overview when ready */}
      {slots.generatedDocs && (
        <Card title="Generated documents">{slots.generatedDocs}</Card>
      )}
      {!slots.generatedDocs && slots.lockedEstimate && (
        <Card title="Generated documents">{slots.lockedEstimate}</Card>
      )}

      {/* Source documents — small card; full list on Documents tab */}
      {slots.sourceDocs && (
        <Card title="Source documents">{slots.sourceDocs}</Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-4 sm:p-5">
      <h3 className="text-[11px] uppercase tracking-wider font-bold text-[var(--gray-muted)] mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function KpiStrip({ claim }: { claim: Claim }) {
  const carrierRcv = claim.current_carrier_rcv ?? claim.original_carrier_rcv ?? 0;
  const contractorRcv = claim.contractor_rcv ?? 0;
  const variance = contractorRcv - carrierRcv;
  const variancePct = carrierRcv > 0 ? Math.round((variance / carrierRcv) * 100) : 0;

  if (carrierRcv === 0 && contractorRcv === 0) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat label="Carrier RCV" value={carrierRcv ? `$${Math.round(carrierRcv).toLocaleString()}` : "—"} />
      <Stat label="Contractor RCV" value={contractorRcv ? `$${Math.round(contractorRcv).toLocaleString()}` : "—"} sub={variancePct > 0 ? `+${variancePct}%` : null} />
      {claim.damage_score != null && (
        <Stat label="Damage score" value={`${Math.round(claim.damage_score)} / 100`} sub={claim.damage_grade ? String(claim.damage_grade).toLowerCase() : null} />
      )}
      {claim.created_at && (
        <Stat label="Days in pipeline" value={`${Math.max(0, Math.floor((Date.now() - new Date(claim.created_at).getTime()) / 86400000))}d`} />
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--gray-muted)]">{label}</div>
      <div className="text-lg font-bold text-white mt-1 leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-[var(--cyan)] mt-0.5">{sub}</div>}
    </div>
  );
}
