"use client";

import { useState, useEffect, useCallback } from "react";

interface Template {
  id: string;
  name: string;
  document_type: string;
  description: string | null;
  page_count: number;
  is_system: boolean;
}

const TRADE_OPTIONS = [
  { id: "roofing", label: "Roofing System" },
  { id: "gutters", label: "Gutter / Roof Drainage System" },
  { id: "siding", label: "Siding & Capping" },
  { id: "windows", label: "Windows" },
  { id: "other", label: "Other" },
];

export default function SendDocumentPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Form fields
  const [homeownerName, setHomeownerName] = useState("");
  const [homeownerEmail, setHomeownerEmail] = useState("");
  const [homeownerPhone, setHomeownerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [carrier, setCarrier] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [adjusterInfo, setAdjusterInfo] = useState("");
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [selectedTrades, setSelectedTrades] = useState<string[]>([]);
  const [otherTradeText, setOtherTradeText] = useState("");

  const [sending, setSending] = useState(false);
  const [signLink, setSignLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const data = await res.json();
        const tpls = data.templates || [];
        setTemplates(tpls);
        if (tpls.length === 1) setSelectedTemplateId(tpls[0].id);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const toggleTrade = (tradeId: string) => {
    setSelectedTrades((prev) =>
      prev.includes(tradeId) ? prev.filter((t) => t !== tradeId) : [...prev, tradeId]
    );
  };

  const handleSend = async () => {
    if (!selectedTemplateId || !homeownerName || !homeownerEmail) return;
    setSending(true);
    setError(null);
    setSignLink(null);

    try {
      const senderFields: Record<string, string> = {};
      if (carrier) senderFields.carrier = carrier;
      if (claimNumber) senderFields.claim_number = claimNumber;
      if (adjusterInfo) senderFields.adjuster_info = adjusterInfo;
      if (dateOfLoss) senderFields.date_of_loss = dateOfLoss;
      if (otherTradeText) senderFields.trade_other_text = otherTradeText;

      const res = await fetch("/api/signatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedTemplateId,
          document_type: "aob",
          homeowner_name: homeownerName,
          homeowner_email: homeownerEmail,
          homeowner_phone: homeownerPhone,
          address,
          trades: selectedTrades,
          sender_fields: senderFields,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setSignLink(data.sign_link);
      } else {
        setError(data.error || "Failed to send document");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSending(false);
  };

  const resetForm = () => {
    setHomeownerName("");
    setHomeownerEmail("");
    setHomeownerPhone("");
    setAddress("");
    setCarrier("");
    setClaimNumber("");
    setAdjusterInfo("");
    setDateOfLoss("");
    setSelectedTrades([]);
    setOtherTradeText("");
    setSignLink(null);
    setError(null);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="glass-card p-8 animate-pulse">
          <div className="h-6 w-48 bg-white/5 rounded mb-4" />
          <div className="h-4 w-64 bg-white/5 rounded" />
        </div>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="glass-card p-8 text-center">
          <h1 className="text-xl font-bold text-[var(--white)] mb-2">No Document Templates</h1>
          <p className="text-sm text-[var(--gray-muted)]">
            No document templates are available yet. Ask your admin to upload AOB or contingency templates in Settings.
          </p>
          <a href="/dashboard" className="inline-block mt-4 text-sm text-blue-400 hover:text-blue-300">
            &larr; Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6 sm:py-10 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <a href="/dashboard" className="text-xs text-[var(--gray-muted)] hover:text-[var(--white)] transition-colors">
            &larr; Dashboard
          </a>
          <h1 className="text-2xl font-bold text-[var(--white)] mt-1">Send Document</h1>
          <p className="text-sm text-[var(--gray-muted)]">
            Send an AOB or agreement for digital signature — no claim required
          </p>
        </div>
      </div>

      {signLink ? (
        /* Success state */
        <div className="glass-card p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-[var(--white)]">Document Sent!</h2>
            <p className="text-sm text-[var(--gray-muted)] mt-1">
              Signing link emailed to <span className="text-[var(--white)]">{homeownerEmail}</span>
            </p>
          </div>

          <div className="rounded-xl bg-blue-500/[0.06] border border-blue-500/20 p-4 mb-6">
            <p className="text-xs text-blue-400 font-semibold mb-2">Share this signing link directly:</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={signLink}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-[var(--cyan)] font-mono"
              />
              <button
                onClick={() => navigator.clipboard.writeText(signLink)}
                className="px-3 py-2 bg-white/5 rounded-lg text-xs text-[var(--gray-muted)] hover:text-[var(--white)] shrink-0"
              >
                Copy
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={resetForm}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold hover:shadow-lg transition-all"
            >
              Send Another
            </button>
            <a
              href="/dashboard"
              className="flex-1 py-3 rounded-xl border border-white/10 text-center text-[var(--white)] text-sm font-semibold hover:bg-white/[0.06] transition-all"
            >
              Back to Dashboard
            </a>
          </div>
        </div>
      ) : (
        /* Form */
        <div className="space-y-6">
          {/* Template selector */}
          {templates.length > 1 && (
            <div className="glass-card p-6">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)] block mb-3">
                Select Template
              </label>
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => setSelectedTemplateId(tpl.id)}
                    className={`w-full p-3 rounded-xl border text-left transition-colors ${
                      selectedTemplateId === tpl.id
                        ? "border-blue-500/30 bg-blue-500/[0.06]"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                  >
                    <p className={`text-sm font-semibold ${selectedTemplateId === tpl.id ? "text-blue-400" : "text-[var(--white)]"}`}>
                      {tpl.name}
                    </p>
                    {tpl.description && <p className="text-[10px] text-[var(--gray-dim)]">{tpl.description}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Homeowner info */}
          <div className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-3">
              Homeowner Information
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  placeholder="Full name *"
                  value={homeownerName}
                  onChange={(e) => setHomeownerName(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
                <input
                  placeholder="Email *"
                  type="email"
                  value={homeownerEmail}
                  onChange={(e) => setHomeownerEmail(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  placeholder="Phone"
                  value={homeownerPhone}
                  onChange={(e) => setHomeownerPhone(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
                <input
                  placeholder="Property address *"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
              </div>
            </div>
          </div>

          {/* Insurance info (optional) */}
          <div className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-1">
              Insurance Information
            </p>
            <p className="text-[10px] text-[var(--gray-dim)] mb-3">Optional — fill in if available</p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  placeholder="Insurance carrier"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
                <input
                  placeholder="Claim number"
                  value={claimNumber}
                  onChange={(e) => setClaimNumber(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  placeholder="Adjuster name / info"
                  value={adjusterInfo}
                  onChange={(e) => setAdjusterInfo(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
                <input
                  placeholder="Date of loss"
                  value={dateOfLoss}
                  onChange={(e) => setDateOfLoss(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
              </div>
            </div>
          </div>

          {/* Trade selection */}
          <div className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-3">
              Select Trades
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TRADE_OPTIONS.map((trade) => (
                <button
                  key={trade.id}
                  onClick={() => toggleTrade(trade.id)}
                  className={`p-3 rounded-xl border text-left text-sm transition-colors ${
                    selectedTrades.includes(trade.id)
                      ? "border-blue-500/30 bg-blue-500/[0.06] text-blue-400 font-semibold"
                      : "border-white/10 bg-white/[0.03] text-[var(--gray-muted)] hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="mr-2">{selectedTrades.includes(trade.id) ? "\u2611" : "\u2610"}</span>
                  {trade.label}
                </button>
              ))}
            </div>
            {selectedTrades.includes("other") && (
              <input
                placeholder="Describe other trade..."
                value={otherTradeText}
                onChange={(e) => setOtherTradeText(e.target.value)}
                className="mt-3 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
              />
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-red-500/[0.06] border border-red-500/20 p-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!selectedTemplateId || !homeownerName || !homeownerEmail || sending}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? "Generating & Sending..." : "Send AOB for Signature"}
          </button>
        </div>
      )}
    </div>
  );
}
