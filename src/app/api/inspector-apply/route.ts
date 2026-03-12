import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      name,
      email,
      phone,
      city,
      state,
      experience,
      haag_certified,
      willing_to_travel,
      notes,
    } = body;

    // Validate required fields
    if (!name || !email || !phone || !city || !state || !experience || !haag_certified || !willing_to_travel) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Insert into Supabase
    const { error: dbError } = await getSb()
      .from("inspector_applications")
      .insert({
        name,
        email,
        phone,
        city,
        state,
        experience,
        haag_certified,
        willing_to_travel,
        notes: notes || null,
      });

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // Send notification email to hello@dumbroof.ai
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

      const haagLabel =
        haag_certified === "yes" ? "Yes - HAAG Certified" :
        haag_certified === "in-progress" ? "In Progress" :
        "No - Field Experience Only";

      const travelLabel: Record<string, string> = {
        local: "Local only (within 50 miles)",
        regional: "Regional (within 150 miles)",
        state: "Anywhere in my state",
        "multi-state": "Multi-state / neighboring states",
        nationwide: "Nationwide - will travel anywhere",
      };

      await transporter.sendMail({
        from: `"Dumb Roof Inspector Network" <${process.env.SMTP_USER}>`,
        to: "hello@dumbroof.ai",
        subject: `New Inspector Application: ${name} (${city}, ${state})`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #0d2137; padding: 20px 24px; border-radius: 12px 12px 0 0;">
              <h2 style="color: white; margin: 0; font-size: 18px;">New Inspector Application</h2>
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
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">Phone</td>
                  <td style="padding: 10px 0;"><a href="tel:${phone}" style="color: #0d2137;">${phone}</a></td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">Location</td>
                  <td style="padding: 10px 0; color: #0d2137;">${city}, ${state}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">Experience</td>
                  <td style="padding: 10px 0; color: #0d2137;">${experience} years</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">HAAG Certified</td>
                  <td style="padding: 10px 0; font-weight: 600; color: ${haag_certified === "yes" ? "#b45309" : "#0d2137"};">${haagLabel}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 10px 0; color: #6b7280;">Willing to Travel</td>
                  <td style="padding: 10px 0; font-weight: 600; color: #0d2137;">${travelLabel[willing_to_travel] || willing_to_travel}</td>
                </tr>
                ${notes ? `
                <tr>
                  <td style="padding: 10px 0; color: #6b7280; vertical-align: top;">Notes</td>
                  <td style="padding: 10px 0; color: #0d2137;">${notes}</td>
                </tr>` : ""}
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
