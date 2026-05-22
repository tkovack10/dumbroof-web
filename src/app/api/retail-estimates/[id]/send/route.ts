import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";
import { renderRetailEstimateEmail } from "@/lib/retail/email-html";
import type { RetailTemplate } from "@/lib/retail/templates-types";
import { getCallerCompanyId } from "@/lib/company-scope";

export const dynamic = "force-dynamic";

/**
 * Display labels for the 10 standard measurements collected in the builder.
 * Mirrors MEASUREMENT_LABELS in retail-estimate-client.tsx — keep in sync.
 * Snapshot doesn't store these (template schema doesn't carry measurement
 * metadata) so the labels live here.
 */
const MEASUREMENT_LABELS: Record<string, { label: string; unit: string }> = {
  roof_area_sq: { label: "Roof area", unit: "SQ" },
  eave_lf: { label: "Eave", unit: "LF" },
  rake_lf: { label: "Rake", unit: "LF" },
  ridge_lf: { label: "Ridge", unit: "LF" },
  hip_lf: { label: "Hip", unit: "LF" },
  valley_lf: { label: "Valley", unit: "LF" },
  ridge_lf_vented: { label: "Ridge vented", unit: "LF" },
  pipe_count_standard: { label: "Standard pipes", unit: "EA" },
  step_flash_lf: { label: "Step flashing", unit: "LF" },
  counter_flash_lf: { label: "Counter flashing", unit: "LF" },
};

/**
 * POST /api/retail-estimates/[id]/send — email the estimate to the customer.
 *
 * Phase 3: HTML inline only. No PDF (Phase 8 ships that separately, via an
 * external HTML-to-PDF service — never puppeteer in this codebase, see
 * feedback_no_puppeteer_in_mvp). Reply-to is the contractor's email so the
 * customer's response goes to them, not to us.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json({ error: "No company profile" }, { status: 403 });
  }

  const { data: est, error: estErr } = await supabaseAdmin
    .from("retail_estimates")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (estErr) return NextResponse.json({ error: estErr.message }, { status: 500 });
  if (!est) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let toEmail: string | undefined;
  try {
    const body = await req.json();
    toEmail = body?.to_email || est.customer_email;
  } catch {
    toEmail = est.customer_email;
  }
  if (!toEmail) {
    return NextResponse.json({ error: "Customer email required" }, { status: 400 });
  }

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("company_name, phone, email")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const companyName = profile?.company_name || "Your Roofer";
  const replyEmail = profile?.email || auth.user.email || EMAIL_REPLY_TO;

  // Reconstruct the displayable summary from the saved snapshot + measurements
  // + addon_qtys. Snapshot is the immutable source of truth; live template
  // could have shifted since the estimate was saved.
  const snap = (est.template_snapshot || null) as RetailTemplate | null;
  const measurements = (est.measurements || {}) as Record<string, number>;
  const addonQtys = (est.addon_qtys || {}) as Record<string, number>;

  const measurementsSummary: Array<{ label: string; value: number; unit: string }> = [];
  for (const [code, value] of Object.entries(measurements)) {
    const v = Number(value || 0);
    if (v <= 0) continue;
    const meta = MEASUREMENT_LABELS[code];
    if (!meta) continue;
    measurementsSummary.push({ label: meta.label, value: v, unit: meta.unit });
  }

  const addonLineItems: Array<{ description: string; qty: number; lineTotal: number }> = [];
  if (snap?.add_ons) {
    for (const a of snap.add_ons) {
      const qty = Number(addonQtys[a.code] || 0);
      if (qty <= 0) continue;
      const unit = Number(a.unit_price || 0);
      addonLineItems.push({
        description: a.description,
        qty,
        lineTotal: unit * qty,
      });
    }
  }

  const productName = snap?._meta?.template_name || "Roof Replacement";
  const manufacturer = snap?._meta?.manufacturer || "";
  const manufacturerSeries = snap?._meta?.product_line || null;
  const warranty = snap?.warranty_disclosure || null;

  const { html, text } = renderRetailEstimateEmail({
    customerName: est.customer_name,
    customerAddress: est.customer_address,
    companyName,
    companyPhone: profile?.phone || null,
    companyEmail: profile?.email || null,
    productName,
    manufacturer,
    manufacturerSeries,
    warrantyDisclosure: warranty,
    totalAmount: Number(est.total_amount || 0),
    baseAmount: Number(est.base_amount || 0),
    addonsAmount: Number(est.addons_amount || 0),
    measurementsSummary,
    addonLineItems,
  });

  const resend = getResend();
  const subject = `Roof estimate — ${productName}${est.customer_name ? ` for ${est.customer_name}` : ""}`;
  const fromName = `${companyName} via Dumb Roof <${EMAIL_FROM.match(/<([^>]+)>/)?.[1] || "hello@dumbroof.ai"}>`;

  try {
    const result = await resend.emails.send({
      from: fromName,
      to: toEmail,
      replyTo: replyEmail,
      subject,
      html,
      text,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    await supabaseAdmin
      .from("retail_estimates")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        customer_email: toEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", companyId);

    return NextResponse.json({ ok: true, message_id: result.data?.id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
