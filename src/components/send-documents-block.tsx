"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface Props {
  claimId: string;
  claimAddress: string;
  claimNumber: string;
  adjusterEmail: string;
  carrierName?: string;
  filePath: string;
  outputFiles: string[];
}

function friendlyName(file: string): string {
  return file.replace(/_/g, " ").replace(".pdf", "").replace(/^\d+\s*/, "");
}

// Strip CR/LF to prevent email-header injection on any free-text field that
// eventually becomes a header (to, cc, subject).
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

// HTML-escape user-sourced strings that get interpolated into email bodyHtml.
// claimAddress and filenames flow straight into the outbound carrier email —
// an unescaped `<` or `&` will break rendering (or worse, in the future).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function SendDocumentsBlock({ claimId, claimAddress, claimNumber, adjusterEmail, filePath, outputFiles }: Props) {
  const [recipientEmail, setRecipientEmail] = useState(adjusterEmail || "");
  const [ccEmail, setCcEmail] = useState("");
  const [editClaimNumber, setEditClaimNumber] = useState(claimNumber || "");
  const [recipientType, setRecipientType] = useState<"carrier" | "homeowner">("carrier");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
    };
  }, []);

  const toggleFile = (file: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const subject = sanitizeHeader(editClaimNumber) || `Inspection Report — ${claimAddress}`;

  const handleSend = async () => {
    setErrorMsg(null);
    const toEmail = sanitizeHeader(recipientEmail);
    if (!toEmail || selectedFiles.size === 0) return;
    if (recipientType === "carrier" && !sanitizeHeader(editClaimNumber)) {
      setErrorMsg("Claim number is required before sending to carrier. Carriers auto-reject emails without a claim number in the subject.");
      return;
    }
    if (!currentUserId) {
      setErrorMsg("Still loading your account. Try again in a moment.");
      return;
    }
    setSending(true);
    setSent(false);

    const selected = Array.from(selectedFiles);
    const attachmentPaths = selected.map((f) => `${filePath}/output/${f}`);

    const safeAddress = escapeHtml(claimAddress);
    const safeDocNames = escapeHtml(selected.map(friendlyName).join(", "));

    const bodyHtml = recipientType === "carrier"
      ? `<p>Please find the attached documentation for the property at <strong>${safeAddress}</strong>.</p>
         <p>Attached: ${safeDocNames}.</p>
         <p>Please review at your earliest convenience.</p>`
      : `<p>Thank you for allowing us to inspect your property at <strong>${safeAddress}</strong>.</p>
         <p>Attached you will find: ${safeDocNames}.</p>
         <p>Please don't hesitate to reach out if you have any questions.</p>`;

    // User-entered CC only. Backend auto-BCCs DUMBROOF_TEAM_BCC
    // (claims@dumbroof.ai, tom@, matt@) via send_claim_email — do NOT add
    // platform addresses to CC or they'll leak into the carrier's header.
    const ccList: string[] = [];
    if (ccEmail.trim()) {
      ccEmail.split(",").forEach((e) => {
        const trimmed = sanitizeHeader(e);
        if (trimmed && trimmed.includes("@")) ccList.push(trimmed);
      });
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          user_id: currentUserId,
          to_email: toEmail,
          cc: ccList.join(", "),
          subject: sanitizeHeader(subject),
          body_html: bodyHtml,
          attachment_paths: attachmentPaths,
          email_type: "custom",
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail ? `Send failed (${res.status}): ${detail}` : `Send failed (${res.status})`);
      }
      setSent(true);
      if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
      sentTimerRef.current = setTimeout(() => setSent(false), 5000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to send email. Please try again.");
    }
    setSending(false);
  };

  return (
    <div className="border-t border-white/[0.06] pt-4 mt-4">
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)]">
          Email Documents
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={recipientType === "carrier"}
            onClick={() => {
              setRecipientType("carrier");
              setRecipientEmail(adjusterEmail || "");
              setErrorMsg(null);
            }}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              recipientType === "carrier"
                ? "bg-[var(--cyan)]/10 text-[var(--cyan)] border border-[var(--cyan)]/30"
                : "bg-white/5 text-[var(--gray-muted)] border border-white/10 hover:bg-white/10"
            }`}
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send to Insurance
          </button>
          <button
            type="button"
            aria-pressed={recipientType === "homeowner"}
            onClick={() => {
              setRecipientType("homeowner");
              setRecipientEmail("");
              setErrorMsg(null);
            }}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              recipientType === "homeowner"
                ? "bg-[var(--cyan)]/10 text-[var(--cyan)] border border-[var(--cyan)]/30"
                : "bg-white/5 text-[var(--gray-muted)] border border-white/10 hover:bg-white/10"
            }`}
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send to Homeowner
          </button>
        </div>

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
                <svg aria-hidden="true" className="w-4 h-4 text-[var(--gray-dim)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <span className="text-sm text-[var(--gray)] font-medium">{friendlyName(file)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-1">
              {recipientType === "carrier" ? "Adjuster Email" : "Homeowner Email"}
            </label>
            <input
              type="email"
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
              type="email"
              multiple
              placeholder="cc@example.com, another@example.com"
              value={ccEmail}
              onChange={(e) => setCcEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
            />
            <p className="text-[10px] text-[var(--gray-dim)] mt-1">The DumbRoof team is automatically BCC&apos;d for every claim email.</p>
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!recipientEmail || selectedFiles.size === 0 || sending || !currentUserId}
            className="w-full px-4 py-2.5 rounded-lg bg-[var(--cyan)]/10 text-[var(--cyan)] text-sm font-semibold hover:bg-[var(--cyan)]/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {sending ? "Sending..." : `Send ${selectedFiles.size} Document${selectedFiles.size !== 1 ? "s" : ""}`}
          </button>
        </div>

        {errorMsg && (
          <p role="alert" className="text-xs text-red-400 flex items-start gap-1">
            <svg aria-hidden="true" className="w-3 h-3 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
            </svg>
            {errorMsg}
          </p>
        )}

        {sent && (
          <p role="status" aria-live="polite" className="text-xs text-green-400 flex items-center gap-1">
            <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Documents sent to {recipientEmail}
          </p>
        )}
      </div>
    </div>
  );
}
