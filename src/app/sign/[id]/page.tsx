import { supabaseAdmin } from "@/lib/supabase/admin";
import { SignForm } from "./sign-form";

export default async function SignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Fetch signing request server-side
  const { data: rows } = await supabaseAdmin
    .from("aob_signatures")
    .select("id, document_type, homeowner_name, company_name, claim_address, unsigned_pdf_path, status")
    .eq("id", id)
    .limit(1);

  const sig = rows?.[0] || null;

  if (!sig) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Not Found</h1>
          <p className="text-gray-600 text-sm">This signing request does not exist or has expired.</p>
        </div>
      </div>
    );
  }

  if (sig.status === "signed") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Already Signed</h1>
          <p className="text-gray-600 text-sm">This document has already been signed. No further action is required.</p>
        </div>
      </div>
    );
  }

  if (sig.status === "expired" || sig.status === "cancelled") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Request {sig.status === "expired" ? "Expired" : "Cancelled"}</h1>
          <p className="text-gray-600 text-sm">This signing request is no longer valid. Please contact {sig.company_name || "the sender"}.</p>
        </div>
      </div>
    );
  }

  // Get PDF URL
  let pdfUrl = null;
  if (sig.unsigned_pdf_path) {
    const { data: signedUrl } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUrl(sig.unsigned_pdf_path, 3600);
    pdfUrl = signedUrl?.signedUrl || null;
  }

  return (
    <SignForm
      signatureId={sig.id}
      documentType={sig.document_type || "aob"}
      homeownerName={sig.homeowner_name || ""}
      companyName={sig.company_name || ""}
      claimAddress={sig.claim_address || ""}
      pdfUrl={pdfUrl}
    />
  );
}
