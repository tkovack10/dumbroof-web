"use client";

import { useState } from "react";
import type {
  RetailTemplate,
  RetailTemplateItem,
  RetailTemplateAddon,
} from "@/lib/retail/templates-types";
import { evaluateFormula } from "@/lib/retail/evaluator";

interface EstimateRow {
  id: string;
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
  notes: string | null;
  signed_at: string | null;
  signed_by_name: string | null;
  created_at: string;
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
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function SignClient({
  token,
  estimate,
  profile,
  logoUrl,
}: {
  token: string;
  estimate: EstimateRow;
  profile: CompanyProfile;
  logoUrl: string | null;
}) {
  const [name, setName] = useState(estimate.customer_name || "");
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(!!estimate.signed_at);
  const [signedAt, setSignedAt] = useState(estimate.signed_at || "");
  const [signedByName, setSignedByName] = useState(estimate.signed_by_name || "");
  const [error, setError] = useState<string | null>(null);

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

  async function handleSign() {
    setError(null);
    if (!name.trim() || name.trim().length < 2) {
      setError("Please type your full name to sign.");
      return;
    }
    if (!agreed) {
      setError("Check the box to agree to the terms before signing.");
      return;
    }
    setSigning(true);
    try {
      const res = await fetch(`/api/sign/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), agreed: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to sign");
        return;
      }
      setSigned(true);
      setSignedAt(data.signed_at);
      setSignedByName(data.signed_by_name);
    } catch (err) {
      setError(String(err));
    } finally {
      setSigning(false);
    }
  }

  const companyName = profile.company_name || "Your Roofing Contractor";

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#1a1a2e" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ background: "white", borderRadius: 12, padding: "32px 40px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 20, borderBottom: "2px solid #0d2137", marginBottom: 24 }}>
            <div>
              {logoUrl ? (
                <img src={logoUrl} alt={companyName} style={{ maxHeight: 60, maxWidth: 200, marginBottom: 8 }} />
              ) : (
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{companyName}</h1>
              )}
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4b5563" }}>
                {profile.address ? `${profile.address} · ` : ""}
                {profile.city_state_zip || ""}{profile.phone ? ` · ${profile.phone}` : ""}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#0d2137" }}>ESTIMATE</h2>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#6b7280" }}>#{estimate.id.slice(0, 8).toUpperCase()}</p>
            </div>
          </div>

          {/* Customer + Product */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Prepared For</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{estimate.customer_name || "—"}</p>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "#4b5563" }}>{estimate.customer_address || ""}</p>
            </div>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Roofing System</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{meta?.manufacturer} {meta?.product_line}</p>
              {meta?.system_warranty?.name && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#4b5563" }}>{meta.system_warranty.name}</p>}
            </div>
          </div>

          {/* Total */}
          <div style={{ background: "#0d2137", color: "white", borderRadius: 10, padding: 20, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total — All-Inclusive</p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#cbd5e1" }}>{(estimate.measurements as { roof_area_sq?: number })?.roof_area_sq || 0} SQ roof · waste included · complete system</p>
            </div>
            <p style={{ margin: 0, fontSize: 30, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{fmtUsd(Number(estimate.total_amount))}</p>
          </div>

          {/* Pricing breakdown */}
          <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}>Pricing Breakdown</h3>
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
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}>Everything Included</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 24 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 11 }}>Item</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 11 }}>Qty</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 11 }}>Unit</th>
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
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}>Warranty</h3>
              <p style={{ margin: "0 0 24px", fontSize: 12, color: "#4b5563", lineHeight: 1.55 }}>{snap.warranty_disclosure}</p>
            </>
          )}

          {/* Notes */}
          {estimate.notes && (
            <>
              <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Notes</h3>
              <p style={{ margin: "0 0 24px", fontSize: 12, color: "#4b5563", whiteSpace: "pre-wrap" }}>{estimate.notes}</p>
            </>
          )}

          {/* Signature section */}
          <div style={{ marginTop: 32, paddingTop: 24, borderTop: "2px solid #0d2137" }}>
            {signed ? (
              <div style={{ background: "#d1fae5", border: "1px solid #34d399", borderRadius: 10, padding: 20 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#065f46" }}>✓ Signed</p>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "#065f46" }}>
                  Signed by <strong>{signedByName}</strong> on {new Date(signedAt).toLocaleString()}
                </p>
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "#065f46" }}>
                  {companyName} has been notified. They&apos;ll reach out shortly to schedule the work.
                </p>
              </div>
            ) : (
              <>
                <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Sign to Accept</h3>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#4b5563", marginBottom: 6 }}>Your full legal name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="First Last"
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      fontSize: 16,
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      fontFamily: "Caveat, 'Brush Script MT', cursive",
                      letterSpacing: "0.5px",
                    }}
                  />
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#374151", cursor: "pointer", marginBottom: 16 }}>
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    style={{ marginTop: 3, width: 16, height: 16, cursor: "pointer" }}
                  />
                  <span>
                    I, the named signer, agree to the estimate above as a binding work authorization for{" "}
                    <strong>{fmtUsd(Number(estimate.total_amount))}</strong>. I understand my electronic signature is legally
                    binding under the U.S. ESIGN Act, and that my IP address and timestamp will be recorded as part of this
                    signature.
                  </span>
                </label>
                {error && (
                  <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, marginBottom: 16, color: "#991b1b", fontSize: 13 }}>{error}</div>
                )}
                <button
                  type="button"
                  disabled={signing || !name.trim() || !agreed}
                  onClick={handleSign}
                  style={{
                    width: "100%",
                    padding: "14px 20px",
                    background: signing || !name.trim() || !agreed ? "#9ca3af" : "#0d2137",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: signing || !name.trim() || !agreed ? "not-allowed" : "pointer",
                  }}
                >
                  {signing ? "Signing…" : `Sign Estimate — ${fmtUsd(Number(estimate.total_amount))}`}
                </button>
                <p style={{ margin: "12px 0 0", fontSize: 11, color: "#6b7280", textAlign: "center" }}>
                  Powered by dumbroof.ai · ESIGN Act compliant
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
