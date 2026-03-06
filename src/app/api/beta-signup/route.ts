import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const roleLabels: Record<string, string> = {
  sales_rep: "Sales Rep",
  public_adjuster: "Public Adjuster",
  attorney: "Attorney",
  appraiser: "Appraiser",
  contractor: "Contractor",
  owner: "Owner",
};

const productLabels: Record<string, string> = {
  claims_ai: "Claims AI",
  repair_ai: "Repair AI",
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, phone, company_name, role, products } = body;

    if (!name || !email || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { error: dbError } = await supabase
      .from("beta_signups")
      .insert({
        name,
        email,
        phone: phone || null,
        company_name: company_name || null,
        role,
        products: products || [],
      });

    if (dbError) {
      if (dbError.code === "23505") {
        return NextResponse.json({ error: "This email is already on the beta list." }, { status: 409 });
      }
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const productList = (products || [])
        .map((p: string) => productLabels[p] || p)
        .join(", ") || "None selected";

      await transporter.sendMail({
        from: `"Dumb Roof Beta" <${process.env.SMTP_USER}>`,
        to: "tom@dumbroof.ai, hello@dumbroof.ai, tkovack@usaroofmasters.com",
        subject: `New Beta Signup: ${name} (${roleLabels[role] || role})`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #0d2137; padding: 20px 24px; border-radius: 12px 12px 0 0;">
              <h2 style="color: white; margin: 0; font-size: 18px;">New Beta Signup</h2>
            </div>
            <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280; width: 140px;">Name</td>
                  <td style="padding: 10px 0; font-weight: 600; color: #0d2137;">${name}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">Email</td>
                  <td style="padding: 10px 0;"><a href="mailto:${email}" style="color: #0d2137;">${email}</a></td>
                </tr>
                ${phone ? `
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">Phone</td>
                  <td style="padding: 10px 0;"><a href="tel:${phone}" style="color: #0d2137;">${phone}</a></td>
                </tr>` : ""}
                ${company_name ? `
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">Company</td>
                  <td style="padding: 10px 0; color: #0d2137;">${company_name}</td>
                </tr>` : ""}
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">Role</td>
                  <td style="padding: 10px 0; font-weight: 600; color: #0d2137;">${roleLabels[role] || role}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; color: #6b7280;">Products</td>
                  <td style="padding: 10px 0; color: #0d2137;">${productList}</td>
                </tr>
              </table>
              <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <a href="https://dumbroof.ai/admin" style="display: inline-block; background: #0d2137; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
                  Review in Admin Dashboard
                </a>
              </div>
            </div>
          </div>
        `,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Submission failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
