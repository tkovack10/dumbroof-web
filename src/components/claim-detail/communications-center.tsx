"use client";

import { useEffect, useState } from "react";
import type { Correspondence, EditRequest, EmailDraft } from "@/types/claim-comms";

interface AttachmentSig {
  path: string;
  signed_url: string;
  filename: string;
}

interface CommunicationsCenterProps {
  editRequests: EditRequest[];
  correspondence: Correspondence[];
  drafts: EmailDraft[];
  applyingEditId: string | null;
  sendingDraftId: string | null;
  regeneratingDraftId: string | null;
  onApplyEditRequest: (id: string) => void | Promise<void>;
  onRejectEditRequest: (id: string) => void | Promise<void>;
  onTriggerAnalysis: (correspondenceId: string) => void | Promise<void>;
  onApproveSend: (draft: EmailDraft) => void | Promise<void>;
  onRegenerateDraft: (id: string, strategy?: string) => void | Promise<void>;
  onRejectDraft: (id: string) => void | Promise<void>;
  onSaveDraftEdits: (id: string, editedHtml: string) => void | Promise<void>;
}

const STANCE_CONFIGS: Record<string, { bg: string; text: string; label: string }> = {
  full_denial: { bg: "bg-red-100", text: "text-red-700", label: "Full Denial" },
  partial_denial: { bg: "bg-orange-100", text: "text-orange-700", label: "Partial Denial" },
  underpayment: { bg: "bg-amber-100", text: "text-amber-700", label: "Underpayment" },
  request_for_info: { bg: "bg-blue-100", text: "text-blue-700", label: "Info Request" },
  reinspection_offer: { bg: "bg-purple-100", text: "text-purple-700", label: "Reinspection" },
  acceptance: { bg: "bg-green-100", text: "text-green-700", label: "Acceptance" },
};

function stanceBadge(stance: string) {
  const c = STANCE_CONFIGS[stance] || { bg: "bg-white/[0.06]", text: "text-[var(--gray)]", label: stance || "Pending" };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
}

export function CommunicationsCenter(props: CommunicationsCenterProps) {
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [editedHtml, setEditedHtml] = useState<string>("");
  // Cache of signed URLs per correspondence_id. Fetched lazily on expansion —
  // signed URLs have a 1h TTL so we don't pre-fetch for every row.
  const [attachmentsByCorrId, setAttachmentsByCorrId] = useState<Record<string, AttachmentSig[]>>({});

  // When the user expands a row that has attachments but we don't have signed
  // URLs cached yet, fetch them via /api/correspondence/attachments.
  useEffect(() => {
    if (!expandedEmail) return;
    if (attachmentsByCorrId[expandedEmail] !== undefined) return; // already fetched (even if empty)
    const email = props.correspondence.find((e) => e.id === expandedEmail);
    if (!email || !email.attachment_paths || email.attachment_paths.length === 0) {
      setAttachmentsByCorrId((prev) => ({ ...prev, [expandedEmail]: [] }));
      return;
    }
    let cancelled = false;
    fetch("/api/correspondence/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correspondence_id: expandedEmail }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data) => {
        if (cancelled) return;
        setAttachmentsByCorrId((prev) => ({ ...prev, [expandedEmail]: data.attachments || [] }));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to fetch correspondence attachments:", err);
        setAttachmentsByCorrId((prev) => ({ ...prev, [expandedEmail]: [] }));
      });
    return () => { cancelled = true; };
  }, [expandedEmail, attachmentsByCorrId, props.correspondence]);

  const pendingEdits = props.editRequests.filter((r) => r.status === "pending");
  const pendingDrafts = props.drafts.filter((d) => d.status === "draft" || d.status === "edited");

  return (
    <div className="space-y-4">
      {pendingEdits.length > 0 && (
        <div className="bg-[var(--bg-glass)] rounded-2xl border-2 border-amber-300 p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-amber-500/100 animate-pulse" />
            <h2 className="text-sm font-semibold text-[var(--white)]">Edit Requests</h2>
            <span className="ml-auto text-xs text-amber-600 font-medium">
              {pendingEdits.length} pending
            </span>
          </div>
          <div className="space-y-3">
            {pendingEdits.map((req) => {
              const summary =
                typeof req.ai_summary === "string"
                  ? JSON.parse(req.ai_summary)
                  : req.ai_summary;
              const isApplying = props.applyingEditId === req.id;

              return (
                <div
                  key={req.id}
                  className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-[var(--white)]">
                        {req.original_subject || "Edit Request"}
                      </p>
                      <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                        From {req.from_email} &middot;{" "}
                        {new Date(req.created_at).toLocaleDateString()}{" "}
                        {new Date(req.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      {req.request_type.replace(/_/g, " ")}
                    </span>
                  </div>

                  {summary && summary.changes && summary.changes.length > 0 && (
                    <div className="bg-[var(--bg-glass)] border border-amber-100 rounded-lg p-3 mb-3">
                      <p className="text-xs font-semibold text-[var(--gray-muted)] mb-1.5">
                        AI-Parsed Changes
                        {summary.confidence && (
                          <span className="ml-2 text-[var(--gray-dim)] font-normal">
                            ({summary.confidence}% confidence)
                          </span>
                        )}
                      </p>
                      <ul className="space-y-1">
                        {summary.changes.map(
                          (
                            change: { action: string; item: string; details: string },
                            i: number,
                          ) => (
                            <li
                              key={i}
                              className="text-xs text-[var(--gray)] flex items-start gap-1.5"
                            >
                              <span
                                className={`mt-0.5 font-semibold ${
                                  change.action === "add"
                                    ? "text-green-600"
                                    : change.action === "remove"
                                      ? "text-red-600"
                                      : "text-blue-600"
                                }`}
                              >
                                {change.action.toUpperCase()}
                              </span>
                              <span>
                                <strong>{change.item}</strong>
                                {change.details && ` — ${change.details}`}
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  )}

                  {req.original_body && (
                    <div className="text-xs text-[var(--gray)] bg-white/[0.04] rounded-lg p-2 mb-3 max-h-20 overflow-y-auto whitespace-pre-wrap">
                      {req.original_body.slice(0, 300)}
                      {req.original_body.length > 300 && "..."}
                    </div>
                  )}

                  {req.attachment_paths && req.attachment_paths.length > 0 && (
                    <p className="text-xs text-[var(--gray-muted)] mb-3">
                      {req.attachment_paths.length} attachment
                      {req.attachment_paths.length !== 1 ? "s" : ""} included
                    </p>
                  )}

                  <div className="flex items-center gap-3 pt-2 border-t border-amber-100">
                    <button
                      onClick={() => props.onApplyEditRequest(req.id)}
                      disabled={isApplying}
                      className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2"
                    >
                      {isApplying ? (
                        <>
                          <svg
                            className="animate-spin w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                          Applying...
                        </>
                      ) : (
                        "Approve & Apply"
                      )}
                    </button>
                    <button
                      onClick={() => props.onRejectEditRequest(req.id)}
                      className="text-[var(--gray-dim)] hover:text-red-500 text-xs transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {props.correspondence.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="text-sm font-semibold text-[var(--white)] mb-4">Carrier Correspondence</h2>
          <div className="space-y-3">
            {props.correspondence.map((email) => {
              const isExpanded = expandedEmail === email.id;
              const position =
                typeof email.carrier_position === "string"
                  ? JSON.parse(email.carrier_position)
                  : email.carrier_position;

              return (
                <div key={email.id} className="border border-white/[0.04] rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-[var(--gray-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--white)] truncate">
                          {email.original_subject || "No subject"}
                        </p>
                        <p className="text-xs text-[var(--gray-dim)]">
                          {email.carrier_name || email.original_from} &middot;{" "}
                          {email.original_date
                            ? new Date(email.original_date).toLocaleDateString()
                            : new Date(email.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {position && stanceBadge(position.stance)}
                      {email.analysis_status === "analyzing" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Analyzing
                        </span>
                      )}
                      <svg className={`w-4 h-4 text-[var(--gray-dim)] transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-white/[0.04]">
                      {position && (
                        <div className="mt-3 bg-white/[0.04] rounded-lg p-3">
                          <p className="text-xs font-semibold text-[var(--gray-muted)] uppercase mb-1">AI Analysis</p>
                          <p className="text-sm text-[var(--gray)] mb-2">{position.summary}</p>
                          {position.weaknesses && position.weaknesses.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-[var(--gray-muted)] mt-2 mb-1">Identified Weaknesses:</p>
                              <ul className="space-y-1">
                                {position.weaknesses.map((w: { weakness: string }, i: number) => (
                                  <li key={i} className="text-xs text-[var(--gray)] flex items-start gap-1.5">
                                    <span className="text-red-500 mt-0.5">&#8226;</span>
                                    {w.weakness}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-[var(--gray-muted)]">
                            <span>Tone: {position.tone}</span>
                            <span>Urgency: {position.urgency}</span>
                          </div>
                        </div>
                      )}

                      <div className="mt-3 bg-[var(--bg-glass)] border border-white/[0.04] rounded-lg p-3">
                        <p className="text-xs font-semibold text-[var(--gray-dim)] mb-2">Original Email</p>
                        <div className="text-sm text-[var(--gray)] whitespace-pre-wrap max-h-64 overflow-y-auto">
                          {email.text_body}
                        </div>
                      </div>

                      {/* Attachments — populated by per-user Gmail poller. Each chip is
                          a 1h-signed download link. To use one as a new carrier scope,
                          download it and upload via the highlights-panel Upload button
                          (existing v1 flow). */}
                      {email.attachment_paths && email.attachment_paths.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-[var(--gray-dim)] mb-2">
                            Attachments ({email.attachment_paths.length})
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {(attachmentsByCorrId[email.id] ?? null) === null ? (
                              <span className="text-xs text-[var(--gray-dim)] italic">Loading…</span>
                            ) : (
                              (attachmentsByCorrId[email.id] || []).map((att) => (
                                <a
                                  key={att.path}
                                  href={att.signed_url}
                                  download={att.filename}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.06] border border-white/[0.1] text-[var(--gray)] hover:text-white hover:bg-white/[0.1] transition-colors max-w-[280px]"
                                  title={att.filename}
                                >
                                  <span aria-hidden="true">📎</span>
                                  <span className="truncate">{att.filename}</span>
                                </a>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {email.analysis_status === "pending" && email.status === "matched" && (
                        <button
                          onClick={() => props.onTriggerAnalysis(email.id)}
                          className="mt-3 bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                        >
                          Analyze & Draft Response
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingDrafts.map((draft) => {
        const photos =
          typeof draft.selected_photos === "string"
            ? JSON.parse(draft.selected_photos)
            : draft.selected_photos || [];
        const weaknesses =
          typeof draft.carrier_weaknesses === "string"
            ? JSON.parse(draft.carrier_weaknesses)
            : draft.carrier_weaknesses || [];
        const isEditing = editingDraft === draft.id;
        const isSending = props.sendingDraftId === draft.id;
        const isRegenerating = props.regeneratingDraftId === draft.id;

        return (
          <div key={draft.id} className="bg-[var(--bg-glass)] rounded-2xl border-2 border-red-500/30 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500/100 animate-pulse" />
                <h2 className="text-sm font-semibold text-[var(--white)]">Draft Response Pending Review</h2>
              </div>
              <span className="text-xs text-[var(--gray-dim)]">
                Strategy: {draft.response_strategy} &middot; {draft.compliance_role} mode
              </span>
            </div>

            {weaknesses.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-100 rounded-lg p-3 mb-4">
                <p className="text-xs font-semibold text-amber-800 mb-1">AI Strategy Notes</p>
                <ul className="space-y-1">
                  {weaknesses.map((w: { weakness: string; suggested_question: string }, i: number) => (
                    <li key={i} className="text-xs text-amber-700">
                      <strong>{w.weakness}:</strong> {w.suggested_question}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {photos.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-[var(--gray-muted)] mb-2">
                  Selected Evidence Photos ({photos.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {photos.map((photo: { description: string; reasons: string[]; score: number }, i: number) => (
                    <div key={i} className="bg-white/[0.04] border border-[var(--border-glass)] rounded-lg p-2">
                      <p className="text-xs font-medium text-[var(--white)] truncate">Photo {i + 1}</p>
                      <p className="text-xs text-[var(--gray-muted)] truncate">{photo.description}</p>
                      {photo.reasons && photo.reasons.length > 0 && (
                        <p className="text-xs text-green-600 mt-1 truncate">{photo.reasons[0]}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[var(--gray-muted)]">
                  To: {draft.to_email} &middot; Subject: {draft.subject}
                </p>
                {!isEditing && (
                  <button
                    onClick={() => {
                      setEditingDraft(draft.id);
                      setEditedHtml(draft.edited_body_html || draft.body_html);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Edit
                  </button>
                )}
              </div>

              {isEditing ? (
                <div>
                  <textarea
                    value={editedHtml}
                    onChange={(e) => setEditedHtml(e.target.value)}
                    className="w-full h-64 px-3 py-2 text-sm border border-[var(--border-glass)] rounded-lg font-mono focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={async () => {
                        await props.onSaveDraftEdits(draft.id, editedHtml);
                        setEditingDraft(null);
                      }}
                      className="bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                    >
                      Save Edits
                    </button>
                    <button
                      onClick={() => setEditingDraft(null)}
                      className="text-[var(--gray-dim)] hover:text-[var(--gray)] text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="bg-white/[0.04] border border-[var(--border-glass)] rounded-lg p-4 text-sm text-[var(--gray)] max-h-80 overflow-y-auto prose prose-sm"
                  dangerouslySetInnerHTML={{
                    __html: draft.edited_body_html || draft.body_html,
                  }}
                />
              )}
            </div>

            <div className="flex items-center gap-3 pt-3 border-t border-white/[0.04]">
              <button
                onClick={() => props.onApproveSend(draft)}
                disabled={isSending}
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-semibold transition-colors text-sm flex items-center gap-2"
              >
                {isSending ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Sending...
                  </>
                ) : (
                  "Approve & Send"
                )}
              </button>
              <button
                onClick={() => props.onRegenerateDraft(draft.id)}
                disabled={isRegenerating}
                className="bg-[var(--bg-glass)] border border-[var(--border-glass)] hover:border-[var(--border-glass)] text-[var(--gray)] px-4 py-2.5 rounded-xl font-medium transition-colors text-sm disabled:opacity-50"
              >
                {isRegenerating ? "Regenerating..." : "Regenerate"}
              </button>
              <button
                onClick={() => props.onRejectDraft(draft.id)}
                className="text-[var(--gray-dim)] hover:text-red-500 text-sm transition-colors"
              >
                Discard
              </button>
              <span className="ml-auto text-xs text-[var(--gray-dim)]">
                Cost: ${draft.generation_cost?.toFixed(4) || "0.00"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
