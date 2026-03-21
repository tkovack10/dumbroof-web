"use client";

import { useState } from "react";
import type { ScopeComparisonRow, CodeCitation } from "@/types/scope-comparison";

interface SupplementItem {
  id: string;
  type: "missing" | "under" | "code" | "photo";
  label: string;
  amount: number;
  detail: string;
  codeCitation?: CodeCitation | null;
  photoKey?: string;
}

interface Props {
  claimId: string;
  claimAddress: string;
  carrierName: string;
  comparisonRows: ScopeComparisonRow[];
  carrierRcv: number;
  contractorRcv: number;
  userId?: string;
  userName?: string;
  companyName?: string;
  companyPhone?: string;
}

export function SupplementComposer({ claimId, claimAddress, carrierName, comparisonRows, carrierRcv, contractorRcv, userId, userName, companyName, companyPhone }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showComposer, setShowComposer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toEmail, setToEmail] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://dumbroof-backend-production.up.railway.app";

  // Build selectable items from comparison rows
  const items: SupplementItem[] = [];

  for (const row of comparisonRows) {
    if (row.status === "missing") {
      const amt = row.usarm_amount || row.ev_qty * (row.xact_unit_price || 0);
      items.push({
        id: `missing-${row.checklist_desc || row.usarm_desc}`,
        type: "missing",
        label: row.checklist_desc || row.usarm_desc || "",
        amount: amt,
        detail: row.note || `${row.ev_qty} ${row.ev_unit} at $${(row.xact_unit_price || 0).toFixed(2)}/${row.ev_unit}`,
        codeCitation: row.code_citation,
      });
    } else if (row.status === "under") {
      const carrierAmt = row.carrier_amount || 0;
      const usarmAmt = row.usarm_amount || row.ev_qty * (row.xact_unit_price || 0);
      const variance = usarmAmt - carrierAmt;
      if (variance > 0) {
        items.push({
          id: `under-${row.checklist_desc || row.usarm_desc}`,
          type: "under",
          label: row.checklist_desc || row.usarm_desc || "",
          amount: variance,
          detail: row.note || `Carrier: ${row.carrier_qty} ${row.carrier_unit}, EagleView: ${row.ev_qty} ${row.ev_unit}`,
          codeCitation: row.code_citation,
        });
      }
    }
  }

  // Code citation items (for items that have citations, deduped)
  const codeItems: SupplementItem[] = [];
  const seenCodes = new Set<string>();
  for (const row of comparisonRows) {
    if (row.code_citation?.code_tag && !seenCodes.has(row.code_citation.code_tag)) {
      seenCodes.add(row.code_citation.code_tag);
      codeItems.push({
        id: `code-${row.code_citation.code_tag}`,
        type: "code",
        label: `${row.code_citation.code_tag}: ${row.code_citation.title}`,
        amount: 0,
        detail: row.code_citation.supplement_argument || row.code_citation.requirement || "",
        codeCitation: row.code_citation,
      });
    }
  }

  const allItems = [...items, ...codeItems];
  const selectedItems = allItems.filter((i) => selected.has(i.id));
  const selectedAmount = selectedItems.filter((i) => i.type !== "code").reduce((s, i) => s + i.amount, 0);

  const toggleItem = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    setSelected(new Set(allItems.map((i) => i.id)));
  };

  const clearAll = () => {
    setSelected(new Set());
  };

  // Generate the supplement email text
  function generateEmail(): string {
    const missingItems = selectedItems.filter((i) => i.type === "missing");
    const underItems = selectedItems.filter((i) => i.type === "under");
    const codeSelections = selectedItems.filter((i) => i.type === "code");

    let email = `Subject: ${claimNumber || "CLAIM NUMBER NEEDED"}\n\n`;
    email += `Dear ${carrierName} Claims Department,\n\n`;
    email += `We are writing regarding the above-referenced property to request a supplement to the current scope of repairs. `;
    email += `After thorough inspection and review of the EagleView certified measurements, we have identified the following discrepancies between the carrier's approved scope and the documented conditions.\n\n`;

    if (missingItems.length > 0) {
      email += `MISSING ITEMS — NOT INCLUDED IN CARRIER SCOPE\n`;
      email += `${"=".repeat(50)}\n\n`;
      for (const item of missingItems) {
        email += `• ${item.label} — $${item.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}\n`;
        email += `  ${item.detail}\n`;
        if (item.codeCitation) {
          email += `  Code Authority: ${item.codeCitation.code_tag} — ${item.codeCitation.title}\n`;
          if (item.codeCitation.has_warranty_void) {
            email += `  WARNING: Manufacturer warranty VOID without this item.\n`;
          }
        }
        email += `\n`;
      }
    }

    if (underItems.length > 0) {
      email += `UNDER-SCOPED ITEMS — QUANTITY/PRICING DISCREPANCIES\n`;
      email += `${"=".repeat(50)}\n\n`;
      for (const item of underItems) {
        email += `• ${item.label} — Underscoped $${item.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}\n`;
        email += `  ${item.detail}\n`;
        if (item.codeCitation) {
          email += `  Code Authority: ${item.codeCitation.code_tag}\n`;
        }
        email += `\n`;
      }
    }

    if (codeSelections.length > 0) {
      email += `APPLICABLE BUILDING CODE REQUIREMENTS\n`;
      email += `${"=".repeat(50)}\n\n`;
      for (const item of codeSelections) {
        email += `${item.label}\n`;
        if (item.detail) {
          email += `  ${item.detail}\n`;
        }
        if (item.codeCitation?.manufacturer_specs?.length) {
          for (const spec of item.codeCitation.manufacturer_specs) {
            email += `  • ${spec.manufacturer}: ${spec.requirement}\n`;
            if (spec.warranty_void) {
              email += `    WARRANTY VOID: ${spec.warranty_text}\n`;
            }
          }
        }
        email += `\n`;
      }
    }

    const totalSupplement = missingItems.reduce((s, i) => s + i.amount, 0) + underItems.reduce((s, i) => s + i.amount, 0);
    email += `SUPPLEMENT SUMMARY\n`;
    email += `${"=".repeat(50)}\n`;
    email += `Total Missing Items: $${missingItems.reduce((s, i) => s + i.amount, 0).toLocaleString()}\n`;
    email += `Total Under-Scoped: $${underItems.reduce((s, i) => s + i.amount, 0).toLocaleString()}\n`;
    email += `Total Supplement Request: $${totalSupplement.toLocaleString()}\n\n`;

    email += `We request that these items be added to the approved scope of repairs. All quantities are derived from EagleView certified measurements and verified against applicable building codes.\n\n`;
    email += `Please contact us at your earliest convenience to discuss.\n\n`;
    email += `Respectfully,\n`;
    email += `${userName || "Your Name"}\n`;
    email += `${companyName || "Company Name"}\n`;
    if (companyPhone) email += `${companyPhone}\n`;

    return email;
  }

  if (allItems.length === 0) return null;

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-6 py-4 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--white)]">Supplement Composer</h2>
          <span className="text-xs text-[var(--gray-dim)]">Select items to include in your supplement email</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={selectAll} className="text-[10px] text-blue-400 hover:text-blue-300 font-medium">Select All</button>
          <span className="text-[var(--gray-dim)]">|</span>
          <button onClick={clearAll} className="text-[10px] text-[var(--gray-muted)] hover:text-[var(--gray)] font-medium">Clear</button>
        </div>
      </div>

      <div className="divide-y divide-white/[0.06] max-h-[500px] overflow-y-auto">
        {/* Missing items */}
        {items.filter((i) => i.type === "missing").length > 0 && (
          <div className="px-6 py-2">
            <p className="text-[10px] uppercase font-bold text-red-600 tracking-wide mb-1">Missing Items</p>
          </div>
        )}
        {items.filter((i) => i.type === "missing").map((item) => (
          <label key={item.id} className={`flex items-start gap-3 px-6 py-3 cursor-pointer hover:bg-white/[0.04] transition-colors ${selected.has(item.id) ? "bg-red-500/10/50" : ""}`}>
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggleItem(item.id)}
              className="mt-0.5 rounded border-[var(--border-glass)] text-red-600 focus:ring-red-500"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--white)]">{item.label}</p>
              <p className="text-[10px] text-[var(--gray-muted)] mt-0.5">{item.detail}</p>
              {item.codeCitation && (
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-green-500/10 text-green-400">
                  {item.codeCitation.code_tag}
                </span>
              )}
            </div>
            <span className="text-xs font-bold text-red-400 shrink-0">${item.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
          </label>
        ))}

        {/* Under items */}
        {items.filter((i) => i.type === "under").length > 0 && (
          <div className="px-6 py-2">
            <p className="text-[10px] uppercase font-bold text-orange-600 tracking-wide mb-1">Under-Scoped Items</p>
          </div>
        )}
        {items.filter((i) => i.type === "under").map((item) => (
          <label key={item.id} className={`flex items-start gap-3 px-6 py-3 cursor-pointer hover:bg-white/[0.04] transition-colors ${selected.has(item.id) ? "bg-orange-500/10/50" : ""}`}>
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggleItem(item.id)}
              className="mt-0.5 rounded border-[var(--border-glass)] text-orange-500 focus:ring-orange-500"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--white)]">{item.label}</p>
              <p className="text-[10px] text-[var(--gray-muted)] mt-0.5">{item.detail}</p>
            </div>
            <span className="text-xs font-bold text-orange-400 shrink-0">+${item.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
          </label>
        ))}

        {/* Code citations */}
        {codeItems.length > 0 && (
          <div className="px-6 py-2">
            <p className="text-[10px] uppercase font-bold text-blue-600 tracking-wide mb-1">Code Citations</p>
          </div>
        )}
        {codeItems.map((item) => (
          <label key={item.id} className={`flex items-start gap-3 px-6 py-3 cursor-pointer hover:bg-white/[0.04] transition-colors ${selected.has(item.id) ? "bg-blue-500/10/50" : ""}`}>
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggleItem(item.id)}
              className="mt-0.5 rounded border-[var(--border-glass)] text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--white)]">{item.label}</p>
              <p className="text-[10px] text-[var(--gray-muted)] mt-0.5 line-clamp-2">{item.detail}</p>
              {item.codeCitation?.has_warranty_void && (
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/10 text-red-400">WARRANTY VOID</span>
              )}
            </div>
          </label>
        ))}
      </div>

      {/* Footer with compose button */}
      <div className="px-6 py-4 bg-white/[0.04] border-t border-[var(--border-glass)] flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--gray)]">
            <span className="font-bold">{selected.size}</span> items selected
            {selectedAmount > 0 && (
              <span className="ml-2 font-bold text-red-400">
                ${selectedAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} supplement value
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowComposer(true)}
          disabled={selected.size === 0}
          className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
        >
          Compose Supplement Email
        </button>
      </div>

      {/* Email Preview Modal */}
      {showComposer && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-[var(--border-glass)] flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--white)]">Supplement Email</h3>
              <button onClick={() => setShowComposer(false)} className="text-[var(--gray-dim)] hover:text-[var(--gray)]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Send to + claim number fields */}
            <div className="px-6 py-3 border-b border-white/[0.04] bg-white/[0.04] grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase font-semibold text-[var(--gray-dim)] tracking-wide">Send To (adjuster email)</label>
                <input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="adjuster@carrier.com"
                  className="w-full mt-1 px-3 py-2 border border-[var(--border-glass)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-semibold text-[var(--gray-dim)] tracking-wide">Claim Number (subject line)</label>
                <input
                  type="text"
                  value={claimNumber}
                  onChange={(e) => setClaimNumber(e.target.value)}
                  placeholder="e.g. 0820085561"
                  className="w-full mt-1 px-3 py-2 border border-[var(--border-glass)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="text-xs text-[var(--gray)] whitespace-pre-wrap font-sans leading-relaxed">{generateEmail()}</pre>
            </div>
            {sendResult && (
              <div className={`px-6 py-2 text-sm ${sendResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                {sendResult.message}
              </div>
            )}
            <div className="px-6 py-4 border-t border-[var(--border-glass)] flex items-center justify-between">
              <button
                onClick={() => { setShowComposer(false); setSendResult(null); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--gray)] hover:bg-white/[0.06] transition-colors"
              >
                Close
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generateEmail());
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border-glass)] text-[var(--gray)] hover:bg-white/[0.04] transition-colors"
                >
                  {copied ? "Copied!" : "Copy to Clipboard"}
                </button>
                <button
                  onClick={async () => {
                    if (!toEmail) { setSendResult({ ok: false, message: "Enter adjuster email address" }); return; }
                    if (!claimNumber) { setSendResult({ ok: false, message: "Enter claim number (used as subject line)" }); return; }
                    setSending(true);
                    setSendResult(null);
                    try {
                      const emailText = generateEmail();
                      // Convert plain text to HTML paragraphs
                      const bodyHtml = emailText
                        .split("\n\n")
                        .map((p: string) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
                        .join("");
                      // Send directly via backend email endpoint (not through Claim Brain chat)
                      const res = await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          claim_id: claimId,
                          user_id: userId || null,
                          to_email: toEmail,
                          subject: claimNumber,
                          body_html: bodyHtml,
                        }),
                      });
                      const data = await res.json();
                      if (res.ok && data.status === "sent") {
                        setSendResult({ ok: true, message: `Supplement email sent to ${toEmail} (${data.method})` });
                      } else {
                        setSendResult({ ok: false, message: data.message || "Failed to send — try Copy to Clipboard instead" });
                      }
                    } catch {
                      setSendResult({ ok: false, message: "Connection error — try Copy to Clipboard instead" });
                    }
                    setSending(false);
                  }}
                  disabled={sending || !toEmail || !claimNumber}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  {sending ? "Sending..." : "Send via Gmail"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
