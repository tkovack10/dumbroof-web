"use client";

import { useState } from "react";

interface EstimateForSign {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_address: string | null;
  template_id: string;
  template_snapshot: {
    _meta?: {
      template_name?: string;
      manufacturer?: string;
      product_line?: string;
    };
    add_ons?: Array<{ code: string; description: string; unit_price: number }>;
    warranty_disclosure?: string;
  } | null;
  base_amount: number;
  addons_amount: number;
  subtotal_amount: number;
  markup_pct: number | null;
  markup_amount: number | null;
  total_amount: number;
  signed_at: string | null;
  signed_by_name: string | null;
  addon_qtys: Record<string, number> | null;
}

function fmtUsd(n: number | null | undefined): string {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function SignForm({
  token,
  estimate,
  companyName,
  companyPhone,
}: {
  token: string;
  estimate: EstimateForSign;
  companyName: string;
  companyPhone: string | null;
}) {
  const [name, setName] = useState(estimate.customer_name || "");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedAt, setSignedAt] = useState<string | null>(estimate.signed_at);
  const [signedName, setSignedName] = useState<string | null>(estimate.signed_by_name);

  const snap = estimate.template_snapshot;
  const productName = snap?._meta?.template_name || "Roof Replacement";
  const productLine = snap?._meta?.product_line || "";
  const warranty = snap?.warranty_disclosure || "";
  const markup = Number(estimate.markup_pct || 0);
  const markupAmount = Number(estimate.markup_amount || 0);
  const subtotal = Number(estimate.subtotal_amount || estimate.base_amount + estimate.addons_amount);

  const addonRows: Array<{ description: string; qty: number; lineTotal: number }> = [];
  if (snap?.add_ons) {
    for (const a of snap.add_ons) {
      const qty = Number(estimate.addon_qtys?.[a.code] || 0);
      if (qty <= 0) continue;
      addonRows.push({
        description: a.description,
        qty,
        lineTotal: a.unit_price * qty,
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agreed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sign/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Signing failed");
        return;
      }
      setSignedAt(data.signed_at);
      setSignedName(name.trim());
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Signed view (initial-load already-signed OR post-submit success)
  if (signedAt) {
    return (
      <div style={{ background: "#f6f6f4", minHeight: "100vh", padding: 20 }}>
        <div
          style={{
            maxWidth: 600,
            margin: "40px auto",
            background: "#fff",
            borderRadius: 16,
            border: "1px solid #eaeaea",
            padding: 32,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif",
            color: "#111",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#dcfce7",
              color: "#15803d",
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            ✓ Signed
          </div>
          <h1 style={{ margin: "0 0 8px 0", fontSize: 22, fontWeight: 700 }}>
            Thank you, {signedName}
          </h1>
          <p style={{ margin: "0 0 24px 0", color: "#555", fontSize: 14 }}>
            Your signature was recorded on {new Date(signedAt).toLocaleString()}.
            {companyName ? ` ${companyName}` : " Your roofer"} will be in touch shortly to
            schedule.
          </p>
          <div
            style={{
              borderTop: "1px solid #eaeaea",
              paddingTop: 16,
              fontSize: 13,
              color: "#666",
            }}
          >
            <p style={{ margin: "0 0 4px 0" }}>
              <strong>{productName}</strong>
              {productLine ? ` · ${productLine}` : ""}
            </p>
            <p style={{ margin: 0 }}>
              Total: <strong>{fmtUsd(estimate.total_amount)}</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#f6f6f4", minHeight: "100vh", padding: 20 }}>
      <div
        style={{
          maxWidth: 640,
          margin: "20px auto",
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #eaeaea",
          overflow: "hidden",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif",
          color: "#111",
        }}
      >
        <div style={{ padding: "24px 28px", borderBottom: "1px solid #eaeaea" }}>
          <p
            style={{
              margin: "0 0 4px 0",
              fontSize: 11,
              color: "#777",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Estimate from
          </p>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{companyName}</h1>
          {companyPhone && (
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "#555" }}>{companyPhone}</p>
          )}
          {estimate.customer_name && (
            <p style={{ margin: "12px 0 0 0", fontSize: 14 }}>
              <strong>Prepared for:</strong> {estimate.customer_name}
            </p>
          )}
          {estimate.customer_address && (
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "#555" }}>
              {estimate.customer_address}
            </p>
          )}
        </div>

        <div style={{ padding: "20px 28px" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{productName}</h2>
          {productLine && (
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "#555" }}>{productLine}</p>
          )}

          <table
            style={{
              width: "100%",
              marginTop: 16,
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <tbody>
              <tr>
                <td style={{ padding: 8, borderBottom: "1px solid #eaeaea" }}>
                  {productName} — all-in
                </td>
                <td
                  style={{
                    padding: 8,
                    borderBottom: "1px solid #eaeaea",
                    textAlign: "right",
                    fontWeight: 600,
                  }}
                >
                  {fmtUsd(estimate.base_amount)}
                </td>
              </tr>
              {addonRows.map((a, i) => (
                <tr key={i}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eaeaea" }}>
                    {a.description} <span style={{ color: "#888" }}>× {a.qty}</span>
                  </td>
                  <td
                    style={{
                      padding: 8,
                      borderBottom: "1px solid #eaeaea",
                      textAlign: "right",
                      fontWeight: 600,
                    }}
                  >
                    {fmtUsd(a.lineTotal)}
                  </td>
                </tr>
              ))}
              {markup !== 0 && (
                <>
                  <tr>
                    <td style={{ padding: 8, color: "#666" }}>Subtotal</td>
                    <td style={{ padding: 8, textAlign: "right", color: "#666" }}>
                      {fmtUsd(subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: 8, color: markup > 0 ? "#b45309" : "#b91c1c" }}>
                      {markup > 0 ? "Markup" : "Discount"} ({markup > 0 ? "+" : ""}
                      {markup}%)
                    </td>
                    <td
                      style={{
                        padding: 8,
                        textAlign: "right",
                        color: markup > 0 ? "#b45309" : "#b91c1c",
                      }}
                    >
                      {markup > 0 ? "+" : ""}
                      {fmtUsd(markupAmount)}
                    </td>
                  </tr>
                </>
              )}
              <tr style={{ background: "#fafaf7" }}>
                <td style={{ padding: 12, fontSize: 15, fontWeight: 700 }}>Total</td>
                <td
                  style={{
                    padding: 12,
                    textAlign: "right",
                    fontSize: 18,
                    fontWeight: 800,
                  }}
                >
                  {fmtUsd(estimate.total_amount)}
                </td>
              </tr>
            </tbody>
          </table>

          {warranty && (
            <div style={{ marginTop: 16 }}>
              <p
                style={{
                  margin: "0 0 6px 0",
                  fontSize: 11,
                  color: "#777",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Warranty
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "#555", lineHeight: 1.5 }}>
                {warranty}
              </p>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            padding: "24px 28px",
            background: "#fafaf7",
            borderTop: "1px solid #eaeaea",
          }}
        >
          <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 700 }}>
            Sign to accept this estimate
          </h3>
          <label
            style={{
              display: "block",
              fontSize: 11,
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            Type your full legal name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Homeowner"
            required
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 16,
              borderRadius: 8,
              border: "1px solid #ccc",
              fontFamily: "'Caveat', 'Brush Script MT', cursive",
              background: "#fff",
            }}
          />

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              marginTop: 16,
              fontSize: 13,
              color: "#333",
              lineHeight: 1.5,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              required
              style={{ marginTop: 2 }}
            />
            <span>
              I agree to the scope and total above, and I authorize {companyName} to
              perform the work as described. I understand this signature is legally
              binding under E-Sign Act and UETA.
            </span>
          </label>

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: "#fee2e2",
                border: "1px solid #fca5a5",
                borderRadius: 8,
                color: "#991b1b",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!name.trim() || !agreed || submitting}
            style={{
              marginTop: 16,
              width: "100%",
              padding: "12px 16px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 10,
              border: "none",
              background: !name.trim() || !agreed || submitting ? "#ccc" : "#0ea5e9",
              color: "#fff",
              cursor: !name.trim() || !agreed || submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Signing…" : "I Accept and Sign"}
          </button>

          <p style={{ margin: "12px 0 0 0", fontSize: 11, color: "#888" }}>
            Your IP, browser, and timestamp are recorded for the signed record.
          </p>
        </form>
      </div>
    </div>
  );
}
