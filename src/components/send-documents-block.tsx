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

function friendlyName(file: string): string {
  return file.replace(/_/g, " ").replace(".pdf", "").replace(/^\d+\s*/, "");
}

export function SendDocumentsBlock({ claimId, claimAddress, claimNumber, adjusterEmail, carrierName, filePath, outputFiles }: Props) {
  const [showSend, setShowSend] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [ccEmail, setCcEmail] = useState("");
  const [editClaimNumber, setEditClaimNumber] = useState(claimNumber || "");
  const [recipientType, setRecipientType] = useState<"carrier" | "homeowner">("carrier");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const toggleFile = (file: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const subject = editClaimNumber.trim()
    ? `Claim #${editClaimNumber.trim()}`
    : `Inspection Report — ${claimAddress}`;

  const handleSend = async () => {
    if (!recipientEmail || selectedFiles.size === 0) return;
    setSending(true);
    setSent(false);

    const selected = Array.from(selectedFiles);
    const attachmentPaths = selected.map((f) => `${filePath}/output/${f}`);

    const docNames = selected.map(friendlyName).join(", ");

    const bodyHtml = recipientType === "carrier"
      ? `<p>Please find the attached documentation for the property at <strong>${claimAddress}</strong>.</p>
         <p>Attached: ${docNames}.</p>
         <p>Please review at your earliest convenience.</p>`
      : `<p>Thank you for allowing us to inspect your property at <strong>${claimAddress}</strong>.</p>
         <p>Attached you will find: ${docNames}.</p>
         <p>Please don't hesitate to reach out if you have any questions.</p>`;

    // Build CC list: user-entered CC + always BCC claims@dumbroof.ai
    const ccList: string[] = [];
    if (ccEmail.trim()) {
      ccEmail.split(",").forEach((e) => {
        const trimmed = e.trim();
        if (trimmed) ccList.push(trimmed);
      });
    }
    // Always include claims@dumbroof.ai
    ccList.push("claims@dumbroof.ai");

    try {
      await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          to_email: recipientEmail,
          cc: ccList.join(", "),
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
            setSelectedFiles(new Set());
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

          {/* Claim number — editable, drives subject line */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-1">
              Claim Number
            </label>
            <input
              placeholder="e.g. 0820085561"
              value={editClaimNumber}
              onChange={(e) => setEditClaimNumber(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
            />
            <p className="text-[10px] text-[var(--gray-dim)] mt-1">
              Subject line: <span className="text-[var(--gray)]">{subject}</span>
            </p>
          </div>

          {/* Document selection */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-2">
              Select documents to send
            </p>
            <div className="space-y-1.5">
              {outputFiles.map((file) => (
                <label
                  key={file}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    selectedFiles.has(file)
                      ? "bg-[var(--cyan)]/[0.08] border border-[var(--cyan)]/20"
                      : "bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file)}
                    onChange={() => toggleFile(file)}
                    className="w-4 h-4 rounded border-white/20 text-[var(--cyan)] focus:ring-[var(--cyan)] bg-white/5"
                  />
                  <svg className="w-4 h-4 text-[var(--gray-dim)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span className="text-sm text-[var(--gray)] font-medium">{friendlyName(file)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Email inputs: TO + CC + send */}
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-1">
                {recipientType === "carrier" ? "Adjuster Email" : "Homeowner Email"}
              </label>
              <input
                placeholder={recipientType === "carrier" ? "adjuster@carrier.com" : "homeowner@email.com"}
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-1">
                CC <span className="text-[var(--gray-dim)] normal-case">(separate multiple with commas)</span>
              </label>
              <input
                placeholder="cc@example.com, another@example.com"
                value={ccEmail}
                onChange={(e) => setCcEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
              />
              <p className="text-[10px] text-[var(--gray-dim)] mt-1">claims@dumbroof.ai is always included automatically</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSend}
                disabled={!recipientEmail || selectedFiles.size === 0 || sending}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--cyan)]/10 text-[var(--cyan)] text-sm font-semibold hover:bg-[var(--cyan)]/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {sending ? "Sending..." : `Send ${selectedFiles.size} Document${selectedFiles.size !== 1 ? "s" : ""}`}
              </button>
              <button
                onClick={() => setShowSend(false)}
                className="px-3 py-2 text-xs text-[var(--gray-muted)] hover:text-[var(--white)] transition-colors"
              >
                Cancel
              </button>
            </div>
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
        </div>
      )}
    </div>
  );
}
