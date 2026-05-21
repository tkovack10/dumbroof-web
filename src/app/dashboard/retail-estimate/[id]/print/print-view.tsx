"use client";

import { useEffect } from "react";
import type {
  RetailTemplate,
  RetailTemplateItem,
  RetailTemplateAddon,
} from "@/lib/retail/templates-types";
import { evaluateFormula } from "@/lib/retail/evaluator";

interface EstimateRow {
  id: string;
  template_id: string;
  template_snapshot: RetailTemplate | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_address: string | null;
  measurements: Record<string, number>;
  addon_qtys: Record<string, number>;
  markup_pct: number;
  base_amount: number;
  addons_amount: number;
  subtotal_amount: number;
  markup_amount: number;
  total_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
  sent_at: string | null;
}

interface CompanyProfile {
  company_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city_state_zip?: string;
  website?: string;
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function PrintView({
  estimate,
  profile,
  logoUrl,
}: {
  estimate: EstimateRow;
  profile: CompanyProfile;
  logoUrl: string | null;
}) {
  // Auto-trigger the browser print dialog when the page loads
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);

  const snap = estimate.template_snapshot;
  const items: RetailTemplateItem[] = snap?.items || [];
  const addons: RetailTemplateAddon[] = snap?.add_ons || [];
  const meta = snap?._meta;

  const bundled = items.filter((i) => i.bundled_in_base);
  const selectedAddons = Object.entries(estimate.addon_qtys || {})
    .map(([code, qty]) => {
      const a = addons.find((aa) => aa.code === code);
      if (!a || qty <= 0) return null;
      return { ...a, qty, subtotal: qty * a.unit_price };
    })
    .filter((x): x is RetailTemplateAddon & { qty: number; subtotal: number } => x !== null);

  return (
    <>
      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
        body { background: white; }
      `}</style>

      <div style={{ background: "white", color: "#1a1a2e", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 40px" }}>
          {/* Print controls (hidden on print) */}
          <div className="no-print" style={{ display: "flex", gap: 12, marginBottom: 24, justifyContent: "flex-end" }}>
            <button
              onClick={() => window.print()}
              style={{ padding: "10px 20px", background: "#0d2137", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
            >
              Print / Save as PDF
            </button>
            <a
              href="/dashboard/retail-estimate"
              style={{ padding: "10px 20px", background: "#f3f4f6", color: "#1a1a2e", textDecoration: "none", borderRadius: 8, fontWeight: 600 }}
            >
              Back to Estimator
            </a>
          </div>

          {/* Header — contractor brand */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: "2px solid #0d2137" }}>
            <div>
              {logoUrl ? (
                <img src={logoUrl} alt={profile.company_name || "Logo"} style={{ maxHeight: 60, maxWidth: 200, marginBottom: 8 }} />
              ) : (
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{profile.company_name || "Roofing Contractor"}</h1>
              )}
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#4b5563" }}>
                {profile.address && <>{profile.address}<br /></>}
                {profile.city_state_zip && <>{profile.city_state_zip}<br /></>}
                {profile.phone && <>{profile.phone}{profile.email ? " · " : ""}{profile.email}</>}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#0d2137" }}>ESTIMATE</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                #{estimate.id.slice(0, 8).toUpperCase()}<br />
                {new Date(estimate.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>
          </div>

          {/* Customer */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Prepared For</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{estimate.customer_name || "—"}</p>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "#4b5563" }}>{estimate.customer_address || ""}</p>
              {estimate.customer_email && <p style={{ margin: "2px 0 0", fontSize: 13, color: "#4b5563" }}>{estimate.customer_email}</p>}
            </div>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Roofing System</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{meta?.manufacturer} {meta?.product_line}</p>
              {meta?.system_warranty?.name && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#4b5563" }}>{meta.system_warranty.name}</p>}
              {meta?.system_warranty?.term && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#4b5563" }}>Term: {meta.system_warranty.term}</p>}
            </div>
          </div>

          {/* Total — big and bold */}
          <div style={{ background: "#0d2137", color: "white", borderRadius: 12, padding: 24, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total — All-Inclusive</p>
              <p style={{ margin: "4px 0 0", fontSize: 14, color: "#cbd5e1" }}>{(estimate.measurements as { roof_area_sq?: number })?.roof_area_sq || 0} SQ roof · waste included · complete system</p>
            </div>
            <p style={{ margin: 0, fontSize: 36, fontWeight: 700, fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}>{fmtUsd(Number(estimate.total_amount))}</p>
          </div>

          {/* Pricing breakdown */}
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Pricing Breakdown</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 24 }}>
            <tbody>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "10px 0", color: "#4b5563" }}>Complete {meta?.product_line} system × {(estimate.measurements as { roof_area_sq?: number })?.roof_area_sq || 0} SQ @ {fmtUsd(meta?.base_price_per_sq_usd || 0)}/SQ</td>
                <td style={{ padding: "10px 0", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{fmtUsd(Number(estimate.base_amount))}</td>
              </tr>
              {selectedAddons.map((a) => (
                <tr key={a.code} style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "10px 0", color: "#4b5563" }}>{a.description} ({a.qty} {a.unit})</td>
                  <td style={{ padding: "10px 0", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{fmtUsd(a.subtotal)}</td>
                </tr>
              ))}
              {Number(estimate.markup_pct) !== 0 && (
                <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "10px 0", color: "#4b5563" }}>{Number(estimate.markup_pct) >= 0 ? "Adjustment" : "Discount"} ({Number(estimate.markup_pct).toFixed(1)}%)</td>
                  <td style={{ padding: "10px 0", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{fmtUsd(Number(estimate.markup_amount))}</td>
                </tr>
              )}
              <tr>
                <td style={{ padding: "14px 0 0", fontWeight: 700, fontSize: 14 }}>Total</td>
                <td style={{ padding: "14px 0 0", textAlign: "right", fontWeight: 700, fontSize: 18, fontFamily: "ui-monospace, monospace", color: "#0d2137" }}>{fmtUsd(Number(estimate.total_amount))}</td>
              </tr>
            </tbody>
          </table>

          {/* Bundled items */}
          {bundled.length > 0 && (
            <>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Everything Included in This Price</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 24 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Item</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Quantity</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {bundled.map((i) => {
                    const qty = evaluateFormula(i.quantity_formula, estimate.measurements as Record<string, number>);
                    return (
                      <tr key={i.code} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 10px" }}>{i.description}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{qty.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td style={{ padding: "8px 10px", color: "#6b7280" }}>{i.unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {/* Warranty disclosure */}
          {snap?.warranty_disclosure && (
            <>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Warranty</h3>
              <p style={{ margin: "0 0 24px", fontSize: 12, color: "#4b5563", lineHeight: 1.55 }}>{snap.warranty_disclosure}</p>
            </>
          )}

          {/* Notes */}
          {estimate.notes && (
            <>
              <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>Notes</h3>
              <p style={{ margin: "0 0 24px", fontSize: 12, color: "#4b5563", whiteSpace: "pre-wrap" }}>{estimate.notes}</p>
            </>
          )}

          {/* Footer */}
          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, fontSize: 11, color: "#6b7280", textAlign: "center" }}>
            <p style={{ margin: 0 }}>
              Price valid for 30 days from {new Date(estimate.created_at).toLocaleDateString()}. Subject to deck inspection on tear-off; decking replacement billed separately at the rate shown in add-ons.
            </p>
            <p style={{ margin: "8px 0 0" }}>
              Estimate generated by {profile.company_name || "DumbRoof"} · powered by dumbroof.ai
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
