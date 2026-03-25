import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** GET — fetch signing request data (PUBLIC — no auth required, secured by UUID) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: rows } = await supabaseAdmin
    .from("aob_signatures")
    .select("id, document_type, homeowner_name, homeowner_email, company_name, claim_address, unsigned_pdf_path, status, created_at")
    .eq("id", id)
    .limit(1);

  const sig = rows?.[0] || null;
  if (!sig) {
    return NextResponse.json({ error: "Signing request not found" }, { status: 404 });
  }

  if (sig.status === "signed") {
    return NextResponse.json({ error: "already_signed", signature: sig }, { status: 400 });
  }

  if (sig.status === "expired" || sig.status === "cancelled") {
    return NextResponse.json({ error: `This signing request has been ${sig.status}` }, { status: 400 });
  }

  // Get signed URL for the unsigned PDF
  let pdfUrl = null;
  if (sig.unsigned_pdf_path) {
    const { data: signedUrl } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUrl(sig.unsigned_pdf_path, 3600);
    pdfUrl = signedUrl?.signedUrl || null;
  }

  return NextResponse.json({
    signature: {
      id: sig.id,
      document_type: sig.document_type || "aob",
      homeowner_name: sig.homeowner_name,
      company_name: sig.company_name,
      claim_address: sig.claim_address,
      status: sig.status,
    },
    pdf_url: pdfUrl,
  });
}

/** POST — submit signature (PUBLIC — no auth, secured by UUID) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = await req.json();
  const { signer_name, signature_image } = body;

  if (!signer_name || !signature_image) {
    return NextResponse.json({ error: "signer_name and signature_image required" }, { status: 400 });
  }

  // Verify signature request exists and is pending
  const { data: rows } = await supabaseAdmin
    .from("aob_signatures")
    .select("id, unsigned_pdf_path, claim_id, user_id, status")
    .eq("id", id)
    .limit(1);

  const sig = rows?.[0] || null;
  if (!sig) {
    return NextResponse.json({ error: "Signing request not found" }, { status: 404 });
  }

  if (sig.status === "signed") {
    return NextResponse.json({ error: "Already signed" }, { status: 400 });
  }

  try {
    // Download the unsigned PDF
    const { data: pdfData } = await supabaseAdmin.storage
      .from("claim-documents")
      .download(sig.unsigned_pdf_path);

    if (!pdfData) {
      return NextResponse.json({ error: "Could not load document" }, { status: 500 });
    }

    const pdfBytes = new Uint8Array(await pdfData.arrayBuffer());

    // Overlay signature using pdf-lib
    const { PDFDocument, rgb } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { height } = lastPage.getSize();

    // Decode base64 signature image and embed as PNG
    const sigBase64 = signature_image.replace(/^data:image\/png;base64,/, "");
    const sigBytes = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));
    const sigImage = await pdfDoc.embedPng(sigBytes);

    // Place signature (bottom-left area, typical signature block location)
    const sigWidth = 200;
    const sigHeight = (sigImage.height / sigImage.width) * sigWidth;
    lastPage.drawImage(sigImage, {
      x: 72,
      y: 120,
      width: sigWidth,
      height: sigHeight,
    });

    // Add signer name and date text
    lastPage.drawText(`Signed by: ${signer_name}`, {
      x: 72,
      y: 105,
      size: 9,
      color: rgb(0.2, 0.2, 0.2),
    });

    lastPage.drawText(`Date: ${new Date().toLocaleDateString("en-US")}`, {
      x: 72,
      y: 92,
      size: 9,
      color: rgb(0.2, 0.2, 0.2),
    });

    // Get signer IP for audit trail
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "unknown";

    lastPage.drawText(`IP: ${ip}`, {
      x: 72,
      y: 79,
      size: 7,
      color: rgb(0.5, 0.5, 0.5),
    });

    const signedPdfBytes = await pdfDoc.save();

    // Upload signed PDF
    const signedPath = sig.unsigned_pdf_path.replace("unsigned_", "signed_").replace(".pdf", `_signed.pdf`);
    await supabaseAdmin.storage
      .from("claim-documents")
      .upload(signedPath, signedPdfBytes, { contentType: "application/pdf", upsert: true });

    // Update record
    await supabaseAdmin
      .from("aob_signatures")
      .update({
        status: "signed",
        signed_at: new Date().toISOString(),
        signed_pdf_path: signedPath,
        signer_name,
        ip_address: ip,
      })
      .eq("id", id);

    // Get download URL
    const { data: signedUrl } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUrl(signedPath, 86400); // 24h

    return NextResponse.json({
      ok: true,
      signed_pdf_url: signedUrl?.signedUrl || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process signature";
    console.error("Signature processing error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
