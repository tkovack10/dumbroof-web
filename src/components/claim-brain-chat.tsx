"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { directUpload } from "@/lib/upload-utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  toolActions?: ToolAction[];
  attachments?: { filename: string; storage_path: string }[];
}

interface ToolAction {
  action: "preview" | "complete" | "error";
  type: string;
  tool_name: string;
  approval_id?: string;
  message: string;
  draft?: {
    to: string;
    cc?: string;
    subject: string;
    body_html: string;
    attachments?: { path: string; filename: string }[];
  };
  preview?: Record<string, unknown>;
  pdf_path?: string;
  sign_link?: string;
  data?: Record<string, unknown>;
}

interface PendingAttachment {
  file: File;
  id: string;
  uploading: boolean;
  storage_path?: string;
  error?: string;
}

interface Suggestion {
  type: string;
  icon: string;
  title: string;
  description: string;
  prompt: string;
}

interface ClaimBrainChatProps {
  claimId: string;
  claimAddress?: string;
  carrier?: string;
  variance?: number;
  userId?: string;
  filePath?: string;
}

// Minimal markdown → HTML (no dependencies)
function renderMarkdown(text: string): string {
  if (!text) return "";
  // Headers BEFORE HTML escaping so # markup is preserved
  let html = text
    .replace(/^### (.+)$/gm, '<!--h3-->$1<!--/h3-->')
    .replace(/^## (.+)$/gm, '<!--h2-->$1<!--/h2-->')
    // Then escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Restore headers
    .replace(/&lt;!--h3--&gt;(.+?)&lt;!--\/h3--&gt;/g, '<h3 class="text-sm font-bold text-blue-400 mt-3 mb-1">$1</h3>')
    .replace(/&lt;!--h2--&gt;(.+?)&lt;!--\/h2--&gt;/g, '<h2 class="text-sm font-bold text-blue-300 mt-3 mb-1">$1</h2>')
    // Bold & italic
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Code
    .replace(/`(.+?)`/g, '<code class="bg-white/10 px-1 rounded text-xs">$1</code>')
    // Tables
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split("|").filter((c) => c.trim());
      if (cells.every((c) => /^[\s\-:]+$/.test(c))) return "<!--sep-->";
      return (
        "<tr>" +
        cells
          .map(
            (c) =>
              `<td class="border border-white/10 px-2 py-1 text-xs">${c.trim()}</td>`
          )
          .join("") +
        "</tr>"
      );
    })
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-sm">$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(
    /((?:<li[^>]*>.*<\/li>\n?)+)/g,
    '<ul class="list-disc space-y-0.5 my-1">$1</ul>'
  );
  // Wrap <tr> in <table>
  html = html.replace(
    /((?:<tr>.*<\/tr>\n?)+)/g,
    '<table class="w-full border-collapse my-2">$1</table>'
  );
  html = html.replace(/<!--sep-->\n?/g, "");
  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p class=\"text-sm my-1\">");
  html = html.replace(/\n/g, "<br>");
  return '<p class="text-sm my-1">' + html + "</p>";
}

const TOOL_ICONS: Record<string, string> = {
  send_supplement_email: "📧",
  generate_invoice: "🧾",
  generate_coc: "📋",
  send_aob_to_carrier: "📜",
  send_aob_for_signature: "✍️",
  send_custom_email: "✉️",
  check_claim_status: "📊",
  check_carrier_emails: "📨",
  get_scope_comparison: "📐",
  get_carrier_playbook: "📖",
  lookup_xactimate_price: "💲",
  get_noaa_weather: "⛈️",
  search_photos: "📸",
  get_damage_scores: "🎯",
  coach_photo_documentation: "📷",
  find_photo: "🔍",
  edit_photo_annotation: "✏️",
  exclude_photo_from_claim: "🚫",
  list_integrations: "🔌",
  get_integration_setup_guide: "📘",
  save_integration_key: "🔑",
  invite_team_member: "👥",
  classify_uploaded_file: "🗂️",
  attach_to_claim: "📥",
  trigger_reprocess: "🔄",
  send_to_carrier: "🚀",
  schedule_follow_up_cadence: "⏱️",
  cancel_cadence: "🛑",
  list_line_items: "📋",
  add_line_item: "➕",
  remove_line_item: "➖",
  modify_line_item: "✏️",
  recompute_estimate: "🧮",
};

const TOOL_LABELS: Record<string, string> = {
  send_supplement_email: "Supplement Email",
  generate_invoice: "Invoice",
  generate_coc: "Certificate of Completion",
  send_aob_to_carrier: "AOB to Carrier",
  send_aob_for_signature: "AOB for Signature",
  send_custom_email: "Email",
  check_claim_status: "Status Check",
  check_carrier_emails: "Carrier Emails",
  get_scope_comparison: "Scope Comparison",
  get_carrier_playbook: "Carrier Playbook",
  lookup_xactimate_price: "Xactimate Price",
  get_noaa_weather: "NOAA Weather",
  search_photos: "Photo Search",
  get_damage_scores: "Damage Scores",
  coach_photo_documentation: "Photo Coaching",
  find_photo: "Find Photo",
  edit_photo_annotation: "Edit Photo Annotation",
  exclude_photo_from_claim: "Exclude Photo",
  list_integrations: "Integration Status",
  get_integration_setup_guide: "Setup Guide",
  save_integration_key: "Save API Key",
  invite_team_member: "Invite Team Member",
  classify_uploaded_file: "File Classification",
  attach_to_claim: "Attach to Claim",
  trigger_reprocess: "Reprocess Claim",
  send_to_carrier: "Send to Carrier",
  schedule_follow_up_cadence: "Schedule Follow-Ups",
  cancel_cadence: "Cancel Follow-Ups",
  list_line_items: "Line Items",
  add_line_item: "Add Line Item",
  remove_line_item: "Remove Line Item",
  modify_line_item: "Modify Line Item",
  recompute_estimate: "Recompute Estimate",
};

const QUICK_ACTIONS = [
  { label: "Claim status", prompt: "Where does this claim stand?" },
  { label: "Carrier gaps", prompt: "What did the carrier miss?" },
  { label: "Best argument", prompt: "What's our strongest supplement argument?" },
  { label: "Photo coaching", prompt: "What photos am I missing and how should I take them? Give me specific techniques." },
  { label: "Draft email", prompt: "Draft a supplement response to the adjuster" },
  { label: "Line items", prompt: "Break down the financials line by line" },
  { label: "Carrier emails", prompt: "Check if the carrier has responded to any emails on this claim" },
];

function ToolActionCard({
  action,
  claimId,
  backendUrl,
  onStatusUpdate,
}: {
  action: ToolAction;
  claimId: string;
  backendUrl: string;
  onStatusUpdate: (id: string, status: string) => void;
}) {
  const [status, setStatus] = useState<"pending" | "approving" | "sent" | "discarded" | "error">("pending");
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  // Seeded once when the user hits "Edit" — initialized from the current
  // draft / preview so the form shows Richard's proposal, not empty fields.
  const [edits, setEdits] = useState<Record<string, unknown>>({});

  const icon = TOOL_ICONS[action.tool_name] || "🔧";
  const label = TOOL_LABELS[action.tool_name] || action.tool_name;

  const startEdit = () => {
    if (action.draft) {
      setEdits({
        to: action.draft.to,
        cc: action.draft.cc || "",
        subject: action.draft.subject,
        body_html: action.draft.body_html,
      });
    } else if (action.preview) {
      const p = action.preview as Record<string, unknown>;
      setEdits({
        to_email: p.to_email || "",
        cc: p.cc || "",
        subject: p.subject || "",
        body_html: p.body_html || "",
        doc_type: p.doc_type || "",
        reason: p.reason || "",
        cadence_type: p.cadence_type || "",
        days: Array.isArray(p.days) ? (p.days as number[]).join(", ") : "",
      });
    }
    setEditing(true);
  };

  const handleApprove = async () => {
    if (!action.approval_id) return;
    setStatus("approving");

    // Build overrides payload from edited fields. Only send fields the user
    // actually changed vs the original draft/preview.
    const overrides: Record<string, unknown> = {};
    if (editing) {
      if (action.draft) {
        if (edits.to !== action.draft.to) overrides.to = edits.to;
        if (edits.cc !== (action.draft.cc || "")) overrides.cc = edits.cc || null;
        if (edits.subject !== action.draft.subject) overrides.subject = edits.subject;
        if (edits.body_html !== action.draft.body_html) overrides.body_html = edits.body_html;
      }
      if (action.preview) {
        const p = action.preview as Record<string, unknown>;
        for (const k of ["to_email", "cc", "subject", "body_html", "doc_type", "reason", "cadence_type"] as const) {
          const orig = p[k] ?? "";
          if (edits[k] !== undefined && edits[k] !== orig) {
            overrides[k] = edits[k];
          }
        }
        if (typeof edits.days === "string" && edits.days.trim()) {
          const parsed = (edits.days as string)
            .split(/[,\s]+/)
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => Number.isFinite(n) && n > 0);
          const origDays = Array.isArray(p.days) ? (p.days as number[]) : [];
          if (parsed.length && JSON.stringify(parsed) !== JSON.stringify(origDays)) {
            overrides.days = parsed;
            // Rebuild the schedule on backend — don't send stale schedule rows.
            // The dispatcher will use days[] to reconstruct schedule from today.
            overrides.schedule = null;
          }
        }
      }
    }

    try {
      const res = await fetch(`${backendUrl}/api/claim-brain/${claimId}/approve-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool_call_id: action.approval_id,
          approved: true,
          overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        }),
      });
      const data = await res.json();
      if (data.status === "sent" || data.status === "dry_run") {
        setStatus("sent");
        onStatusUpdate(action.approval_id, data.status === "dry_run" ? "dry_run" : "sent");
      } else if (data.status === "error") {
        setStatus("error");
      } else {
        setStatus("sent");
      }
    } catch {
      setStatus("error");
    }
  };

  const handleDiscard = async () => {
    if (!action.approval_id) return;
    try {
      await fetch(`${backendUrl}/api/claim-brain/${claimId}/approve-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_call_id: action.approval_id, approved: false }),
      });
    } catch {
      // ignore
    }
    setStatus("discarded");
    onStatusUpdate(action.approval_id, "discarded");
  };

  // Status check (no approval needed) — show data inline
  if (action.action === "complete" && action.type === "status" && action.data) {
    return (
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center gap-1.5 text-xs text-blue-400 font-medium mb-2">
          {icon} {label}
        </div>
        <div className="grid grid-cols-2 gap-1 text-[11px]">
          {Object.entries(action.data).map(([key, val]) => (
            <div key={key} className="flex justify-between">
              <span className="text-white/40">{key.replace(/_/g, " ")}:</span>
              <span className="text-white/70">
                {typeof val === "number" && key.includes("rcv")
                  ? `$${val.toLocaleString()}`
                  : String(val ?? "—")}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // PDF generated (no email) — complete action
  if (action.action === "complete" && action.pdf_path) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
          {icon} {label} Generated
        </div>
        <div className="text-[11px] text-white/50 mt-1">{action.message}</div>
      </div>
    );
  }

  // R1/R2 — Scope comparison: top gaps with totals
  if (action.action === "complete" && action.type === "scope_comparison" && action.data) {
    const d = action.data as { rows?: Array<Record<string, unknown>>; total_gap?: number; row_count?: number };
    const rows = d.rows || [];
    return (
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-indigo-300 font-medium">{icon} {label}</div>
          {typeof d.total_gap === "number" && d.total_gap > 0 && (
            <div className="text-[11px] text-emerald-400 font-semibold">
              +${d.total_gap.toLocaleString()}
            </div>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="text-[11px] text-white/40">{action.message}</div>
        ) : (
          <div className="space-y-1">
            {rows.slice(0, 6).map((r, i) => {
              const delta = Number(r.delta || 0);
              return (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-white/70 truncate mr-2">{String(r.item || "Unknown")}</span>
                  <span className={delta > 0 ? "text-emerald-400" : "text-white/40"}>
                    {delta > 0 ? `+$${delta.toLocaleString()}` : `$${delta.toLocaleString()}`}
                  </span>
                </div>
              );
            })}
            {rows.length > 6 && (
              <div className="text-[10px] text-white/30 pt-1">+ {rows.length - 6} more</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // R1 — Carrier playbook: collapsible excerpt
  if (action.action === "complete" && action.type === "carrier_playbook" && action.data) {
    const d = action.data as { carrier?: string; playbook?: string | null };
    return (
      <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-purple-300 font-medium">{icon} {label} {d.carrier ? `— ${d.carrier}` : ""}</div>
          {d.playbook && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-white/30 hover:text-white/60"
            >
              {expanded ? "Hide" : "Show"}
            </button>
          )}
        </div>
        {!d.playbook ? (
          <div className="text-[11px] text-white/40">{action.message}</div>
        ) : expanded ? (
          <div className="mt-2 p-2 bg-white/5 rounded text-[11px] text-white/60 max-h-60 overflow-y-auto whitespace-pre-wrap">
            {d.playbook}
          </div>
        ) : (
          <div className="text-[11px] text-white/50">{action.message}</div>
        )}
      </div>
    );
  }

  // R1 — Xactimate price
  if (action.action === "complete" && action.type === "xactimate_price" && action.data) {
    const d = action.data as { description?: string; state?: string; match?: Record<string, unknown> | null };
    const m = d.match || null;
    return (
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center gap-1.5 text-xs text-amber-300 font-medium">
          {icon} {label} {d.state ? `(${d.state})` : ""}
        </div>
        {!m ? (
          <div className="text-[11px] text-white/40 mt-1">{action.message}</div>
        ) : (
          <div className="text-[11px] text-white/70 mt-1">
            <div><span className="text-white/40">Item:</span> {d.description}</div>
            {m.code ? <div><span className="text-white/40">Code:</span> {String(m.code)}</div> : null}
            <div><span className="text-white/40">Price:</span> <span className="text-emerald-400">{action.message}</span></div>
          </div>
        )}
      </div>
    );
  }

  // R1 — NOAA weather
  if (action.action === "complete" && action.type === "noaa_weather" && action.data) {
    const d = action.data as { events?: Array<Record<string, unknown>>; reason?: string; date_of_loss?: string };
    const events = d.events || [];
    return (
      <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-3 my-2">
        <div className="text-xs text-sky-300 font-medium mb-1">{icon} {label}</div>
        {events.length === 0 ? (
          <div className="text-[11px] text-white/40">{action.message}</div>
        ) : (
          <div className="space-y-1">
            {events.slice(0, 5).map((e, i) => (
              <div key={i} className="text-[11px] text-white/70">
                <span className="text-white/40">{String(e.date || e.event_date || "")}</span>{" "}
                — {String(e.event_type || e.type || "Event")}{" "}
                {e.magnitude ? <span className="text-white/50">({String(e.magnitude)})</span> : null}
                {e.distance_miles ? <span className="text-white/30"> · {Number(e.distance_miles).toFixed(1)}mi</span> : null}
              </div>
            ))}
            {events.length > 5 && <div className="text-[10px] text-white/30">+ {events.length - 5} more</div>}
          </div>
        )}
      </div>
    );
  }

  // R1 — Photo search
  if (action.action === "complete" && action.type === "photo_search" && action.data) {
    const d = action.data as { photos?: Array<Record<string, unknown>>; total?: number };
    const photos = d.photos || [];
    return (
      <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3 my-2">
        <div className="text-xs text-cyan-300 font-medium mb-1">{icon} {label} — {photos.length}</div>
        {photos.length === 0 ? (
          <div className="text-[11px] text-white/40">{action.message}</div>
        ) : (
          <div className="space-y-0.5">
            {photos.slice(0, 6).map((p, i) => (
              <div key={i} className="text-[11px] text-white/70 truncate">
                <span className="text-white/40">{String(p.annotation_key || `#${i}`)}:</span>{" "}
                {String(p.damage_type || "—")} / {String(p.material || "—")} / {String(p.severity || "—")}
              </div>
            ))}
            {photos.length > 6 && <div className="text-[10px] text-white/30">+ {photos.length - 6} more</div>}
          </div>
        )}
      </div>
    );
  }

  // R1 — Damage scores
  if (action.action === "complete" && action.type === "damage_scores" && action.data) {
    const d = action.data as { damage_score?: number | null; damage_grade?: string; approval_score?: number | null; approval_grade?: string };
    return (
      <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3 my-2">
        <div className="text-xs text-rose-300 font-medium mb-1">{icon} {label}</div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <div className="text-white/40">Damage Score</div>
            <div className="text-white font-semibold">
              {d.damage_score ?? "—"}{" "}
              {d.damage_grade && <span className="text-emerald-400 text-[10px]">({d.damage_grade})</span>}
            </div>
          </div>
          <div>
            <div className="text-white/40">Approval Score</div>
            <div className="text-white font-semibold">
              {d.approval_score ?? "—"}{" "}
              {d.approval_grade && <span className="text-amber-400 text-[10px]">({d.approval_grade})</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Integrations status — connection grid
  if (action.action === "complete" && action.type === "integrations_status" && action.data) {
    const d = action.data as {
      integrations?: Record<string, { connected: boolean; sending_email?: string; connected_at?: string }>;
      connected_count?: number;
      total_count?: number;
      profile_completeness?: Record<string, boolean>;
      profile_complete?: boolean;
    };
    const integrations = d.integrations || {};
    return (
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-indigo-300 font-medium">
            {icon} {label} — {d.connected_count}/{d.total_count} connected
          </div>
          {d.profile_complete ? (
            <div className="text-[10px] text-emerald-300">Profile ✓</div>
          ) : (
            <div className="text-[10px] text-amber-300">Profile incomplete</div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1 text-[11px]">
          {Object.entries(integrations).map(([name, info]) => (
            <div key={name} className="flex items-center gap-1">
              <span className={info.connected ? "text-emerald-400" : "text-white/30"}>
                {info.connected ? "●" : "○"}
              </span>
              <span className="text-white/70 capitalize">{name.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Integration setup guide — step-by-step instructions
  if (action.action === "complete" && action.type === "integration_setup_guide" && action.data) {
    const d = action.data as {
      display_name?: string;
      category?: string;
      auth_type?: string;
      unlocks?: string[];
      steps?: string[];
      gotchas?: string[];
    };
    return (
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 my-2">
        <div className="text-xs text-indigo-300 font-medium mb-1">
          {icon} {d.display_name} Setup
          <span className="text-white/40 ml-2">· {d.category} · {d.auth_type}</span>
        </div>
        {d.unlocks && d.unlocks.length > 0 && (
          <div className="mt-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-[10px] text-emerald-300 font-semibold uppercase tracking-wide mb-1">Unlocks</div>
            {d.unlocks.map((u, i) => (
              <div key={i} className="text-[11px] text-white/70">✓ {u}</div>
            ))}
          </div>
        )}
        {d.steps && d.steps.length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] text-white/40 font-semibold uppercase tracking-wide mb-1">Steps</div>
            <ol className="space-y-1">
              {d.steps.map((s, i) => (
                <li key={i} className="text-[11px] text-white/70 leading-snug">
                  <span className="text-indigo-300 font-semibold">{i + 1}.</span> {s}
                </li>
              ))}
            </ol>
          </div>
        )}
        {d.gotchas && d.gotchas.length > 0 && (
          <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
            <div className="text-[10px] text-amber-300 font-semibold uppercase tracking-wide mb-1">Gotchas</div>
            {d.gotchas.map((g, i) => (
              <div key={i} className="text-[11px] text-white/70">⚠ {g}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Photo find — results list
  if (action.action === "complete" && action.type === "photo_find" && action.data) {
    const d = action.data as { matches?: Array<Record<string, unknown>>; query?: string; total_on_claim?: number };
    const matches = d.matches || [];
    return (
      <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg p-3 my-2">
        <div className="text-xs text-teal-300 font-medium mb-1">
          {icon} Photo search: &quot;{String(d.query || "")}&quot; — {matches.length} match{matches.length !== 1 ? "es" : ""}
        </div>
        {matches.length === 0 ? (
          <div className="text-[11px] text-white/40">{action.message}</div>
        ) : (
          <div className="space-y-1">
            {matches.map((m, i) => (
              <div key={i} className="text-[11px] text-white/70 border-l-2 border-teal-500/30 pl-2">
                <div className="font-mono text-teal-200">{String(m.annotation_key || "?")}</div>
                <div className="text-white/60 truncate" title={String(m.annotation_text || "")}>
                  {String(m.annotation_text || "(no description)")}
                </div>
                <div className="text-[10px] text-white/40">
                  {String(m.damage_type || "—")} / {String(m.material || "—")} / {String(m.severity || "—")}
                  {m.match_reason ? <span className="text-white/30"> · {String(m.match_reason)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Photo coaching — forensic documentation plan
  if (action.action === "complete" && action.type === "photo_coaching" && action.data) {
    const d = action.data as {
      photo_count?: number;
      focus?: string;
      coverage?: Record<string, number>;
      coaching_steps?: Array<{
        title: string;
        importance: string;
        area: string;
        instruction: string;
        damage_score_impact?: string;
      }>;
      estimated_damage_score_gain?: number;
      current_damage_score?: number;
      current_damage_grade?: string;
    };
    const steps = d.coaching_steps || [];
    const impColor = (imp: string) =>
      imp === "critical" ? "border-red-500/40 bg-red-500/5"
        : imp === "high" ? "border-amber-500/40 bg-amber-500/5"
        : imp === "medium" ? "border-blue-500/40 bg-blue-500/5"
        : "border-white/10 bg-white/[0.02]";
    const impBadge = (imp: string) =>
      imp === "critical" ? "text-red-300"
        : imp === "high" ? "text-amber-300"
        : imp === "medium" ? "text-blue-300"
        : "text-white/60";
    return (
      <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-purple-300 font-medium">
            {icon} {label}
            <span className="text-white/40"> · {d.photo_count || 0} photos on claim</span>
          </div>
          {typeof d.estimated_damage_score_gain === "number" && d.estimated_damage_score_gain > 0 && (
            <div className="text-[11px] text-emerald-400 font-semibold">
              +{d.estimated_damage_score_gain} DS points available
            </div>
          )}
        </div>
        {steps.length === 0 ? (
          <div className="text-[11px] text-white/50">
            Documentation is solid — no gaps detected for {d.focus}.
            {typeof d.current_damage_score === "number" && (
              <span className="text-white/40"> Current DS: {d.current_damage_score} ({d.current_damage_grade}).</span>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={i} className={`rounded-md border ${impColor(s.importance)} p-2`}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className={`text-[11px] font-semibold ${impBadge(s.importance)}`}>
                    {i + 1}. {s.title}
                  </div>
                  <div className="flex items-center gap-2 text-[9px]">
                    <span className="uppercase tracking-wide text-white/40">{s.importance}</span>
                    {s.damage_score_impact && (
                      <span className="text-emerald-300/80">{s.damage_score_impact}</span>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-white/70 whitespace-pre-wrap leading-snug">
                  {s.instruction}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Line item list (read-only)
  if (action.action === "complete" && action.type === "line_items" && action.data) {
    const d = action.data as { items?: Array<Record<string, unknown>>; count?: number; source?: string; total_value?: number };
    const items = d.items || [];
    return (
      <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-teal-300 font-medium">{icon} {label} ({d.source})</div>
          {typeof d.total_value === "number" && (
            <div className="text-[11px] text-teal-200 font-semibold">${d.total_value.toLocaleString()}</div>
          )}
        </div>
        {items.length === 0 ? (
          <div className="text-[11px] text-white/40">{action.message}</div>
        ) : (
          <div className="space-y-0.5">
            {items.slice(0, 8).map((li, i) => (
              <div key={i} className="text-[10px] text-white/70 flex items-center justify-between gap-2">
                <span className="truncate flex-1" title={String(li.description || "")}>
                  {String(li.description || "?")}
                </span>
                <span className="text-white/50 shrink-0">{String(li.qty || 0)} {String(li.unit || "")}</span>
                <span className="text-white/70 shrink-0">${Number(li.total || 0).toLocaleString()}</span>
              </div>
            ))}
            {items.length > 8 && <div className="text-[10px] text-white/30">+ {items.length - 8} more</div>}
          </div>
        )}
      </div>
    );
  }

  // R2 — File classification
  if (action.action === "complete" && action.type === "file_classification" && action.data) {
    const d = action.data as {
      filename?: string;
      classification?: string;
      confidence?: number;
      signals?: string[];
      suggested_action?: string;
      low_confidence?: boolean;
    };
    const confidence = Math.round(Number(d.confidence || 0) * 100);
    const borderColor = d.low_confidence ? "border-amber-500/30" : "border-emerald-500/20";
    const accentColor = d.low_confidence ? "text-amber-300" : "text-emerald-300";
    return (
      <div className={`bg-white/[0.02] border ${borderColor} rounded-lg p-3 my-2`}>
        <div className="flex items-center justify-between">
          <div className={`text-xs ${accentColor} font-medium`}>
            {icon} {d.classification || "OTHER"}{" "}
            <span className="text-white/40">({confidence}%)</span>
          </div>
          <div className="text-[10px] text-white/30 truncate max-w-[180px]">{d.filename}</div>
        </div>
        {d.suggested_action && (
          <div className="text-[11px] text-white/60 mt-1">{d.suggested_action}</div>
        )}
        {d.low_confidence && (
          <div className="text-[10px] text-amber-400 mt-1">⚠ Low confidence — confirm before routing</div>
        )}
      </div>
    );
  }

  // R3/R4 — Destructive-write previews. Uses action.preview (not action.draft).
  if (action.action === "preview" && action.preview) {
    const p = action.preview as Record<string, unknown>;
    const statusColor =
      status === "sent" ? "bg-emerald-500/5 border-emerald-500/20" :
      status === "discarded" ? "bg-white/5 border-white/10 opacity-50" :
      status === "error" ? "bg-red-500/5 border-red-500/20" :
      "bg-amber-500/5 border-amber-500/20";
    const headerColor =
      status === "sent" ? "text-emerald-400" :
      status === "error" ? "text-red-400" :
      "text-amber-400";
    return (
      <div className={`border rounded-lg p-3 my-2 ${statusColor}`}>
        <div className={`flex items-center gap-1.5 text-xs font-medium ${headerColor}`}>
          {icon} {label}
          {status === "sent" && " — Done"}
          {status === "discarded" && " — Cancelled"}
          {status === "error" && " — Failed"}
          {status === "approving" && " — Working..."}
        </div>

        {/* Preview details — render per tool type. Edit mode swaps text for inputs. */}
        <div className="mt-1.5 text-[11px] text-white/60 space-y-1">
          {action.tool_name === "attach_to_claim" && (
            <>
              <div><span className="text-white/40">File:</span> {String(p.filename || "")}</div>
              {editing ? (
                <label className="block">
                  <span className="text-white/40 block mb-0.5">Doc type:</span>
                  <select
                    value={String(edits.doc_type || "")}
                    onChange={(e) => setEdits({ ...edits, doc_type: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
                  >
                    {["AOB", "COC", "CARRIER_SCOPE", "EAGLEVIEW", "CONTRACT", "PHOTO", "SUPPLEMENT_RESPONSE", "OTHER"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div><span className="text-white/40">Doc type:</span> {String(p.doc_type || "")}</div>
              )}
              <div><span className="text-white/40">Slot:</span> <code className="text-white/70">{String(p.column || "")}</code></div>
              {typeof p.classification_confidence === "number" && (
                <div><span className="text-white/40">Confidence:</span> {Math.round((p.classification_confidence as number) * 100)}%</div>
              )}
            </>
          )}
          {action.tool_name === "trigger_reprocess" && (
            <>
              {editing ? (
                <label className="block">
                  <span className="text-white/40 block mb-0.5">Reason:</span>
                  <input
                    value={String(edits.reason || "")}
                    onChange={(e) => setEdits({ ...edits, reason: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
                  />
                </label>
              ) : (
                <div><span className="text-white/40">Reason:</span> {String(p.reason || "not specified")}</div>
              )}
              <div><span className="text-white/40">Duration:</span> ~{String(p.estimated_duration_seconds || 90)}s</div>
              <div className="text-white/40">Regenerates: {((p.regenerates as string[]) || []).join(", ")}</div>
            </>
          )}
          {action.tool_name === "send_to_carrier" && (
            <>
              {editing ? (
                <>
                  <label className="block">
                    <span className="text-white/40 block mb-0.5">To:</span>
                    <input
                      value={String(edits.to_email || "")}
                      onChange={(e) => setEdits({ ...edits, to_email: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
                    />
                  </label>
                  <label className="block">
                    <span className="text-white/40 block mb-0.5">CC:</span>
                    <input
                      value={String(edits.cc || "")}
                      onChange={(e) => setEdits({ ...edits, cc: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
                    />
                  </label>
                  <div><span className="text-white/40">Subject:</span> <span className="text-white">{String(p.subject || "")}</span> <span className="text-white/30">(locked = claim number)</span></div>
                  <label className="block">
                    <span className="text-white/40 block mb-0.5">Body (HTML):</span>
                    <textarea
                      value={String(edits.body_html || "")}
                      onChange={(e) => setEdits({ ...edits, body_html: e.target.value })}
                      rows={6}
                      className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80 font-mono text-[10px]"
                    />
                  </label>
                </>
              ) : (
                <>
                  <div><span className="text-white/40">To:</span> {String(p.to_email || "")}</div>
                  {p.cc && <div><span className="text-white/40">CC:</span> {String(p.cc)}</div>}
                  <div><span className="text-white/40">Subject:</span> <span className="text-white">{String(p.subject || "")}</span></div>
                  {typeof p.attachment_count === "number" && p.attachment_count > 0 && (
                    <div><span className="text-white/40">Attachments:</span> {String(p.attachment_count)}</div>
                  )}
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="text-[10px] text-white/30 hover:text-white/60 mt-1"
                  >
                    {expanded ? "Hide body" : "Show body"}
                  </button>
                  {expanded && (
                    <div className="mt-1 p-2 bg-white/5 rounded text-[11px] text-white/60 max-h-40 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: String(p.body_html || "") }}
                    />
                  )}
                </>
              )}
            </>
          )}
          {action.tool_name === "schedule_follow_up_cadence" && (
            <>
              <div><span className="text-white/40">Cadence:</span> {String(p.cadence_type || "")}</div>
              {editing ? (
                <>
                  <label className="block">
                    <span className="text-white/40 block mb-0.5">To:</span>
                    <input
                      value={String(edits.to_email || "")}
                      onChange={(e) => setEdits({ ...edits, to_email: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
                    />
                  </label>
                  <label className="block">
                    <span className="text-white/40 block mb-0.5">CC:</span>
                    <input
                      value={String(edits.cc || "")}
                      onChange={(e) => setEdits({ ...edits, cc: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
                    />
                  </label>
                  <label className="block">
                    <span className="text-white/40 block mb-0.5">Days (comma-separated):</span>
                    <input
                      value={String(edits.days || "")}
                      onChange={(e) => setEdits({ ...edits, days: e.target.value })}
                      placeholder="3, 7, 14, 21"
                      className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
                    />
                  </label>
                </>
              ) : (
                <>
                  <div><span className="text-white/40">To:</span> {String(p.to_email || "")}</div>
                  <div><span className="text-white/40">Subject:</span> <span className="text-white">{String(p.subject || "")}</span></div>
                  <div><span className="text-white/40">Days:</span> [{((p.days as number[]) || []).join(", ")}]</div>
                  {((p.attachment_paths as string[]) || []).length > 0 && (
                    <div><span className="text-white/40">Attachments on each send:</span> {((p.attachment_paths as string[]) || []).length}</div>
                  )}
                </>
              )}
            </>
          )}
          {action.tool_name === "cancel_cadence" && (
            <>
              <div><span className="text-white/40">Pending follow-ups:</span> {String(p.pending_count || 0)}</div>
              {editing ? (
                <label className="block">
                  <span className="text-white/40 block mb-0.5">Reason:</span>
                  <input
                    value={String(edits.reason || "")}
                    onChange={(e) => setEdits({ ...edits, reason: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
                  />
                </label>
              ) : (
                <div><span className="text-white/40">Reason:</span> {String(p.reason || "")}</div>
              )}
            </>
          )}
          {action.tool_name === "add_line_item" && (
            <>
              <div><span className="text-white/40">Description:</span> <span className="text-white">{String(p.description || "")}</span></div>
              <div className="flex items-center gap-3">
                <span><span className="text-white/40">Qty:</span> {String(p.qty || 0)} {String(p.unit || "")}</span>
                <span><span className="text-white/40">Price:</span> ${Number(p.unit_price || 0).toFixed(2)}</span>
                <span className="text-emerald-300 font-semibold">= ${Number(p.total || 0).toLocaleString()}</span>
              </div>
              {p.xactimate_code ? <div><span className="text-white/40">Code:</span> {String(p.xactimate_code)}</div> : null}
              <div className="text-white/60 italic">"{String(p.reason || "")}"</div>
              {Array.isArray(p.potential_dupes) && (p.potential_dupes as unknown[]).length > 0 && (
                <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
                  <div className="text-[10px] text-amber-300 font-semibold mb-1">
                    ⚠ {(p.potential_dupes as unknown[]).length} similar line item
                    {(p.potential_dupes as unknown[]).length !== 1 ? "s" : ""} already on this claim:
                  </div>
                  {(p.potential_dupes as Array<Record<string, unknown>>).map((d, i) => (
                    <div key={i} className="text-[10px] text-white/70 truncate">
                      • {String(d.description || "")} — {String(d.qty || 0)} {String(d.unit || "")} @ ${Number(d.unit_price || 0).toFixed(2)} ({String(d.source || "")})
                    </div>
                  ))}
                  <div className="text-[10px] text-amber-200/70 mt-1">
                    Verify this isn&apos;t a duplicate before approving.
                  </div>
                </div>
              )}
            </>
          )}
          {action.tool_name === "remove_line_item" && (
            <>
              <div><span className="text-white/40">Item:</span> <span className="text-white">{String(p.description || "")}</span></div>
              <div><span className="text-white/40">Total removed:</span> <span className="text-red-300 font-semibold">-${Number(p.total || 0).toLocaleString()}</span></div>
              <div><span className="text-white/40">Source:</span> {String(p.source || "")}</div>
              <div className="text-white/60 italic">"{String(p.reason || "")}"</div>
            </>
          )}
          {action.tool_name === "modify_line_item" && (
            <>
              <div><span className="text-white/40">Item:</span> <span className="text-white">{String(p.description || "")}</span></div>
              <div className="flex items-center gap-2 text-white/70">
                <span>{String(p.old_qty || 0)}{String(p.unit || "")} × ${Number(p.old_unit_price || 0).toFixed(2)} = ${Number(p.old_total || 0).toLocaleString()}</span>
                <span className="text-white/40">→</span>
                <span className="font-semibold">{String(p.new_qty || 0)}{String(p.unit || "")} × ${Number(p.new_unit_price || 0).toFixed(2)} = ${Number(p.new_total || 0).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-white/40">Delta:</span>{" "}
                <span className={Number(p.delta || 0) > 0 ? "text-emerald-300 font-semibold" : "text-red-300 font-semibold"}>
                  {Number(p.delta || 0) > 0 ? "+" : ""}${Number(p.delta || 0).toLocaleString()}
                </span>
              </div>
              <div className="text-white/60 italic">"{String(p.reason || "")}"</div>
            </>
          )}
          {action.tool_name === "save_integration_key" && (
            <>
              <div><span className="text-white/40">Service:</span> <span className="text-white">{String(p.display_name || p.service || "")}</span></div>
              <div><span className="text-white/40">API key:</span> <code className="text-white/80">{String(p.api_key_masked || "")}</code></div>
              {p.tenant_id ? <div><span className="text-white/40">Tenant:</span> {String(p.tenant_id)}</div> : null}
              {p.client_id ? <div><span className="text-white/40">Client ID:</span> {String(p.client_id)}</div> : null}
              {Array.isArray(p.unlocks) && (p.unlocks as unknown[]).length > 0 && (
                <div className="mt-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-[10px] text-emerald-300 font-semibold uppercase tracking-wide mb-1">Unlocks</div>
                  {(p.unlocks as string[]).map((u, i) => (
                    <div key={i} className="text-[11px] text-white/70">✓ {u}</div>
                  ))}
                </div>
              )}
            </>
          )}
          {action.tool_name === "invite_team_member" && (
            <>
              <div><span className="text-white/40">Email:</span> <span className="text-white">{String(p.email || "")}</span></div>
              <div><span className="text-white/40">Role:</span> <span className="text-white">{String(p.role || "user")}</span></div>
              {p.name ? <div><span className="text-white/40">Name:</span> {String(p.name)}</div> : null}
              {p.company ? <div><span className="text-white/40">Company:</span> {String(p.company)}</div> : null}
              <div className="text-[10px] text-white/50">Sends a signup invite email.</div>
            </>
          )}
          {action.tool_name === "edit_photo_annotation" && (
            <>
              <div><span className="text-white/40">Photo:</span> <span className="font-mono text-white">{String(p.annotation_key || "?")}</span></div>
              {p.new_annotation && p.new_annotation !== p.original_annotation && (
                <div className="mt-1 p-2 rounded bg-white/5 text-[10px]">
                  <div className="text-white/40 line-through mb-1">{String(p.original_annotation || "(none)")}</div>
                  <div className="text-emerald-300">{String(p.new_annotation)}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-[10px]">
                {Boolean(p.new_damage_type && p.new_damage_type !== p.original_damage_type) && (
                  <span><span className="text-white/40">damage:</span> <span className="line-through text-white/40">{String(p.original_damage_type || "—")}</span> → <span className="text-emerald-300">{String(p.new_damage_type)}</span></span>
                )}
                {Boolean(p.new_material && p.new_material !== p.original_material) && (
                  <span><span className="text-white/40">material:</span> <span className="line-through text-white/40">{String(p.original_material || "—")}</span> → <span className="text-emerald-300">{String(p.new_material)}</span></span>
                )}
                {Boolean(p.new_severity && p.new_severity !== p.original_severity) && (
                  <span><span className="text-white/40">severity:</span> <span className="line-through text-white/40">{String(p.original_severity || "—")}</span> → <span className="text-emerald-300">{String(p.new_severity)}</span></span>
                )}
              </div>
              <div className="text-white/60 italic">&quot;{String(p.reason || "")}&quot;</div>
              <div className="text-[10px] text-white/40">✓ Survives reprocess (annotation_feedback)</div>
            </>
          )}
          {action.tool_name === "exclude_photo_from_claim" && (
            <>
              <div><span className="text-white/40">Photo:</span> <span className="font-mono text-white">{String(p.annotation_key || "?")}</span></div>
              <div className="text-white/70 truncate" title={String(p.current_annotation || "")}>
                <span className="text-white/40">Current caption:</span> {String(p.current_annotation || "(none)")}
              </div>
              <div className="text-white/60 italic">&quot;{String(p.reason || "")}&quot;</div>
              <div className="text-[10px] text-amber-300/80">⚠ Removes from forensic report on next reprocess</div>
            </>
          )}
          {action.tool_name === "recompute_estimate" && (
            <>
              <div><span className="text-white/40">Line items:</span> {String(p.line_item_count || 0)}</div>
              <div className="flex items-center gap-2">
                <span><span className="text-white/40">Old RCV:</span> ${Number(p.old_contractor_rcv || 0).toLocaleString()}</span>
                <span className="text-white/40">→</span>
                <span className="font-semibold text-emerald-300">${Number(p.projected_contractor_rcv || 0).toLocaleString()}</span>
              </div>
              <div><span className="text-white/40">New variance:</span> ${Number(p.projected_variance || 0).toLocaleString()}</div>
            </>
          )}
        </div>

        {status === "pending" && !editing && (
          <button
            onClick={startEdit}
            className="text-[10px] text-blue-400 hover:text-blue-300 mt-2"
          >
            ✎ Edit before approving
          </button>
        )}
        {editing && status === "pending" && (
          <button
            onClick={() => { setEditing(false); setEdits({}); }}
            className="text-[10px] text-white/40 hover:text-white/60 mt-2"
          >
            Cancel edits
          </button>
        )}

        {status === "pending" && (
          <div className="flex gap-2 mt-2.5">
            <button
              onClick={handleApprove}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium py-1.5 rounded-lg transition-colors"
            >
              Approve
            </button>
            <button
              onClick={handleDiscard}
              className="px-3 bg-white/5 hover:bg-white/10 text-white/50 text-[11px] py-1.5 rounded-lg transition-colors"
            >
              Discard
            </button>
          </div>
        )}
        {status === "approving" && (
          <div className="mt-2 text-[11px] text-amber-400 animate-pulse">Working...</div>
        )}
      </div>
    );
  }

  // Email / draft-based preview card (existing — send_supplement_email, etc.)
  return (
    <div className={`border rounded-lg p-3 my-2 ${
      status === "sent" ? "bg-emerald-500/5 border-emerald-500/20" :
      status === "discarded" ? "bg-white/5 border-white/10 opacity-50" :
      status === "error" ? "bg-red-500/5 border-red-500/20" :
      "bg-amber-500/5 border-amber-500/20"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{
          color: status === "sent" ? "#34d399" : status === "error" ? "#f87171" : "#fbbf24"
        }}>
          {icon} {label}
          {status === "sent" && " — Sent"}
          {status === "discarded" && " — Discarded"}
          {status === "error" && " — Failed"}
          {status === "approving" && " — Sending..."}
        </div>
        {action.draft && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-white/30 hover:text-white/60"
          >
            {expanded ? "Hide" : "Preview"}
          </button>
        )}
      </div>

      {/* Summary (view mode) */}
      {action.draft && !editing && (
        <div className="mt-1.5 text-[11px] text-white/50">
          <span className="text-white/30">To:</span> {action.draft.to}
          {action.draft.cc && <> · <span className="text-white/30">CC:</span> {action.draft.cc}</>}
          <br />
          <span className="text-white/30">Subject:</span> {action.draft.subject}
          {action.draft.attachments && action.draft.attachments.length > 0 && (
            <div className="mt-0.5">
              <span className="text-white/30">Attachments:</span>{" "}
              {action.draft.attachments.map((a) => a.filename).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Expanded preview (view mode) */}
      {expanded && action.draft && !editing && (
        <div className="mt-2 p-2 bg-white/5 rounded text-[11px] text-white/60 max-h-40 overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: action.draft.body_html }}
        />
      )}

      {/* Edit mode — to / cc / subject / body */}
      {action.draft && editing && (
        <div className="mt-2 space-y-1 text-[11px] text-white/60">
          <label className="block">
            <span className="text-white/40 block mb-0.5">To:</span>
            <input
              value={String(edits.to || "")}
              onChange={(e) => setEdits({ ...edits, to: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
            />
          </label>
          <label className="block">
            <span className="text-white/40 block mb-0.5">CC:</span>
            <input
              value={String(edits.cc || "")}
              onChange={(e) => setEdits({ ...edits, cc: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
            />
          </label>
          <label className="block">
            <span className="text-white/40 block mb-0.5">Subject:</span>
            <input
              value={String(edits.subject || "")}
              onChange={(e) => setEdits({ ...edits, subject: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80"
            />
          </label>
          <label className="block">
            <span className="text-white/40 block mb-0.5">Body (HTML):</span>
            <textarea
              value={String(edits.body_html || "")}
              onChange={(e) => setEdits({ ...edits, body_html: e.target.value })}
              rows={6}
              className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-white/80 font-mono text-[10px]"
            />
          </label>
        </div>
      )}

      {/* Sign link */}
      {action.sign_link && (
        <div className="mt-1.5 text-[11px]">
          <span className="text-white/30">Sign link:</span>{" "}
          <span className="text-blue-400">{action.sign_link}</span>
        </div>
      )}

      {/* Edit toggle for email drafts */}
      {action.draft && status === "pending" && action.action === "preview" && (
        <button
          onClick={editing ? () => { setEditing(false); setEdits({}); } : startEdit}
          className="text-[10px] text-blue-400 hover:text-blue-300 mt-2 mr-3"
        >
          {editing ? "Cancel edits" : "✎ Edit before approving"}
        </button>
      )}

      {/* Action buttons */}
      {status === "pending" && action.action === "preview" && (
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={handleApprove}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium py-1.5 rounded-lg transition-colors"
          >
            Approve & Send
          </button>
          <button
            onClick={handleDiscard}
            className="px-3 bg-white/5 hover:bg-white/10 text-white/50 text-[11px] py-1.5 rounded-lg transition-colors"
          >
            Discard
          </button>
        </div>
      )}

      {status === "approving" && (
        <div className="mt-2 text-[11px] text-amber-400 animate-pulse">Sending...</div>
      )}
    </div>
  );
}

export function ClaimBrainChat({
  claimId,
  claimAddress,
  carrier,
  variance,
  userId,
  filePath,
}: ClaimBrainChatProps) {
  const { locale } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<unknown>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  // Upload a single file to Supabase storage under the claim's chat-uploads folder.
  // Reuses the shared /api/storage/sign-upload + directUpload path used by other
  // uploaders in the app (same bucket, same auth check).
  const uploadFile = useCallback(async (file: File): Promise<string> => {
    if (!filePath) throw new Error("Claim file_path missing — cannot upload.");
    const res = await fetch("/api/storage/sign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: "chat-uploads",
        fileName: file.name,
        claimPath: filePath,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "sign-upload failed");
    await directUpload(data.signedUrl, file);
    return data.path as string;
  }, [filePath]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    const next: PendingAttachment[] = arr.map((file) => ({
      file,
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      uploading: true,
    }));
    setPending((prev) => [...prev, ...next]);
    next.forEach(async (att) => {
      try {
        const storage_path = await uploadFile(att.file);
        setPending((prev) => prev.map((p) => (p.id === att.id ? { ...p, uploading: false, storage_path } : p)));
      } catch (e) {
        setPending((prev) => prev.map((p) => (p.id === att.id ? { ...p, uploading: false, error: e instanceof Error ? e.message : "upload failed" } : p)));
      }
    });
  }, [uploadFile]);

  const removeAttachment = (id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  };

  // Voice input — Web Speech API. Mobile foreman use case: tap the mic,
  // speak "what did the carrier miss?", tap again to stop and send-to-input.
  // Safari + Chrome support both SpeechRecognition and webkitSpeechRecognition.
  const toggleVoice = useCallback(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      alert("Voice input isn't supported in this browser. Use Chrome or Safari.");
      return;
    }
    if (listening && recognitionRef.current) {
      try {
        (recognitionRef.current as { stop: () => void }).stop();
      } catch { /* ignore */ }
      setListening(false);
      return;
    }
    const recognition = new Ctor() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: { results: ArrayLike<{ [k: number]: { transcript: string }; isFinal: boolean }> }) => void;
      onerror: (e: { error: string }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = locale === "es" ? "es-US" : "en-US";

    let finalTranscript = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finalTranscript += res[0].transcript;
        } else {
          interim += res[0].transcript;
        }
      }
      setInput((finalTranscript + interim).trim());
    };
    recognition.onerror = (e) => {
      console.warn("[voice] error:", e.error);
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch (e) {
      console.warn("[voice] start failed:", e);
      setListening(false);
    }
  }, [listening, locale]);

  const scrollToBottom = useCallback(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Drop-to-attach creates an expectation that dragging files anywhere is safe.
  // Without this, a stray drop outside the panel triggers the browser's default
  // "open file in tab" behavior and navigates away from the claim.
  useEffect(() => {
    if (!isOpen) return;
    const prevent = (e: DragEvent) => { e.preventDefault(); };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, [isOpen]);

  // Stop any active SpeechRecognition when the chat panel closes or unmounts.
  // Without this the browser's mic indicator stays on after the user closes the
  // chat mid-dictation.
  useEffect(() => {
    if (!isOpen && recognitionRef.current) {
      try {
        (recognitionRef.current as { stop: () => void }).stop();
      } catch { /* ignore */ }
      setListening(false);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          (recognitionRef.current as { stop: () => void }).stop();
        } catch { /* ignore */ }
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/claim-brain/${claimId}/history`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages?: Array<{ role: string; content: string }> };
        if (cancelled || !data.messages?.length) return;
        const restored: Message[] = data.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        setMessages(restored);
      } catch {
        // Silent — fresh conversation is fine
      }
    };
    loadHistory();
    return () => { cancelled = true; };
  }, [claimId, BACKEND_URL]);

  // Proactive Richard — fetch suggestions whenever the chat opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/claim-brain/${claimId}/suggestions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSuggestions((data.suggestions || []) as Suggestion[]);
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [isOpen, claimId, BACKEND_URL]);

  const sendMessage = async (messageText?: string) => {
    const msg = messageText || input.trim();
    // Allow sending with attachments but no text — Richard will classify and ask.
    const hasAttachments = pending.some((p) => p.storage_path);
    if ((!msg && !hasAttachments) || isStreaming) return;
    if (pending.some((p) => p.uploading)) {
      // Wait for uploads — button should already be disabled, but guard anyway.
      return;
    }

    setInput("");
    setIsStreaming(true);

    // Freeze the attachments that made it into this message
    const readyAttachments = pending
      .filter((p) => p.storage_path && !p.error)
      .map((p) => ({ filename: p.file.name, storage_path: p.storage_path! }));

    setPending([]);

    const defaultMsg = !msg && readyAttachments.length > 0
      ? `Please review the ${readyAttachments.length} file${readyAttachments.length !== 1 ? "s" : ""} I just uploaded.`
      : msg;

    // Add user message
    const newMessages: Message[] = [...messages, {
      role: "user",
      content: defaultMsg,
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
    }];
    setMessages(newMessages);

    // Add placeholder for assistant
    const assistantIndex = newMessages.length;
    setMessages([...newMessages, { role: "assistant", content: "", toolActions: [] }]);

    try {
      const res = await fetch(
        `${BACKEND_URL}/api/claim-brain/${claimId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: defaultMsg,
            user_id: userId || null,
            locale: locale,
            attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
          }),
        }
      );

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullText = "";
      const toolActions: ToolAction[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                fullText += data.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = {
                    role: "assistant",
                    content: fullText,
                    toolActions: [...toolActions],
                  };
                  return updated;
                });
              }
              if (data.tool_action) {
                toolActions.push(data.tool_action as ToolAction);
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = {
                    role: "assistant",
                    content: fullText,
                    toolActions: [...toolActions],
                  };
                  return updated;
                });
              }
              if (data.error) {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = {
                    role: "assistant",
                    content: `Error: ${data.error}`,
                    toolActions: [],
                  };
                  return updated;
                });
              }
            } catch {
              // ignore parse errors on partial chunks
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = {
          role: "assistant",
          content: `Connection error: ${err instanceof Error ? err.message : "Unknown"}`,
          toolActions: [],
        };
        return updated;
      });
    }

    setIsStreaming(false);
    inputRef.current?.focus();
  };

  const resetChat = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/claim-brain/${claimId}/reset`, {
        method: "POST",
      });
    } catch {
      // ignore
    }
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleToolStatusUpdate = (approvalId: string, status: string) => {
    // Could log or update UI state if needed
    console.log(`Tool action ${approvalId}: ${status}`);
  };

  // Preload suggestions so the closed brain button can show a badge
  // if there are pending nudges (even before the panel is opened).
  useEffect(() => {
    if (isOpen) return;
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/claim-brain/${claimId}/suggestions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSuggestions((data.suggestions || []) as Suggestion[]);
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [isOpen, claimId, BACKEND_URL]);

  // Floating button when closed — with first-time tooltip + suggestion badge
  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-50 group">
        <div className="absolute bottom-full right-0 mb-2 w-52 bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-xl px-3 py-2 text-xs text-[var(--gray)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl">
          {suggestions.length > 0
            ? `${suggestions.length} suggestion${suggestions.length !== 1 ? "s" : ""} ready — click to see.`
            : "AI assistant that knows everything about this claim. Ask it anything."}
        </div>
        <button
          onClick={() => setIsOpen(true)}
          className="relative bg-[#0f1729] hover:bg-[#1a2540] text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 border border-white/10"
          title={suggestions.length > 0 ? `${suggestions.length} suggestion${suggestions.length !== 1 ? "s" : ""}` : "Open Claim Brain"}
        >
          <span className="text-2xl">🧠</span>
          {suggestions.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center border-2 border-[#0f1729]">
              {suggestions.length}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 w-[440px] h-[600px] bg-[#0f1729] rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-colors ${
        dragActive ? "border-2 border-dashed border-blue-400" : "border border-white/10"
      }`}
      onDragOver={(e) => {
        if (!filePath) return;
        e.preventDefault();
        e.stopPropagation();
        if (!dragActive) setDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only deactivate when we leave the outer container, not a child
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (!filePath) return;
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          addFiles(e.dataTransfer.files);
        }
      }}
    >
      {dragActive && (
        <div className="absolute inset-0 z-40 bg-blue-500/10 border-2 border-dashed border-blue-400 rounded-2xl flex items-center justify-center pointer-events-none">
          <div className="text-blue-300 text-sm font-medium">📎 Drop to attach</div>
        </div>
      )}
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#0a0f1e]">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <div>
            <div className="text-white text-sm font-semibold">Claim Brain</div>
            <div className="text-white/40 text-[10px]">
              {claimAddress || "Claim"} · {carrier}
              {variance && variance > 0 ? (
                <span className="text-emerald-400 ml-1">
                  +${variance.toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={resetChat}
            className="text-white/30 hover:text-white/60 text-xs px-2 py-1 rounded transition-colors"
            title="Reset conversation"
          >
            Reset
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-white/30 hover:text-white/60 w-7 h-7 flex items-center justify-center rounded transition-colors text-lg"
          >
            ×
          </button>
        </div>
      </div>

      {/* Chat messages */}
      <div ref={chatAreaRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="py-6">
            <div className="text-center mb-4">
              <div className="text-3xl mb-3">🧠</div>
              <div className="text-white text-sm font-medium mb-1">
                Claim Brain — Ready
              </div>
              <div className="text-white/40 text-xs max-w-[280px] mx-auto">
                I know every document, line item, and dollar on this claim. Ask me
                anything — or tell me to take action.
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="mb-4 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold px-1">
                  Suggestions for this claim
                </div>
                {suggestions.map((s, i) => (
                  <button
                    key={`${s.type}-${i}`}
                    onClick={() => sendMessage(s.prompt)}
                    className="w-full text-left p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] hover:bg-emerald-500/10 hover:border-emerald-500/40 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-lg leading-none">{s.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-emerald-300 font-semibold truncate">{s.title}</div>
                        <div className="text-[11px] text-white/60 mt-0.5">{s.description}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 justify-center">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => sendMessage(action.prompt)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-white/50 hover:text-blue-400 hover:border-blue-400/30 transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0 ${
                  msg.role === "assistant"
                    ? "bg-blue-500/10 border border-blue-500/20"
                    : "bg-emerald-500/10 border border-emerald-500/20"
                }`}
              >
                {msg.role === "assistant" ? "🧠" : "T"}
              </div>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white text-sm"
                    : "bg-white/5 border border-white/10 text-white/80"
                }`}
              >
                {msg.role === "assistant" ? (
                  <>
                    <div
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(msg.content),
                      }}
                      className={
                        isStreaming && i === messages.length - 1
                          ? "streaming-cursor"
                          : ""
                      }
                    />
                    {/* Batched approval — when an assistant turn produced 2+ previews, */}
                    {/* offer a single "Approve plan" button that walks them in sequence. */}
                    {(() => {
                      const previews = (msg.toolActions || []).filter(
                        (a) => a.action === "preview" && a.approval_id,
                      );
                      if (previews.length < 2) return null;
                      return (
                        <div className="mt-2 mb-1 flex items-center gap-2 rounded-lg bg-blue-500/[0.06] border border-blue-500/20 px-3 py-2">
                          <div className="flex-1">
                            <div className="text-xs font-semibold text-blue-300">
                              {previews.length}-step plan ready
                            </div>
                            <div className="text-[10px] text-white/50">
                              Approves each step in order. Stops on first error.
                            </div>
                          </div>
                          <button
                            disabled={bulkApproving}
                            onClick={async () => {
                              setBulkApproving(true);
                              // Mutate msg.toolActions IN PLACE so each card's
                              // individual buttons disable as we walk the plan.
                              // Accepts "dry_run" as a continue condition so
                              // dry-run mode doesn't halt the plan after step 1.
                              try {
                                for (const action of previews) {
                                  if (!action.approval_id) continue;
                                  const res = await fetch(
                                    `${BACKEND_URL}/api/claim-brain/${claimId}/approve-action`,
                                    {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        tool_call_id: action.approval_id,
                                        approved: true,
                                      }),
                                    },
                                  );
                                  const data = await res.json().catch(() => ({}));
                                  const ok =
                                    data.status === "sent" ||
                                    data.status === "complete" ||
                                    data.status === "dry_run";
                                  if (ok) {
                                    // Mark the card consumed so its approve/discard buttons disappear.
                                    action.action = "complete";
                                    handleToolStatusUpdate(
                                      action.approval_id,
                                      data.status === "dry_run" ? "dry_run" : "sent",
                                    );
                                  } else {
                                    console.warn(`[bulk-approve] step failed:`, action.tool_name, data);
                                    break;
                                  }
                                }
                                // Force a re-render so the in-place mutations show up
                                setMessages((prev) => [...prev]);
                              } finally {
                                setBulkApproving(false);
                              }
                            }}
                            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors"
                          >
                            {bulkApproving ? "Approving..." : `Approve plan (${previews.length})`}
                          </button>
                        </div>
                      );
                    })()}
                    {/* Tool action cards */}
                    {msg.toolActions && msg.toolActions.map((action, j) => (
                      <ToolActionCard
                        key={`${action.approval_id || j}`}
                        action={action}
                        claimId={claimId}
                        backendUrl={BACKEND_URL}
                        onStatusUpdate={handleToolStatusUpdate}
                      />
                    ))}
                  </>
                ) : (
                  <div>
                    <span className="text-sm">{msg.content}</span>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {msg.attachments.map((a, k) => (
                          <span
                            key={k}
                            className="inline-flex items-center gap-1 text-[10px] bg-white/10 text-white/80 px-1.5 py-0.5 rounded"
                          >
                            📎 {a.filename}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pending attachments strip */}
      {pending.length > 0 && (
        <div className="px-3 pt-2 border-t border-white/10 bg-[#0a0f1e]">
          <div className="flex flex-wrap gap-1.5">
            {pending.map((p) => (
              <div
                key={p.id}
                className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border ${
                  p.error
                    ? "bg-red-500/10 border-red-500/30 text-red-300"
                    : p.uploading
                    ? "bg-white/5 border-white/10 text-white/60"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                }`}
              >
                <span>{p.uploading ? "⏳" : p.error ? "⚠️" : "📎"}</span>
                <span className="truncate max-w-[180px]">{p.file.name}</span>
                <button
                  onClick={() => removeAttachment(p.id)}
                  className="ml-1 text-white/40 hover:text-white"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-3 border-t border-white/10 bg-[#0a0f1e]">
        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!filePath || isStreaming}
            title={filePath ? "Attach files" : "File attach unavailable — no claim path"}
            className="bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/60 w-9 h-9 rounded-xl flex items-center justify-center transition-colors text-lg flex-shrink-0"
          >
            📎
          </button>
          <button
            onClick={toggleVoice}
            disabled={isStreaming}
            title={listening ? "Stop listening" : "Dictate your question"}
            className={`disabled:opacity-30 w-9 h-9 rounded-xl flex items-center justify-center transition-colors text-lg flex-shrink-0 ${
              listening
                ? "bg-red-500/20 text-red-300 animate-pulse"
                : "bg-white/5 hover:bg-white/10 text-white/60"
            }`}
          >
            🎙️
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pending.length > 0 ? "Add a message (or send as-is)..." : "Ask about this claim — or drop a file..."}
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-blue-500/50 resize-none"
          />
          <button
            onClick={() => sendMessage()}
            disabled={
              isStreaming ||
              pending.some((p) => p.uploading) ||
              (!input.trim() && !pending.some((p) => p.storage_path))
            }
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-colors text-sm flex-shrink-0"
          >
            →
          </button>
        </div>
      </div>

      {/* Streaming cursor animation */}
      <style jsx global>{`
        .streaming-cursor > p:last-child::after,
        .streaming-cursor > ul:last-child > li:last-child::after {
          content: "▊";
          animation: blink 0.7s infinite;
          color: #4f8eff;
        }
        @keyframes blink {
          0%,
          50% {
            opacity: 1;
          }
          51%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
