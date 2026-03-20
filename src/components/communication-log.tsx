"use client";

import { useEffect, useState } from "react";

interface ClaimEmail {
  id: string;
  email_type: string;
  to_email: string;
  cc_email: string | null;
  subject: string;
  body_html: string;
  send_method: string;
  status: string;
  sent_at: string;
}

interface Props {
  claimId: string;
}

const TYPE_STYLES: Record<string, { bg: string; label: string }> = {
  supplement: { bg: "bg-red-100 text-red-700", label: "Supplement" },
  custom: { bg: "bg-blue-100 text-blue-700", label: "Email" },
  invoice: { bg: "bg-green-100 text-green-700", label: "Invoice" },
  coc: { bg: "bg-purple-100 text-purple-700", label: "COC" },
  aob: { bg: "bg-amber-100 text-amber-700", label: "AOB" },
};

export function CommunicationLog({ claimId }: Props) {
  const [emails, setEmails] = useState<ClaimEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEmails() {
      try {
        const res = await fetch(`/api/claim-emails?claim_id=${claimId}`);
        if (res.ok) {
          const data = await res.json();
          setEmails(data.emails || []);
        }
      } catch {
        // Non-fatal
      } finally {
        setLoading(false);
      }
    }
    fetchEmails();
  }, [claimId]);

  if (loading || emails.length === 0) return null;

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--white)]">Communication Log</h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
            {emails.length} sent
          </span>
        </div>
        <svg className={`w-5 h-5 text-[var(--gray-dim)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.04]">
          {emails.map((email) => {
            const style = TYPE_STYLES[email.email_type] || TYPE_STYLES.custom;
            const isExpanded = expandedEmail === email.id;
            const date = new Date(email.sent_at);
            const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

            return (
              <div key={email.id} className="border-b border-white/[0.04] last:border-b-0">
                <button
                  onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
                  className="w-full flex items-center gap-3 px-6 py-3 hover:bg-white/[0.04] transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${style.bg}`}>
                        {style.label}
                      </span>
                      <span className="text-xs font-medium text-[var(--white)] truncate">{email.subject}</span>
                    </div>
                    <p className="text-[10px] text-[var(--gray-muted)] mt-0.5">
                      To: {email.to_email}
                      {email.cc_email && <span> | CC: {email.cc_email}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-[var(--gray-dim)]">{dateStr}</p>
                    <p className="text-[10px] text-[var(--gray-dim)]">{timeStr}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${email.status === "sent" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                      {email.status === "sent" ? "Sent" : email.status}
                    </span>
                    <span className="text-[9px] text-[var(--gray-dim)]">via {email.send_method}</span>
                  </div>
                  <svg className={`w-4 h-4 text-[var(--gray-dim)] transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-4 pt-1">
                    <div className="bg-white/[0.04] rounded-lg p-4 text-xs text-[var(--gray)] leading-relaxed" dangerouslySetInnerHTML={{ __html: email.body_html || "" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
