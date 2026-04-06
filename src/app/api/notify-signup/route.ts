import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const RESEND_KEY = process.env.RESEND_API_KEY?.trim();
  if (!RESEND_KEY) {
    return NextResponse.json({ error: "No Resend key" }, { status: 500 });
  }

  const { email, source } = await req.json();
  if (!email) {
    return NextResponse.json({ error: "No email" }, { status: 400 });
  }

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const sourceLabel = typeof source === "string" && source.length > 0 ? source : "unknown";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "DumbRoof <noreply@dumbroof.ai>",
      to: ["tkovack@usaroofmasters.com", "hello@dumbroof.ai", "arivera@usaroofmasters.com", "tom@dumbroof.ai", "kristen@dumbroof.ai"],
      subject: `New User Signup: ${email}`,
      html: `<h2>New User Registered on dumbroof.ai</h2>
        <p><strong>${email}</strong> just created an account.</p>
        <p>Source: <strong>${sourceLabel}</strong></p>
        <p>Time: ${timestamp} ET</p>
        <p><a href="https://www.dumbroof.ai/dashboard/admin" style="background-color:#2563eb;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View Admin Dashboard</a></p>`,
    }),
  });

  return NextResponse.json({ ok: true });
}
