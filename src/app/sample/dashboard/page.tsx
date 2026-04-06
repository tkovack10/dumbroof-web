"use client";

import { useState, useMemo } from "react";
import { SampleClaimBrainChat } from "@/components/sample-claim-brain-chat";
import {
  SAMPLE_CLAIM_META,
  SAMPLE_COMPARISON_ROWS,
  SAMPLE_FINANCIALS,
  SAMPLE_SUMMARY,
} from "@/lib/sample-claim-data";
import type { ScopeComparisonRow } from "@/types/scope-comparison";

/**
 * /sample/dashboard — public, unauthenticated interactive demo.
 *
 * Shows a hardcoded 14-square hail claim against Allstate and lets visitors
 * click through:
 *   - Scope Comparison (4 tabs: Roofing / Siding / Missing / Financial)
 *   - Supplement Composer (select items → compose email → see final draft)
 *   - Richard Chat (real Claude Sonnet 4.6 streaming, 5 msgs/IP/hr)
 *
 * The goal: let warm Meta retargeting traffic experience the product's
 * "wow" moments before being asked to sign up. Today's cost-per-trial
 * from retargeting is $118.61 — this page should cut that dramatically.
 *
 * Anchor: USARM-Claims-Platform funnel investigation 2026-04-06 and
 * Tom's "CAN WE DO A SAMPLE DASHBOARD" directive.
 */

type Tab = "compare" | "supplement" | "richard";

const fmtMoney = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_STYLES: Record<string, { chip: string; row: string; label: string }> = {
  missing: {
    chip: "bg-red-600 text-white",
    row: "bg-red-500/[0.08] border-red-500/20",
    label: "MISSING",
  },
  under: {
    chip: "bg-orange-500 text-white",
    row: "bg-amber-500/[0.08] border-amber-500/20",
    label: "UNDER",
  },
  match: {
    chip: "bg-green-600 text-white",
    row: "bg-green-500/[0.05] border-green-500/20",
    label: "MATCH",
  },
};

export default function SampleDashboardPage() {
  // Default tab = supplement composer (Tom's directive 2026-04-06).
  // The composer is the highest-engagement interaction — checkboxes,
  // running total, generated email modal — so demo users land there first.
  const [tab, setTab] = useState<Tab>("supplement");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const supplementItems = useMemo(
    () => SAMPLE_COMPARISON_ROWS.filter((r) => r.status === "missing" || r.status === "under"),
    []
  );

  const selectedRows = useMemo(
    () => supplementItems.filter((r) => selectedItems.has(r.checklist_desc)),
    [supplementItems, selectedItems]
  );

  const selectedTotal = useMemo(() => {
    let total = 0;
    for (const row of selectedRows) {
      const delta = row.usarm_amount - row.carrier_amount;
      total += delta > 0 ? delta : row.usarm_amount;
    }
    return total;
  }, [selectedRows]);

  const toggleItem = (key: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /**
   * Compose the supplement email exactly the way the real product does it,
   * using Tom's email rules (subject = claim number, "underscoped" not
   * "underpaid", no advocacy language). The output is shown in the modal
   * so demo users can see what the real product generates without us
   * actually firing an email.
   */
  const composedEmail = useMemo(() => {
    if (selectedRows.length === 0) return null;
    const body: string[] = [];
    body.push(`Re: Claim #${SAMPLE_CLAIM_META.claim_number}`);
    body.push(`Insured property: ${SAMPLE_CLAIM_META.address}`);
    body.push(`Date of loss: ${SAMPLE_CLAIM_META.date_of_loss}`);
    body.push("");
    body.push("Our forensic review of the carrier scope identified the following code-required items that are currently underscoped or missing. We are submitting these for inclusion in the supplement.");
    body.push("");

    selectedRows.forEach((row, i) => {
      const delta = row.usarm_amount - row.carrier_amount;
      const amount = delta > 0 ? delta : row.usarm_amount;
      body.push(`${i + 1}. ${row.checklist_desc}`);
      if (row.carrier_amount > 0) {
        body.push(`   Carrier scoped: ${row.carrier_qty} ${row.carrier_unit} @ ${fmtMoney(row.carrier_unit_price)}/${row.carrier_unit} = ${fmtMoney(row.carrier_amount)}`);
        body.push(`   Code-compliant: ${row.ev_qty} ${row.ev_unit} @ ${fmtMoney(row.xact_unit_price)}/${row.ev_unit} = ${fmtMoney(row.usarm_amount)}`);
      } else {
        body.push(`   Carrier scoped: not included`);
        body.push(`   Code-compliant: ${row.ev_qty} ${row.ev_unit} @ ${fmtMoney(row.xact_unit_price)}/${row.ev_unit} = ${fmtMoney(row.usarm_amount)}`);
      }
      body.push(`   Supplement requested: ${fmtMoney(amount)}`);

      if (row.code_citation) {
        body.push(`   Code basis: ${row.code_citation.code_tag} ${row.code_citation.section} — ${row.code_citation.title}`);
        body.push(`   ${row.code_citation.supplement_argument}`);
        if (row.code_citation.has_warranty_void && row.code_citation.manufacturer_specs[0]) {
          body.push(`   Manufacturer note: ${row.code_citation.manufacturer_specs[0].warranty_text}`);
        }
      } else if (row.note) {
        body.push(`   ${row.note}`);
      }
      body.push("");
    });

    body.push(`Total supplement requested: ${fmtMoney(selectedTotal)}`);
    body.push("");
    body.push("All line items above are required for code-compliant installation per RCNYS 2020 (Binghamton, NY jurisdiction) and applicable manufacturer specifications. Photo evidence and full forensic causation report are attached.");
    body.push("");
    body.push("Please confirm receipt and a target date for review. We are available for a re-inspection if requested.");
    body.push("");
    body.push("Regards,");
    body.push("[Contractor Name]");
    body.push("[Company Name]");

    return {
      subject: SAMPLE_CLAIM_META.claim_number, // Tom's rule: subject = claim number ONLY
      to: "[adjuster email]",
      cc: "[your company admin]",
      bcc: "claims@dumbroof.ai",
      body: body.join("\n"),
    };
  }, [selectedRows, selectedTotal]);

  const copyToClipboard = async () => {
    if (!composedEmail) return;
    const fullText = `To: ${composedEmail.to}\nCC: ${composedEmail.cc}\nBCC: ${composedEmail.bcc}\nSubject: ${composedEmail.subject}\n\n${composedEmail.body}`;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // navigator.clipboard not available — silently no-op
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)] text-white">
      {/* Demo banner — Tom's exact copy 2026-04-06 */}
      <div className="bg-gradient-to-r from-[var(--pink)]/20 via-[var(--purple)]/20 to-[var(--blue)]/20 border-b border-white/[0.1] px-4 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start gap-3">
            <span className="shrink-0 inline-block px-2 py-0.5 rounded bg-[var(--pink)]/20 border border-[var(--pink)]/40 text-[10px] font-bold tracking-wider text-[var(--pink)] mt-0.5">
              SNEAK PEEK
            </span>
            <p className="text-xs sm:text-sm text-[var(--gray-dim)] leading-relaxed">
              <strong className="text-white">This contractor successfully supplemented their claim from $37K to $80K using dumbroof.ai.</strong>{" "}
              We&apos;re giving you a sneak peek under the hood to showcase what dumbroof.ai offers.{" "}
              <a href="/?from=demo" className="text-[var(--cyan)] hover:text-white font-semibold whitespace-nowrap">
                Ready to do yours? →
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
        {/* Claim header card with the $43K WIN front and center */}
        <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-5 sm:p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold tracking-wider text-green-400 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded">
                  WON
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                  Roof + Siding · Hail/Wind
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">
                {SAMPLE_CLAIM_META.address}
              </h1>
              <p className="text-sm text-[var(--gray-dim)] mt-1">
                {SAMPLE_CLAIM_META.carrier} · {SAMPLE_CLAIM_META.squares} squares of {SAMPLE_CLAIM_META.roof_material} · {SAMPLE_CLAIM_META.siding_sf.toLocaleString()} SF siding
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] uppercase tracking-wider text-[var(--gray-muted)] mb-1">
                Recovered with dumbroof.ai
              </div>
              <div className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] bg-clip-text text-transparent">
                +{fmtMoney(SAMPLE_FINANCIALS.variance)}
              </div>
              <div className="text-[11px] text-green-400 font-semibold">+115% over first scope</div>
            </div>
          </div>

          {/* Financial summary strip — first scope → won scope progression */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4 border-t border-white/[0.06]">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[var(--gray-muted)]">
                Carrier first scope
              </div>
              <div className="text-base sm:text-lg font-bold text-white line-through opacity-60">
                {fmtMoney(SAMPLE_FINANCIALS.carrier_rcv)}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[var(--gray-muted)]">
                Final settlement
              </div>
              <div className="text-base sm:text-lg font-bold text-green-400">
                {fmtMoney(SAMPLE_FINANCIALS.contractor_rcv)}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="text-[9px] uppercase tracking-wider text-[var(--gray-muted)]">
                Code arguments identified
              </div>
              <div className="text-base sm:text-lg font-bold text-[var(--cyan)]">
                {SAMPLE_COMPARISON_ROWS.filter((r) => r.code_citation || r.irc_code).length} citations
              </div>
            </div>
          </div>
        </div>

        {/* Tabs — supplement first (highest-engagement interaction), then
            scope comparison, then Richard. Order locked by Tom 2026-04-06. */}
        <div className="flex gap-1 p-1 bg-white/[0.04] border border-white/[0.1] rounded-xl mb-5">
          {[
            { id: "supplement" as Tab, label: "Supplement", count: selectedItems.size || null },
            { id: "compare" as Tab, label: "Scope Comparison", count: SAMPLE_SUMMARY.missing_count + SAMPLE_SUMMARY.under_count },
            { id: "richard" as Tab, label: "Ask Richard" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-xs sm:text-sm font-semibold py-2.5 px-3 rounded-lg transition-colors ${
                tab === t.id
                  ? "bg-white/[0.1] text-white"
                  : "text-[var(--gray-muted)] hover:text-white"
              }`}
            >
              {t.label}
              {t.count != null && (
                <span
                  className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${
                    tab === t.id
                      ? "bg-[var(--pink)]/30 text-[var(--pink)]"
                      : "bg-white/[0.08] text-[var(--gray-muted)]"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ──────── Scope Comparison tab ──────── */}
        {tab === "compare" && (
          <div className="space-y-3">
            <div className="text-xs text-[var(--gray-muted)] mb-3">
              dumbroof.ai compared {SAMPLE_SUMMARY.total_items} line items between the carrier scope
              and what the roof actually needs. Here&apos;s what we found:
            </div>
            {SAMPLE_COMPARISON_ROWS.map((row) => (
              <ComparisonRow key={row.checklist_desc} row={row} />
            ))}
          </div>
        )}

        {/* ──────── Supplement Composer tab ──────── */}
        {tab === "supplement" && (
          <div>
            <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-5 mb-4">
              <p className="text-sm text-[var(--gray-dim)] mb-4">
                Pick the items you want to supplement. As you select, watch the total climb and
                preview the email we&apos;ll draft for you to send to the adjuster.
              </p>
              <div className="space-y-2">
                {supplementItems.map((row) => {
                  const delta = row.usarm_amount - row.carrier_amount;
                  const amount = delta > 0 ? delta : row.usarm_amount;
                  const selected = selectedItems.has(row.checklist_desc);
                  return (
                    <button
                      key={row.checklist_desc}
                      onClick={() => toggleItem(row.checklist_desc)}
                      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        selected
                          ? "bg-[var(--pink)]/10 border-[var(--pink)]/40"
                          : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]"
                      }`}
                    >
                      <div
                        className={`shrink-0 w-5 h-5 rounded border-2 mt-0.5 flex items-center justify-center ${
                          selected
                            ? "bg-[var(--pink)] border-[var(--pink)]"
                            : "border-white/30"
                        }`}
                      >
                        {selected && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-semibold text-white block">
                              {row.checklist_desc}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                              {row.trade}
                            </span>
                          </div>
                          <span className="text-base font-bold text-green-400 whitespace-nowrap shrink-0">
                            +{fmtMoney(amount)}
                          </span>
                        </div>

                        {row.note && (
                          <div className="text-[11px] text-[var(--gray-muted)] mt-1 leading-relaxed">
                            {row.note}
                          </div>
                        )}

                        {/* Code citation chip on every item where one exists */}
                        {row.code_citation && (
                          <div className="mt-2 bg-[var(--cyan)]/[0.06] border border-[var(--cyan)]/20 rounded p-2">
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              <span className="text-[9px] font-mono font-bold bg-[var(--cyan)]/15 text-[var(--cyan)] px-1.5 py-0.5 rounded">
                                {row.code_citation.code_tag} {row.code_citation.section}
                              </span>
                              <span className="text-[9px] text-[var(--gray-muted)]">
                                {row.code_citation.title}
                              </span>
                              {row.code_citation.has_warranty_void && (
                                <span className="text-[9px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">
                                  WARRANTY VOID
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-[var(--gray-dim)] leading-snug">
                              {row.code_citation.supplement_argument}
                            </p>
                          </div>
                        )}

                        {!row.code_citation && row.irc_code && (
                          <div className="inline-block mt-1.5 text-[9px] font-mono bg-white/[0.06] border border-white/[0.1] rounded px-1.5 py-0.5 text-[var(--cyan)]">
                            {row.irc_code}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-4 mt-4 border-t border-white/[0.08]">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                    Supplement Total
                  </div>
                  <div className="text-2xl font-bold text-white">+{fmtMoney(selectedTotal)}</div>
                </div>
                <button
                  disabled={selectedItems.size === 0}
                  onClick={() => setEmailModalOpen(true)}
                  className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white px-5 py-3 rounded-xl text-sm font-semibold disabled:opacity-40"
                >
                  Compose Email →
                </button>
              </div>
            </div>

            <p className="text-xs text-center text-[var(--gray-muted)]">
              In the real app, the composed email includes line items, code citations, and photo evidence — ready to send to the adjuster.
            </p>
          </div>
        )}

        {/* ──────── Richard Chat tab ──────── */}
        {tab === "richard" && (
          <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl overflow-hidden">
            <SampleClaimBrainChat />
          </div>
        )}

        {/* Email modal — shows the actual drafted supplement email */}
        {emailModalOpen && composedEmail && (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setEmailModalOpen(false)}
          >
            <div
              className="w-full sm:max-w-2xl bg-[rgb(15,18,35)] border border-white/[0.1] rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--pink)] mb-0.5">
                    Supplement Email — Generated by dumbroof.ai
                  </div>
                  <p className="text-sm font-semibold text-white truncate">
                    {selectedRows.length} item{selectedRows.length === 1 ? "" : "s"} · {fmtMoney(selectedTotal)}
                  </p>
                </div>
                <button
                  onClick={() => setEmailModalOpen(false)}
                  className="shrink-0 w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/60 hover:text-white"
                  aria-label="Close"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal scrollable body — render the email like Gmail compose */}
              <div className="flex-1 overflow-y-auto">
                {/* Email headers */}
                <div className="px-5 py-3 border-b border-white/[0.05] space-y-1.5 text-xs">
                  <div className="flex gap-3">
                    <span className="text-[var(--gray-muted)] w-12 shrink-0">To</span>
                    <span className="text-white font-mono">{composedEmail.to}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-[var(--gray-muted)] w-12 shrink-0">Cc</span>
                    <span className="text-white font-mono">{composedEmail.cc}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-[var(--gray-muted)] w-12 shrink-0">Bcc</span>
                    <span className="text-white font-mono">{composedEmail.bcc}</span>
                  </div>
                  <div className="flex gap-3 pt-1 border-t border-white/[0.05]">
                    <span className="text-[var(--gray-muted)] w-12 shrink-0">Subject</span>
                    <span className="text-white font-mono font-semibold">{composedEmail.subject}</span>
                  </div>
                </div>

                {/* Email body — preserve line breaks, monospace for the data tables */}
                <div className="px-5 py-4">
                  <pre className="text-[12px] text-[var(--gray-dim)] font-mono whitespace-pre-wrap leading-relaxed">
{composedEmail.body}
                  </pre>
                </div>

                {/* Annotations + attachments */}
                <div className="mx-5 mb-5 bg-[var(--cyan)]/[0.06] border border-[var(--cyan)]/20 rounded-lg p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--cyan)] mb-1.5">
                    Attached automatically
                  </div>
                  <ul className="text-[11px] text-[var(--gray-dim)] space-y-1">
                    <li>📄 forensic-causation-report.pdf (47 annotated photos)</li>
                    <li>📊 xactimate-style-estimate.pdf ({fmtMoney(SAMPLE_FINANCIALS.contractor_rcv)} RCV)</li>
                    <li>📋 scope-comparison-report.pdf</li>
                    <li>📑 scope-clarification-letter.pdf</li>
                  </ul>
                </div>
              </div>

              {/* Modal footer with actions */}
              <div className="px-5 py-4 border-t border-white/[0.08] bg-[rgba(6,9,24,0.5)]">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                  <p className="text-[10px] text-[var(--gray-muted)] leading-relaxed">
                    <strong className="text-amber-300">Demo mode:</strong> in production, dumbroof.ai sends this directly via your connected Gmail.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={copyToClipboard}
                      className="bg-white/[0.08] hover:bg-white/[0.12] text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
                    >
                      {copied ? (
                        <>
                          <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Copied
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy email
                        </>
                      )}
                    </button>
                    <a
                      href="/?from=demo"
                      className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white text-xs font-semibold px-4 py-2 rounded-lg"
                    >
                      Send for real →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bottom CTA */}
        <div className="mt-8 bg-gradient-to-br from-[var(--pink)]/10 via-[var(--purple)]/10 to-[var(--blue)]/10 border border-[var(--pink)]/30 rounded-2xl p-6 sm:p-8 text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
            Ready to do this with your own claim?
          </h2>
          <p className="text-sm text-[var(--gray-dim)] mb-5 max-w-lg mx-auto">
            3 free claims. No credit card. Upload your inspection photos — we&apos;ll do the rest.
          </p>
          <a
            href="/?from=demo"
            className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-4 rounded-xl font-semibold text-base transition-all shadow-lg"
          >
            Start Free →
          </a>
          <p className="text-[11px] text-[var(--gray-muted)] mt-4">
            Built for roofing sales reps, contractors, and company owners.
          </p>
        </div>
      </div>
    </main>
  );
}

function ComparisonRow({ row }: { row: ScopeComparisonRow }) {
  const style = STATUS_STYLES[row.status] || STATUS_STYLES.match;
  const delta =
    row.status === "missing"
      ? row.usarm_amount
      : row.status === "under"
      ? row.usarm_amount - row.carrier_amount
      : 0;

  return (
    <div className={`rounded-xl border p-4 ${style.row}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider ${style.chip}`}>
              {style.label}
            </span>
            {row.trade && (
              <span className="text-[9px] uppercase tracking-wider text-[var(--gray-muted)]">
                {row.trade}
              </span>
            )}
            {row.code_citation?.has_warranty_void && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
                WARRANTY VOID
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-white">{row.checklist_desc}</p>
        </div>
        {delta > 0 && (
          <div className="text-right shrink-0">
            <div className="text-sm font-bold text-green-400">+{fmtMoney(delta)}</div>
            <div className="text-[10px] text-[var(--gray-muted)]">supplement</div>
          </div>
        )}
      </div>

      {row.note && <p className="text-xs text-[var(--gray-dim)] mb-3">{row.note}</p>}

      {/* Side-by-side quantity + pricing */}
      <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
        <div className="bg-white/[0.03] rounded px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-[var(--gray-muted)]">
            Carrier
          </div>
          {row.carrier_amount > 0 ? (
            <div className="text-white font-mono">
              {row.carrier_qty} {row.carrier_unit} × {fmtMoney(row.carrier_unit_price)} ={" "}
              {fmtMoney(row.carrier_amount)}
            </div>
          ) : (
            <div className="text-red-400 font-mono">— not included —</div>
          )}
        </div>
        <div className="bg-white/[0.03] rounded px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-[var(--gray-muted)]">
            Code-compliant
          </div>
          <div className="text-white font-mono">
            {row.ev_qty} {row.ev_unit} × {fmtMoney(row.xact_unit_price)} ={" "}
            {fmtMoney(row.usarm_amount)}
          </div>
        </div>
      </div>

      {/* Code citation block — the KEY product feature */}
      {row.code_citation && (
        <div className="bg-gradient-to-br from-[var(--cyan)]/[0.06] to-[var(--blue)]/[0.06] border border-[var(--cyan)]/20 rounded-lg p-3 mt-2">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-3.5 h-3.5 text-[var(--cyan)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--cyan)]">
              {row.code_citation.code_tag} {row.code_citation.section}
            </span>
            <span className="text-[10px] text-[var(--gray-muted)]">
              · {row.code_citation.title}
            </span>
          </div>
          <p className="text-[11px] text-[var(--gray-dim)] leading-relaxed mb-2 italic">
            &ldquo;{row.code_citation.requirement}&rdquo;
          </p>
          <div className="text-[11px] text-white leading-relaxed border-t border-white/[0.06] pt-2">
            <strong className="text-[var(--cyan)]">Argument:</strong>{" "}
            {row.code_citation.supplement_argument}
          </div>
          {row.code_citation.manufacturer_specs.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/[0.06]">
              {row.code_citation.manufacturer_specs.map((spec, i) => (
                <div key={i} className="text-[10px] text-[var(--gray-muted)]">
                  <span className="text-amber-300 font-semibold">{spec.manufacturer}</span> · {spec.document}: {spec.warranty_text || spec.requirement}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lite citation chip when there's only an irc_code without full citation */}
      {!row.code_citation && row.irc_code && (
        <div className="flex items-center gap-2 text-[10px] mt-2">
          <span className="font-mono bg-[var(--cyan)]/10 border border-[var(--cyan)]/30 rounded px-1.5 py-0.5 text-[var(--cyan)]">
            {row.irc_code}
          </span>
          {row.carrier_trick && (
            <span className="text-[var(--gray-muted)]">· {row.carrier_trick.replace(/_/g, " ")}</span>
          )}
        </div>
      )}
    </div>
  );
}
