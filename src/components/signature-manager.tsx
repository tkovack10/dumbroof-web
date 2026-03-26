"use client";

import { useState, useEffect, useCallback } from "react";
import { FileUploadZone } from "@/components/file-upload-zone";
import { directUpload } from "@/lib/upload-utils";

interface Props {
  claimId: string;
  claimAddress: string;
  carrierName: string;
  userId: string;
  filePath: string;
  claimNumber?: string;
}

interface SignatureRecord {
  id: string;
  document_type: string;
  homeowner_name: string;
  homeowner_email: string;
  company_name: string;
  claim_address: string;
  status: string;
  signed_at: string | null;
  carrier_cadence_started: boolean;
  carrier_email: string | null;
  created_at: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  aob: "Assignment of Benefits (AOB)",
  contingency: "Contingency Agreement",
};

export function SignatureManager({ claimId, claimAddress, carrierName, userId, filePath, claimNumber }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
  const [docType, setDocType] = useState<"aob" | "contingency">("aob");
  const [homeownerName, setHomeownerName] = useState("");
  const [homeownerEmail, setHomeownerEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [signLink, setSignLink] = useState<string | null>(null);
  const [carrierEmail, setCarrierEmail] = useState("");
  const [notifying, setNotifying] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState(false);
  const [signedPdfFile, setSignedPdfFile] = useState<File[]>([]);
  const [uploadingSigned, setUploadingSigned] = useState(false);

  const fetchSignatures = useCallback(async () => {
    try {
      const res = await fetch(`/api/signatures?claim_id=${claimId}`);
      if (res.ok) {
        const data = await res.json();
        setSignatures(data.signatures);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [claimId]);

  useEffect(() => { fetchSignatures(); }, [fetchSignatures]);

  const sendForSignature = async () => {
    if (!homeownerName || !homeownerEmail) return;
    setSending(true);
    setSignLink(null);
    try {
      const res = await fetch("/api/signatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          document_type: docType,
          homeowner_name: homeownerName,
          homeowner_email: homeownerEmail,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSignLink(data.sign_link);
        setHomeownerName("");
        setHomeownerEmail("");
        await fetchSignatures();
      }
    } catch { /* ignore */ }
    setSending(false);
  };

  const notifyCarrier = async (sigId: string) => {
    if (!carrierEmail) return;
    setNotifying(sigId);
    try {
      const res = await fetch("/api/signatures/notify-carrier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature_id: sigId, carrier_email: carrierEmail, claim_number: claimNumber || undefined }),
      });
      if (res.ok) {
        setCarrierEmail("");
        await fetchSignatures();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to notify carrier");
      }
    } catch { /* ignore */ }
    setNotifying(null);
  };

  if (loading) return (
    <div className="glass-card p-6 animate-pulse">
      <div className="h-5 w-48 bg-white/5 rounded" />
    </div>
  );

  const latestSig = signatures[0];
  const hasSigned = signatures.some((s) => s.status === "signed");
  const hasPending = signatures.some((s) => s.status === "pending");

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-[var(--white)]">AOB / Contingency Agreement</h3>
            <p className="text-xs text-[var(--gray-muted)]">
              Send for digital signature or upload a signed agreement
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasSigned && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 font-semibold">
              Signed
            </span>
          )}
          {hasPending && !hasSigned && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 font-semibold">
              Pending
            </span>
          )}
          {latestSig?.carrier_cadence_started && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 font-semibold">
              Carrier Notified
            </span>
          )}
          <svg className={`w-5 h-5 text-[var(--gray-muted)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-6 border-t border-white/[0.06]">
          {/* Existing signatures */}
          {signatures.length > 0 && (
            <div className="mt-4 space-y-3 mb-6">
              {signatures.map((sig) => (
                <div key={sig.id} className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">
                        {DOC_TYPE_LABELS[sig.document_type] || sig.document_type}
                      </p>
                      <p className="text-[10px] text-[var(--gray-dim)]">
                        {sig.homeowner_name} &middot; {sig.homeowner_email}
                      </p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      sig.status === "signed" ? "bg-green-500/10 text-green-400"
                        : sig.status === "pending" ? "bg-amber-500/10 text-amber-400"
                        : "bg-red-500/10 text-red-400"
                    }`}>
                      {sig.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Signed → show carrier notification */}
                  {sig.status === "signed" && !sig.carrier_cadence_started && (
                    <div className="mt-3 rounded-xl bg-green-500/[0.06] border border-green-500/20 p-3">
                      <p className="text-xs text-green-400 font-semibold mb-2">
                        Document signed! Send to carrier with W9 to start payment redirect.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          placeholder="Carrier adjuster email"
                          value={carrierEmail}
                          onChange={(e) => setCarrierEmail(e.target.value)}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                        />
                        <button
                          onClick={() => notifyCarrier(sig.id)}
                          disabled={!carrierEmail || notifying === sig.id}
                          className="px-4 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm font-semibold hover:bg-green-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {notifying === sig.id ? "Sending..." : "Notify Carrier + Start Cadence"}
                        </button>
                      </div>
                    </div>
                  )}

                  {sig.carrier_cadence_started && (
                    <p className="mt-2 text-[10px] text-blue-400">
                      Carrier notified ({sig.carrier_email}). Follow-up cadence active: Day 7, 14, 21, 30.
                    </p>
                  )}

                  {sig.status === "pending" && (
                    <p className="mt-2 text-[10px] text-amber-400">
                      Waiting for homeowner to sign. Link sent to {sig.homeowner_email}.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Create new signature request */}
          <div className="space-y-4 mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)]">
              {signatures.length > 0 ? "Send Another" : "Send for Signature"}
            </p>

            {/* Document type */}
            <div className="flex flex-col sm:flex-row gap-2">
              {(["aob", "contingency"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setDocType(type)}
                  className={`flex-1 p-3 rounded-xl border text-left transition-colors ${
                    docType === type
                      ? "border-blue-500/30 bg-blue-500/[0.06]"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                  }`}
                >
                  <p className={`text-sm font-semibold ${docType === type ? "text-blue-400" : "text-[var(--white)]"}`}>
                    {DOC_TYPE_LABELS[type]}
                  </p>
                </button>
              ))}
            </div>

            {/* Toggle: digital vs upload */}
            <div className="flex gap-2">
              <button
                onClick={() => setUploadMode(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  !uploadMode ? "bg-blue-500/10 text-blue-400" : "bg-white/5 text-[var(--gray-muted)]"
                }`}
              >
                Send for Digital Signature
              </button>
              <button
                onClick={() => setUploadMode(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  uploadMode ? "bg-blue-500/10 text-blue-400" : "bg-white/5 text-[var(--gray-muted)]"
                }`}
              >
                Upload Already Signed
              </button>
            </div>

            {!uploadMode ? (
              /* Digital signature flow */
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    placeholder="Homeowner name"
                    value={homeownerName}
                    onChange={(e) => setHomeownerName(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                  />
                  <input
                    placeholder="Homeowner email"
                    value={homeownerEmail}
                    onChange={(e) => setHomeownerEmail(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                  />
                </div>
                <button
                  onClick={sendForSignature}
                  disabled={!homeownerName || !homeownerEmail || sending}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? "Generating & Sending..." : `Send ${DOC_TYPE_LABELS[docType]} for Signature`}
                </button>

                {signLink && (
                  <div className="rounded-xl bg-blue-500/[0.06] border border-blue-500/20 p-3">
                    <p className="text-xs text-blue-400 font-semibold mb-1">Signing link sent! You can also share directly:</p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={signLink}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-[var(--cyan)] font-mono"
                      />
                      <button
                        onClick={() => navigator.clipboard.writeText(signLink)}
                        className="text-[10px] text-[var(--gray-muted)] hover:text-[var(--white)] shrink-0"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Upload already-signed flow */
              <div className="space-y-3">
                <p className="text-xs text-[var(--gray-muted)]">
                  Upload a pre-signed AOB or contingency agreement. It will be marked as signed immediately.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    placeholder="Homeowner name"
                    value={homeownerName}
                    onChange={(e) => setHomeownerName(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                  />
                  <input
                    placeholder="Homeowner email"
                    value={homeownerEmail}
                    onChange={(e) => setHomeownerEmail(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                  />
                </div>
                <FileUploadZone
                  label="Signed Document"
                  description="Upload the pre-signed PDF"
                  accept=".pdf"
                  files={signedPdfFile}
                  onFilesChange={setSignedPdfFile}
                />
                <button
                  onClick={async () => {
                    if (!homeownerName || !homeownerEmail || signedPdfFile.length === 0) return;
                    setUploadingSigned(true);
                    try {
                      // Upload the PDF
                      const file = signedPdfFile[0];
                      const signRes = await fetch("/api/storage/sign-upload", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          folder: "aob",
                          fileName: `signed_${docType}_${Date.now()}.pdf`,
                          claimPath: filePath,
                        }),
                      });
                      const signData = await signRes.json();
                      if (!signRes.ok) throw new Error(signData.error || "Failed to get upload URL");
                      await directUpload(signData.signedUrl, file);

                      // Create signature record with upload_mode flag
                      const res = await fetch("/api/signatures", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          claim_id: claimId,
                          document_type: docType,
                          homeowner_name: homeownerName,
                          homeowner_email: homeownerEmail,
                          upload_mode: true,
                          signed_pdf_path: signData.path,
                        }),
                      });

                      if (res.ok) {
                        setSignedPdfFile([]);
                        setHomeownerName("");
                        setHomeownerEmail("");
                        await fetchSignatures();
                      }
                    } catch {
                      /* ignore */
                    }
                    setUploadingSigned(false);
                  }}
                  disabled={!homeownerName || !homeownerEmail || signedPdfFile.length === 0 || uploadingSigned}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {uploadingSigned ? "Uploading & Saving..." : "Upload & Save"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
