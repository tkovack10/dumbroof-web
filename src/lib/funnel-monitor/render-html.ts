import type { FunnelReport, Anomaly } from "./types";

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtPct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function severityColor(sev: Anomaly["severity"]): { bg: string; fg: string; label: string } {
  if (sev === "critical") return { bg: "#fee2e2", fg: "#991b1b", label: "CRITICAL" };
  if (sev === "warning") return { bg: "#fef3c7", fg: "#92400e", label: "WARNING" };
  return { bg: "#dbeafe", fg: "#1e40af", label: "INFO" };
}

export function renderReportHtml(report: FunnelReport): string {
  const windowLabel = `${new Date(report.window_start).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} → ${new Date(report.window_end).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ET`;

  const anomalyHtml =
    report.anomalies.length === 0
      ? `<div style="background:#dcfce7;border:1px solid #86efac;color:#166534;padding:14px 18px;border-radius:10px;font-size:14px;margin:0 0 24px;"><strong>✓ No anomalies detected.</strong> Funnel is healthy.</div>`
      : `<div style="margin:0 0 24px;">${report.anomalies
          .map((a) => {
            const c = severityColor(a.severity);
            return `<div style="background:${c.bg};border-left:4px solid ${c.fg};padding:12px 16px;margin-bottom:8px;border-radius:6px;"><div style="font-size:11px;font-weight:700;color:${c.fg};letter-spacing:0.05em;margin-bottom:4px;">${c.label} · ${escape(a.code)}</div><div style="font-size:14px;color:#1f2937;">${escape(a.message)}</div></div>`;
          })
          .join("")}</div>`;

  // AI insight (markdown -> very basic HTML)
  const aiInsightHtml = report.ai_insight
    ? `<div style="background:linear-gradient(135deg,#ede9fe 0%,#dbeafe 100%);border:1px solid #c4b5fd;padding:18px 22px;border-radius:12px;margin:0 0 24px;"><div style="font-size:11px;font-weight:700;color:#6d28d9;letter-spacing:0.05em;margin-bottom:8px;">🧠 AI INSIGHT</div><div style="font-size:14px;color:#1f2937;line-height:1.6;white-space:pre-wrap;">${escape(report.ai_insight)}</div></div>`
    : "";

  const supabaseHtml = report.supabase
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:0.05em;margin-bottom:10px;">SIGNUPS &amp; UPLOADS</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px;">
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.supabase.signups_count}</div><div style="font-size:11px;color:#6b7280;">new signups</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.supabase.uploads_count}</div><div style="font-size:11px;color:#6b7280;">new uploads</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.supabase.active_users_24h}</div><div style="font-size:11px;color:#6b7280;">active users (24h)</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.supabase.zero_claim_users}</div><div style="font-size:11px;color:#6b7280;">users w/ 0 claims</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${fmtPct(report.supabase.cohort_week1_retention)}</div><div style="font-size:11px;color:#6b7280;">Wk1 retention</div></div>
      </div>
      ${
        report.supabase.recent_signups.length > 0
          ? `<div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px;">NEW SIGNUPS (${report.supabase.recent_signups.length})</div><table style="width:100%;font-size:12px;border-collapse:collapse;">
              ${report.supabase.recent_signups
                .map(
                  (s) =>
                    `<tr><td style="padding:4px 8px 4px 0;color:#1f2937;">${escape(s.email)}</td><td style="padding:4px 0;color:#6b7280;">${escape(s.provider)}</td><td style="padding:4px 0;color:#6b7280;">${escape(s.signup_source || "—")}</td></tr>`
                )
                .join("")}
            </table>`
          : ""
      }
      ${
        report.supabase.recent_claims.length > 0
          ? `<div style="font-size:11px;font-weight:700;color:#6b7280;margin:14px 0 6px;">NEW CLAIMS (${report.supabase.recent_claims.length})</div><table style="width:100%;font-size:12px;border-collapse:collapse;">
              ${report.supabase.recent_claims
                .map(
                  (c) =>
                    `<tr><td style="padding:4px 8px 4px 0;color:#1f2937;">${escape(c.slug)}</td><td style="padding:4px 0;color:#6b7280;">${escape(c.user_email)}</td><td style="padding:4px 0;color:#1f2937;font-weight:600;">$${c.contractor_rcv.toLocaleString()}</td><td style="padding:4px 0;color:#6b7280;">${escape(c.status)}</td></tr>`
                )
                .join("")}
            </table>`
          : ""
      }
    </div>`
    : "";

  const resendHtml = report.resend
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:0.05em;margin-bottom:10px;">EMAIL DELIVERY</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;">
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.resend.total_sent}</div><div style="font-size:11px;color:#6b7280;">sent</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${fmtPct(report.resend.delivery_rate)}</div><div style="font-size:11px;color:#6b7280;">delivered</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${fmtPct(report.resend.open_rate)}</div><div style="font-size:11px;color:#6b7280;">opened</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${fmtPct(report.resend.click_rate)}</div><div style="font-size:11px;color:#6b7280;">clicked</div></div>
        <div><div style="font-size:24px;font-weight:700;color:${report.resend.bounced > 0 ? "#dc2626" : "#1f2937"};">${report.resend.bounced}</div><div style="font-size:11px;color:#6b7280;">bounced</div></div>
        <div><div style="font-size:24px;font-weight:700;color:${report.resend.complained > 0 ? "#dc2626" : "#1f2937"};">${report.resend.complained}</div><div style="font-size:11px;color:#6b7280;">spam</div></div>
      </div>
    </div>`
    : "";

  const stripeHtml = report.stripe
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:0.05em;margin-bottom:10px;">STRIPE</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;">
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.stripe.new_subscriptions}</div><div style="font-size:11px;color:#6b7280;">new subs</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${fmtMoney(report.stripe.mrr_delta_cents)}</div><div style="font-size:11px;color:#6b7280;">MRR delta</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.stripe.active_subscriptions}</div><div style="font-size:11px;color:#6b7280;">active total</div></div>
        <div><div style="font-size:24px;font-weight:700;color:${report.stripe.failed_payments > 0 ? "#dc2626" : "#1f2937"};">${report.stripe.failed_payments}</div><div style="font-size:11px;color:#6b7280;">failed payments</div></div>
      </div>
    </div>`
    : "";

  const vercelHtml = report.vercel_analytics
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:0.05em;margin-bottom:10px;">VERCEL ANALYTICS</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;">
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.vercel_analytics.visitors}</div><div style="font-size:11px;color:#6b7280;">visitors</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.vercel_analytics.page_views}</div><div style="font-size:11px;color:#6b7280;">page views</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${fmtPct(report.vercel_analytics.bounce_rate)}</div><div style="font-size:11px;color:#6b7280;">bounce rate</div></div>
      </div>
    </div>`
    : "";

  const metaHtml = report.meta_ads
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:0.05em;margin-bottom:10px;">META ADS</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px;">
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${fmtMoney(report.meta_ads.total_spend_24h_cents)}</div><div style="font-size:11px;color:#6b7280;">spend</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.meta_ads.total_conversions_24h}</div><div style="font-size:11px;color:#6b7280;">conversions</div></div>
      </div>
      ${
        report.meta_ads.campaigns.length > 0
          ? `<table style="width:100%;font-size:12px;border-collapse:collapse;">
              <tr style="color:#6b7280;font-weight:700;font-size:11px;"><td>CAMPAIGN</td><td>SPEND</td><td>CONV</td><td>CPA</td></tr>
              ${report.meta_ads.campaigns
                .map(
                  (c) =>
                    `<tr><td style="padding:4px 8px 4px 0;color:#1f2937;">${escape(c.name)}</td><td style="padding:4px 0;color:#1f2937;">${fmtMoney(c.spend_cents)}</td><td style="padding:4px 0;color:#1f2937;">${c.conversions}</td><td style="padding:4px 0;color:#1f2937;">${c.cost_per_conversion_cents != null ? fmtMoney(c.cost_per_conversion_cents) : "—"}</td></tr>`
                )
                .join("")}
            </table>`
          : ""
      }
    </div>`
    : "";

  const railwayHtml = report.railway
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:0.05em;margin-bottom:10px;">RAILWAY BACKEND</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;">
        <div><div style="font-size:18px;font-weight:700;color:${report.railway.status === "ok" ? "#059669" : "#dc2626"};">${report.railway.status.toUpperCase()}</div><div style="font-size:11px;color:#6b7280;">status</div></div>
        ${report.railway.cpu_percent != null ? `<div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.railway.cpu_percent.toFixed(0)}%</div><div style="font-size:11px;color:#6b7280;">CPU</div></div>` : ""}
        ${report.railway.process_memory_mb != null ? `<div><div style="font-size:24px;font-weight:700;color:#1f2937;">${report.railway.process_memory_mb.toFixed(0)} MB</div><div style="font-size:11px;color:#6b7280;">process mem</div></div>` : ""}
      </div>
    </div>`
    : "";

  const sourcesNote =
    report.sources_failed.length > 0
      ? `<div style="font-size:11px;color:#9ca3af;margin-top:14px;">Sources skipped or failed: ${report.sources_failed.join(", ")}</div>`
      : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:24px;">
    <div style="background:linear-gradient(135deg,#0d2137 0%,#1a3a5c 100%);padding:24px 28px;border-radius:12px 12px 0 0;">
      <h1 style="color:#ffffff;font-size:22px;margin:0;">DumbRoof Funnel Report</h1>
      <p style="color:#b5d0e8;font-size:13px;margin:6px 0 0;">${windowLabel}</p>
    </div>
    <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
      ${aiInsightHtml}
      ${anomalyHtml}
      ${supabaseHtml}
      ${resendHtml}
      ${stripeHtml}
      ${vercelHtml}
      ${metaHtml}
      ${railwayHtml}
      <div style="font-size:11px;color:#9ca3af;margin-top:18px;text-align:center;">
        Generated in ${report.duration_ms}ms · Sources: ${report.sources_succeeded.join(", ")}
        ${sourcesNote}
      </div>
      <div style="font-size:11px;color:#9ca3af;margin-top:8px;text-align:center;">
        <a href="https://www.dumbroof.ai/dashboard/admin" style="color:#3b82f6;">View Admin Dashboard</a>
      </div>
    </div>
  </div>
</body></html>`;
}
