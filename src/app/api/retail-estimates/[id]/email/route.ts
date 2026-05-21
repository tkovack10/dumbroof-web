import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getResend } from "@/lib/resend";

export const dynamic = "force-dynamic";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;
  const { id } = await params;

  // Load estimate + the contractor's company profile for the header
  const [estimateRes, profileRes] = await Promise.all([
    supabaseAdmin.from("retail_estimates").select("*").eq("id", id).eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("company_profiles")
      .select("company_name, contact_name, phone, email, address, city_state_zip, website")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (estimateRes.error) return NextResponse.json({ error: estimateRes.error.message }, { status: 500 });
  const est = estimateRes.data;
  if (!est) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  if (!est.customer_email) {
    return NextResponse.json({ error: "Customer email required to send" }, { status: 400 });
  }

  type ProfileShape = {
    company_name?: string | null;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city_state_zip?: string | null;
    website?: string | null;
  };
  const profile: ProfileShape = profileRes.data || {};
  const companyName = profile.company_name || "Your Roofing Contractor";
  const contactName = profile.contact_name || "";
  const contractorPhone = profile.phone || "";
  const contractorEmail = profile.email || "";
  const contractorWeb = profile.website || "";
  const printUrl = `${new URL(req.url).origin}/dashboard/retail-estimate/${id}/print`;

  const snap = (est.template_snapshot as { _meta?: { product_line?: string; manufacturer?: string; system_warranty?: { name: string } } } | null) || {};
  const productLine = snap._meta?.product_line || est.template_id;
  const manufacturer = snap._meta?.manufacturer || "";
  const warrantyName = snap._meta?.system_warranty?.name || "";

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;color:#1a1a2e;line-height:1.55;">
  <h2 style="margin:0 0 12px;">Your roof estimate from ${companyName}</h2>
  <p>${est.customer_name ? `Hi ${est.customer_name},` : "Hello,"}</p>
  <p>Here's the estimate for your roof project at <strong>${est.customer_address || "your property"}</strong>.</p>

  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:20px 0;">
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Selected system</p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:600;">${manufacturer} ${productLine}</p>
    ${warrantyName ? `<p style="margin:0;color:#6b7280;font-size:13px;">${warrantyName}</p>` : ""}
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 0;color:#6b7280;">Roof area</td><td style="padding:8px 0;text-align:right;">${(est.measurements as { roof_area_sq?: number })?.roof_area_sq || 0} SQ</td></tr>
    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 0;color:#6b7280;">Complete system base</td><td style="padding:8px 0;text-align:right;">${fmtUsd(Number(est.base_amount))}</td></tr>
    ${Number(est.addons_amount) > 0 ? `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 0;color:#6b7280;">Add-ons</td><td style="padding:8px 0;text-align:right;">${fmtUsd(Number(est.addons_amount))}</td></tr>` : ""}
    ${Number(est.markup_amount) !== 0 ? `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 0;color:#6b7280;">${Number(est.markup_pct) >= 0 ? "Adjustment" : "Discount"} (${Number(est.markup_pct).toFixed(1)}%)</td><td style="padding:8px 0;text-align:right;">${fmtUsd(Number(est.markup_amount))}</td></tr>` : ""}
    <tr><td style="padding:14px 0 4px;font-weight:700;font-size:18px;">Total</td><td style="padding:14px 0 4px;text-align:right;font-weight:700;font-size:22px;color:#0d2137;">${fmtUsd(Number(est.total_amount))}</td></tr>
  </table>

  <p>This price is <strong>all-inclusive</strong> — tear-off, complete ${manufacturer} system warranty-eligible accessories, permit, dumpster, cleanup, and our workmanship warranty. No surprises.</p>

  <p style="text-align:center;margin:28px 0;">
    <a href="${printUrl}" style="display:inline-block;background:#0d2137;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;">View full quote → Print or save PDF</a>
  </p>

  <p>Have questions? Just reply to this email${contactName ? ` — ${contactName} will get back to you` : ""}.</p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="color:#6b7280;font-size:13px;line-height:1.45;">
    <strong>${companyName}</strong><br/>
    ${profile.address ? `${profile.address}<br/>` : ""}
    ${profile.city_state_zip ? `${profile.city_state_zip}<br/>` : ""}
    ${contractorPhone ? `${contractorPhone}<br/>` : ""}
    ${contractorEmail ? `<a href="mailto:${contractorEmail}" style="color:#6b7280;">${contractorEmail}</a><br/>` : ""}
    ${contractorWeb ? `<a href="${contractorWeb.startsWith("http") ? contractorWeb : `https://${contractorWeb}`}" style="color:#6b7280;">${contractorWeb}</a>` : ""}
  </p>
</div>`;

  const fromName = companyName.length <= 60 ? companyName : "DumbRoof";
  const fromAddress = `${fromName} <noreply@dumbroof.ai>`;

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: [est.customer_email as string],
      replyTo: contractorEmail || "tom@dumbroof.ai",
      bcc: ["claims@dumbroof.ai"],
      subject: `Your roof estimate — ${fmtUsd(Number(est.total_amount))}`,
      html,
      tags: [
        { name: "type", value: "retail-estimate" },
        { name: "estimate_id", value: id },
      ],
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  await supabaseAdmin
    .from("retail_estimates")
    .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  return NextResponse.json({ ok: true });
}
