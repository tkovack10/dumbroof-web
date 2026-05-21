/**
 * Pure HTML template for retail-estimate PDFs. No React, no JSX —
 * puppeteer's setContent() takes raw HTML.
 *
 * Mirrors src/app/dashboard/retail-estimate/[id]/print/print-view.tsx
 * visually but is standalone so the PDF renderer doesn't need to spin
 * up Next.js or fetch from a URL.
 */
import { evaluateFormula } from "@/lib/retail/evaluator";
import type {
  RetailTemplate,
  RetailTemplateItem,
  RetailTemplateAddon,
} from "@/lib/retail/templates-types";

interface EstimateForPdf {
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
  created_at: string;
}

interface ProfileForPdf {
  company_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city_state_zip?: string | null;
  website?: string | null;
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildRetailEstimatePdfHtml(
  estimate: EstimateForPdf,
  profile: ProfileForPdf,
  logoDataUri: string | null,
): string {
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

  const companyName = esc(profile.company_name) || "Roofing Contractor";
  const roofSq = (estimate.measurements as { roof_area_sq?: number })?.roof_area_sq || 0;
  const createdDate = new Date(estimate.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const headerLogo = logoDataUri
    ? `<img src="${logoDataUri}" alt="${companyName}" style="max-height: 60px; max-width: 220px; margin-bottom: 8px;" />`
    : `<h1 style="margin:0;font-size:24px;font-weight:700;">${companyName}</h1>`;

  const bundledRows = bundled
    .map((i) => {
      const qty = evaluateFormula(i.quantity_formula, estimate.measurements as Record<string, number>);
      return `<tr style="border-bottom:1px solid #f3f4f6;">
  <td style="padding:8px 10px;">${esc(i.description)}</td>
  <td style="padding:8px 10px;text-align:right;font-family:ui-monospace,monospace;">${qty.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
  <td style="padding:8px 10px;color:#6b7280;">${esc(i.unit)}</td>
</tr>`;
    })
    .join("");

  const addonRows = selectedAddons
    .map(
      (a) => `<tr style="border-bottom:1px solid #e5e7eb;">
  <td style="padding:10px 0;color:#4b5563;">${esc(a.description)} (${a.qty} ${esc(a.unit)})</td>
  <td style="padding:10px 0;text-align:right;font-family:ui-monospace,monospace;">${fmtUsd(a.subtotal)}</td>
</tr>`,
    )
    .join("");

  const markupRow =
    Number(estimate.markup_pct) !== 0
      ? `<tr style="border-bottom:1px solid #e5e7eb;">
  <td style="padding:10px 0;color:#4b5563;">${Number(estimate.markup_pct) >= 0 ? "Adjustment" : "Discount"} (${Number(estimate.markup_pct).toFixed(1)}%)</td>
  <td style="padding:10px 0;text-align:right;font-family:ui-monospace,monospace;">${fmtUsd(Number(estimate.markup_amount))}</td>
</tr>`
      : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: white; }
    .container { padding: 0; max-width: 760px; margin: 0 auto; }
    h1, h2, h3 { color: #1a1a2e; }
    @page { margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid #0d2137;margin-bottom:24px;">
      <div>
        ${headerLogo}
        <p style="margin:4px 0 0;font-size:12px;color:#4b5563;">
          ${esc(profile.address) ? esc(profile.address) + "<br/>" : ""}
          ${esc(profile.city_state_zip) ? esc(profile.city_state_zip) + "<br/>" : ""}
          ${esc(profile.phone) ? esc(profile.phone) : ""}${esc(profile.phone) && esc(profile.email) ? " · " : ""}${esc(profile.email) || ""}
        </p>
      </div>
      <div style="text-align:right;">
        <h2 style="margin:0;font-size:26px;font-weight:700;color:#0d2137;">ESTIMATE</h2>
        <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">#${esc(estimate.id.slice(0, 8).toUpperCase())}<br/>${createdDate}</p>
      </div>
    </div>

    <!-- Customer + Product -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
      <div>
        <p style="margin:0 0 4px;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Prepared For</p>
        <p style="margin:0;font-size:14px;font-weight:600;">${esc(estimate.customer_name) || "—"}</p>
        <p style="margin:2px 0 0;font-size:13px;color:#4b5563;">${esc(estimate.customer_address) || ""}</p>
        ${esc(estimate.customer_email) ? `<p style="margin:2px 0 0;font-size:13px;color:#4b5563;">${esc(estimate.customer_email)}</p>` : ""}
      </div>
      <div>
        <p style="margin:0 0 4px;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Roofing System</p>
        <p style="margin:0;font-size:14px;font-weight:600;">${esc(meta?.manufacturer)} ${esc(meta?.product_line)}</p>
        ${meta?.system_warranty?.name ? `<p style="margin:2px 0 0;font-size:12px;color:#4b5563;">${esc(meta.system_warranty.name)}</p>` : ""}
        ${meta?.system_warranty?.term ? `<p style="margin:2px 0 0;font-size:12px;color:#4b5563;">Term: ${esc(meta.system_warranty.term)}</p>` : ""}
      </div>
    </div>

    <!-- Total -->
    <div style="background:#0d2137;color:white;border-radius:12px;padding:20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">Total — All-Inclusive</p>
        <p style="margin:4px 0 0;font-size:13px;color:#cbd5e1;">${roofSq} SQ roof · waste included · complete system</p>
      </div>
      <p style="margin:0;font-size:32px;font-weight:700;font-family:ui-monospace,SF Mono,Menlo,monospace;">${fmtUsd(Number(estimate.total_amount))}</p>
    </div>

    <!-- Pricing breakdown -->
    <h3 style="margin:0 0 12px;font-size:14px;font-weight:600;">Pricing Breakdown</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
      <tbody>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 0;color:#4b5563;">Complete ${esc(meta?.product_line)} system × ${roofSq} SQ @ ${fmtUsd(meta?.base_price_per_sq_usd || 0)}/SQ</td>
          <td style="padding:10px 0;text-align:right;font-family:ui-monospace,monospace;">${fmtUsd(Number(estimate.base_amount))}</td>
        </tr>
        ${addonRows}
        ${markupRow}
        <tr>
          <td style="padding:14px 0 0;font-weight:700;font-size:14px;">Total</td>
          <td style="padding:14px 0 0;text-align:right;font-weight:700;font-size:18px;font-family:ui-monospace,monospace;color:#0d2137;">${fmtUsd(Number(estimate.total_amount))}</td>
        </tr>
      </tbody>
    </table>

    ${
      bundled.length > 0
        ? `<h3 style="margin:0 0 12px;font-size:14px;font-weight:600;">Everything Included in This Price</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px;">
      <thead>
        <tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb;">
          <th style="padding:8px 10px;text-align:left;font-weight:600;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Item</th>
          <th style="padding:8px 10px;text-align:right;font-weight:600;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Unit</th>
        </tr>
      </thead>
      <tbody>${bundledRows}</tbody>
    </table>`
        : ""
    }

    ${
      snap?.warranty_disclosure
        ? `<h3 style="margin:0 0 12px;font-size:14px;font-weight:600;">Warranty</h3>
    <p style="margin:0 0 24px;font-size:12px;color:#4b5563;line-height:1.55;">${esc(snap.warranty_disclosure)}</p>`
        : ""
    }

    ${
      estimate.notes
        ? `<h3 style="margin:0 0 8px;font-size:14px;font-weight:600;">Notes</h3>
    <p style="margin:0 0 24px;font-size:12px;color:#4b5563;white-space:pre-wrap;">${esc(estimate.notes)}</p>`
        : ""
    }

    <div style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:11px;color:#6b7280;text-align:center;">
      <p style="margin:0;">Price valid for 30 days from ${createdDate}. Subject to deck inspection on tear-off; decking replacement billed separately at the rate shown in add-ons.</p>
      <p style="margin:8px 0 0;">Estimate prepared by ${companyName} · powered by dumbroof.ai</p>
    </div>
  </div>
</body>
</html>`;
}
