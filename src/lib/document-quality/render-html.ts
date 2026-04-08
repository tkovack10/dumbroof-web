import type { DocumentQualityReport, ClaimQuality, Grade } from "./types";

const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtMoney = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

function gradeStyle(grade: Grade): { bg: string; fg: string; label: string } {
  switch (grade) {
    case "A":
      return { bg: "#dcfce7", fg: "#166534", label: "A" };
    case "B":
      return { bg: "#dbeafe", fg: "#1e40af", label: "B" };
    case "C":
      return { bg: "#fef3c7", fg: "#92400e", label: "C" };
    case "F":
      return { bg: "#fee2e2", fg: "#991b1b", label: "F" };
  }
}

export function renderReportHtml(report: DocumentQualityReport): string {
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

  // Top: aggregate grade summary tiles
  const grades = report.grades;
  const tilesHtml = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;">
      ${[
        { grade: "A" as Grade, count: grades.A },
        { grade: "B" as Grade, count: grades.B },
        { grade: "C" as Grade, count: grades.C },
        { grade: "F" as Grade, count: grades.F },
      ]
        .map((t) => {
          const s = gradeStyle(t.grade);
          return `<div style="flex:1;min-width:80px;background:${s.bg};border:1px solid ${s.fg}33;border-radius:10px;padding:14px 12px;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:${s.fg};line-height:1;">${t.count}</div>
            <div style="font-size:11px;font-weight:700;color:${s.fg};margin-top:4px;letter-spacing:0.05em;">GRADE ${t.grade}</div>
          </div>`;
        })
        .join("")}
    </div>
  `;

  // Critical issues banner (cross-cutting)
  const criticalHtml =
    report.critical_issues.length === 0
      ? ""
      : `<div style="background:#fee2e2;border-left:4px solid #991b1b;padding:14px 18px;border-radius:10px;font-size:13px;margin:0 0 18px;">
          <div style="font-size:11px;font-weight:700;color:#991b1b;letter-spacing:0.05em;margin-bottom:6px;">CRITICAL CROSS-CUTTING ISSUES</div>
          <ul style="margin:0;padding-left:18px;color:#7f1d1d;">
            ${report.critical_issues.map((i) => `<li>${escape(i)}</li>`).join("")}
          </ul>
        </div>`;

  // Per-claim table
  const claimsTableHtml =
    report.claim_grades.length === 0
      ? `<div style="background:#f3f4f6;border:1px solid #e5e7eb;color:#6b7280;padding:24px;border-radius:10px;text-align:center;font-size:14px;">No claims processed in this window.</div>`
      : `<table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="text-align:left;padding:8px 10px;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Grade</th>
              <th style="text-align:left;padding:8px 10px;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Slug</th>
              <th style="text-align:left;padding:8px 10px;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Carrier</th>
              <th style="text-align:right;padding:8px 10px;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">RCV</th>
              <th style="text-align:left;padding:8px 10px;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Top Issue</th>
            </tr>
          </thead>
          <tbody>
            ${report.claim_grades
              .map((c) => {
                const s = gradeStyle(c.grade);
                return `<tr style="border-bottom:1px solid #f3f4f6;">
                  <td style="padding:10px;"><span style="display:inline-block;background:${s.bg};color:${s.fg};font-weight:700;font-size:11px;padding:3px 8px;border-radius:5px;">${s.label}</span></td>
                  <td style="padding:10px;color:#1f2937;font-family:monospace;font-size:11px;">${escape(c.slug)}</td>
                  <td style="padding:10px;color:#6b7280;font-size:11px;">${escape(c.carrier.slice(0, 28))}</td>
                  <td style="padding:10px;color:#1f2937;text-align:right;font-family:monospace;">${fmtMoney(c.contractor_rcv)}</td>
                  <td style="padding:10px;color:#6b7280;font-size:11px;">${escape(c.top_issue || "All checks passed")}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>`;

  // Deep-dive section: full check list for any C or F claims
  const deepDiveClaims = report.claim_grades.filter((c) => c.grade === "C" || c.grade === "F");
  const deepDiveHtml =
    deepDiveClaims.length === 0
      ? ""
      : `<div style="margin-top:24px;">
          <div style="font-size:11px;font-weight:700;color:#991b1b;letter-spacing:0.05em;margin-bottom:10px;">FAILED CLAIMS — FULL CHECK BREAKDOWN</div>
          ${deepDiveClaims
            .map((c) => {
              const s = gradeStyle(c.grade);
              return `<div style="background:#ffffff;border:1px solid ${s.fg}33;border-left:4px solid ${s.fg};border-radius:8px;padding:14px 16px;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                  <span style="display:inline-block;background:${s.bg};color:${s.fg};font-weight:700;font-size:11px;padding:3px 8px;border-radius:5px;">${s.label}</span>
                  <span style="font-family:monospace;font-size:11px;color:#1f2937;">${escape(c.slug)}</span>
                  <span style="font-size:11px;color:#6b7280;">${escape(c.carrier)}</span>
                </div>
                <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">${escape(c.address)}</div>
                <ul style="margin:0;padding-left:18px;font-size:11px;color:#374151;">
                  ${c.checks
                    .filter((ch) => !ch.passed)
                    .map(
                      (ch) =>
                        `<li><strong>${escape(ch.name)}:</strong> ${escape(ch.message)}</li>`
                    )
                    .join("")}
                </ul>
              </div>`;
            })
            .join("")}
        </div>`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:24px;">
    <div style="background:linear-gradient(135deg,#0d2137 0%,#1a3a5c 100%);padding:24px 28px;border-radius:12px 12px 0 0;">
      <h1 style="color:#ffffff;font-size:22px;margin:0;">DumbRoof Document Quality Report</h1>
      <p style="color:#b5d0e8;font-size:13px;margin:6px 0 0;">${windowLabel}</p>
      <p style="color:#b5d0e8;font-size:12px;margin:4px 0 0;">${report.claims_reviewed} claim${report.claims_reviewed === 1 ? "" : "s"} reviewed in this window</p>
    </div>
    <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
      ${tilesHtml}
      ${criticalHtml}
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:6px;margin:0 0 14px;">
        ${claimsTableHtml}
      </div>
      ${deepDiveHtml}
      <div style="font-size:11px;color:#9ca3af;margin-top:18px;text-align:center;">
        Generated in ${report.duration_ms}ms · <a href="https://www.dumbroof.ai/dashboard/admin" style="color:#3b82f6;">Admin Dashboard</a>
      </div>
    </div>
  </div>
</body></html>`;
}
