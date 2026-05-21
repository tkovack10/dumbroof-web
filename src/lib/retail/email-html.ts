/**
 * Inline HTML email body for a customer-facing retail estimate.
 *
 * Style is deliberately conservative — no Tailwind, no JS, inline styles only,
 * dark-mode safe with explicit colors. Goal: render identically in Gmail web,
 * Gmail iOS/Android, Outlook desktop, Apple Mail, and basic webmail clients.
 *
 * NO PDF attachment is generated here. The hosted version of the estimate
 * lives at /q/{id} (added later); the email contains a summary inline + a
 * "Reply to confirm" CTA. The contractor's reply-to is the user, not Dumb Roof.
 */

interface RenderInput {
  customerName: string | null | undefined;
  customerAddress: string | null | undefined;
  companyName: string;
  companyPhone: string | null | undefined;
  companyEmail: string | null | undefined;
  productName: string;
  manufacturer: string;
  manufacturerSeries: string | null | undefined;
  warrantyDisclosure: string | null | undefined;
  totalAmount: number;
  baseAmount: number;
  addonsAmount: number;
  measurementsSummary: Array<{ label: string; value: number; unit: string }>;
  addonLineItems: Array<{ description: string; qty: number; lineTotal: number }>;
}

function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function escape(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderRetailEstimateEmail(input: RenderInput): { html: string; text: string } {
  const productLabel = input.manufacturerSeries
    ? `${input.manufacturer} ${input.manufacturerSeries}`
    : input.manufacturer;

  const measRows = input.measurementsSummary
    .filter((m) => m.value > 0)
    .map(
      (m) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eaeaea;color:#444;font-size:13px;">${escape(m.label)}</td><td style="padding:6px 12px;border-bottom:1px solid #eaeaea;text-align:right;color:#111;font-size:13px;font-weight:600;">${m.value.toLocaleString()} ${escape(m.unit)}</td></tr>`,
    )
    .join("");

  const addonRows = input.addonLineItems
    .map(
      (a) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eaeaea;color:#444;font-size:13px;">${escape(a.description)} <span style="color:#888;">× ${a.qty}</span></td><td style="padding:6px 12px;border-bottom:1px solid #eaeaea;text-align:right;color:#111;font-size:13px;font-weight:600;">${usd(a.lineTotal)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f6f4;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #eaeaea;">
        <tr><td style="padding:24px 28px 8px 28px;">
          <p style="margin:0 0 4px 0;font-size:12px;color:#777;text-transform:uppercase;letter-spacing:1px;">Estimate</p>
          <h1 style="margin:0;font-size:22px;color:#111;font-weight:700;">${escape(input.companyName)}</h1>
          ${
            input.companyPhone || input.companyEmail
              ? `<p style="margin:6px 0 0 0;font-size:13px;color:#555;">${escape(input.companyPhone || "")}${input.companyPhone && input.companyEmail ? " · " : ""}${escape(input.companyEmail || "")}</p>`
              : ""
          }
        </td></tr>

        <tr><td style="padding:8px 28px 16px 28px;border-bottom:1px solid #eaeaea;">
          ${input.customerName ? `<p style="margin:12px 0 0 0;font-size:14px;color:#111;"><strong>Prepared for:</strong> ${escape(input.customerName)}</p>` : ""}
          ${input.customerAddress ? `<p style="margin:4px 0 0 0;font-size:13px;color:#555;">${escape(input.customerAddress)}</p>` : ""}
        </td></tr>

        <tr><td style="padding:20px 28px 8px 28px;">
          <h2 style="margin:0;font-size:16px;color:#111;font-weight:700;">${escape(input.productName)}</h2>
          <p style="margin:4px 0 0 0;font-size:13px;color:#555;">${escape(productLabel)}</p>
        </td></tr>

        ${
          measRows
            ? `<tr><td style="padding:8px 28px 0 28px;">
            <p style="margin:14px 0 6px 0;font-size:11px;color:#777;text-transform:uppercase;letter-spacing:1px;">Measurements</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eaeaea;border-radius:8px;overflow:hidden;">${measRows}</table>
          </td></tr>`
            : ""
        }

        <tr><td style="padding:16px 28px 0 28px;">
          <p style="margin:14px 0 6px 0;font-size:11px;color:#777;text-transform:uppercase;letter-spacing:1px;">Pricing Summary</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eaeaea;border-radius:8px;overflow:hidden;">
            <tr><td style="padding:8px 12px;border-bottom:1px solid #eaeaea;color:#444;font-size:13px;">${escape(input.productName)} — all-in</td><td style="padding:8px 12px;border-bottom:1px solid #eaeaea;text-align:right;color:#111;font-size:13px;font-weight:600;">${usd(input.baseAmount)}</td></tr>
            ${addonRows}
            <tr><td style="padding:12px;background:#fafaf7;color:#111;font-size:15px;font-weight:700;">Total</td><td style="padding:12px;background:#fafaf7;text-align:right;color:#111;font-size:18px;font-weight:800;">${usd(input.totalAmount)}</td></tr>
          </table>
        </td></tr>

        ${
          input.warrantyDisclosure
            ? `<tr><td style="padding:20px 28px 8px 28px;">
            <p style="margin:14px 0 6px 0;font-size:11px;color:#777;text-transform:uppercase;letter-spacing:1px;">Warranty</p>
            <p style="margin:0;font-size:12px;color:#555;line-height:1.55;">${escape(input.warrantyDisclosure)}</p>
          </td></tr>`
            : ""
        }

        <tr><td style="padding:24px 28px;border-top:1px solid #eaeaea;background:#fafaf7;">
          <p style="margin:0;font-size:13px;color:#444;line-height:1.55;">
            Reply to this email to confirm, schedule, or ask questions. We'll be in touch shortly.
          </p>
          <p style="margin:12px 0 0 0;font-size:11px;color:#888;">
            Sent on behalf of <strong style="color:#444;">${escape(input.companyName)}</strong> via Dumb Roof.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Plain-text fallback
  const text = [
    `Estimate from ${input.companyName}`,
    input.companyPhone ? `Phone: ${input.companyPhone}` : "",
    input.companyEmail ? `Email: ${input.companyEmail}` : "",
    "",
    input.customerName ? `Prepared for: ${input.customerName}` : "",
    input.customerAddress || "",
    "",
    `Product: ${input.productName} (${productLabel})`,
    "",
    "Pricing Summary",
    `  ${input.productName} — all-in    ${usd(input.baseAmount)}`,
    ...input.addonLineItems.map((a) => `  ${a.description} x${a.qty}    ${usd(a.lineTotal)}`),
    `  TOTAL    ${usd(input.totalAmount)}`,
    "",
    "Reply to confirm or schedule.",
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text };
}
