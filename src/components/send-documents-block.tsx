"use client";

import { useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface Props {
  claimId: string;
  claimAddress: string;
  claimNumber: string;
  adjusterEmail: string;
  carrierName: string;
  filePath: string;
  outputFiles: string[];
}

export function SendDocumentsBlock({ claimId, claimAddress, claimNumber, adjusterEmail, carrierName, filePath, outputFiles }: Props) {
  const [showSend, setShowSend] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientType, setRecipientType] = useState<"carrier" | "homeowner">("carrier");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!recipientEmail) return;
    setSending(true);
    setSent(false);

    // Build attachment paths from output files
    const attachmentPaths = outputFiles.map((f) => `${filePath}/pdfoutput/${f}`);

    const subject = claimNumber
      ? `Claim #${claimNumber} — ${recipientType === "carrier" ? "Inspection Report Package" : "Your Roof Inspection Report"}`
      : `${recipientType === "carrier" ? "Inspection Report Package" : "Your Roof Inspection Report"} — ${claimAddress}`;

    const bodyHtml = recipientType === "carrier"
      ? `<p>Please find attached the inspection report package for the property at <strong>${claimAddress}</strong>.</p>
         <p>${outputFiles.length} document${outputFiles.length !== 1 ? "s" : ""} attached including forensic causation report${outputFiles.length > 1 ? ", estimate, and supporting documentation" : ""}.</p>
         <p>Please review at your earliest convenience.</p>`
      : `<p>Thank you for allowing us to inspect your property at <strong>${claimAddress}</strong>.</p>
         <p>Attached you will find ${outputFiles.length > 1 ? "your complete inspection report package" : "your forensic inspection report"}, which documents the findings from our inspection.</p>
         <p>Please don&apos;t hesitate to reach out if you have any questions.</p>`;

    try {
      await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          to_email: recipientEmail,
          subject,
          body_html: bodyHtml,
          attachment_paths: attachmentPaths,
          email_type: "custom",
        }),
      });
      setSent(true);
      setTimeout(() => setSent(false), 5000);
    } catch { /* ignore */ }
    setSending(false);
  };

  return (
    <div className="border-t border-white/[0.06] pt-4">
      {!showSend ? (
        <button
          onClick={() => {
            setShowSend(true);
            setRecipientEmail(adjusterEmail);
          }}
          className="flex items-center gap-2 text-sm text-[var(--cyan)] font-semibold hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
          Email Documents to Carrier or Homeowner
        </button>
      ) : (
        <div className="space-y-3">
          {/* Recipient type toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setRecipientType("carrier");
                setRecipientEmail(adjusterEmail);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                recipientType === "carrier" ? "bg-[var(--cyan)]/10 text-[var(--cyan)]" : "bg-white/5 text-[var(--gray-muted)]"
              }`}
            >
              Send to Carrier
            </button>
            <button
              onClick={() => {
                setRecipientType("homeowner");
                setRecipientEmail("");
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                recipientType === "homeowner" ? "bg-[var(--cyan)]/10 text-[var(--cyan)]" : "bg-white/5 text-[var(--gray-muted)]"
              }`}
            >
              Send to Homeowner
            </button>
          </div>

          {/* Email input + send */}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              placeholder={recipientType === "carrier" ? "Adjuster email" : "Homeowner email"}
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
            />
            <button
              onClick={handleSend}
              disabled={!recipientEmail || sending}
              className="px-4 py-2 rounded-lg bg-[var(--cyan)]/10 text-[var(--cyan)] text-sm font-semibold hover:bg-[var(--cyan)]/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {sending ? "Sending..." : `Send ${outputFiles.length} Document${outputFiles.length !== 1 ? "s" : ""}`}
            </button>
            <button
              onClick={() => setShowSend(false)}
              className="px-3 py-2 text-xs text-[var(--gray-muted)] hover:text-[var(--white)] transition-colors"
            >
              Cancel
            </button>
          </div>

          {/* Sent confirmation */}
          {sent && (
            <p className="text-xs text-green-400 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Documents sent to {recipientEmail}
            </p>
          )}

          {/* What's being sent */}
          <p className="text-[10px] text-[var(--gray-dim)]">
            {outputFiles.length} PDF{outputFiles.length !== 1 ? "s" : ""} will be attached: {outputFiles.map(f => f.replace(/_/g, " ").replace(".pdf", "")).join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
