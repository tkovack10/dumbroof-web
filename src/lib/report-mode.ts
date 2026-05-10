// Predicates and labels for the claim `report_mode` enum.
//
// Background: report_mode controls which subset of the 5-doc PDF package is
// generated.
//   "full"            — default; everything (forensic, estimate, comparison,
//                       supplement letter, cover).
//   "forensic_only"   — photos arrived but no measurements; only PDF #1.
//   "supplement_only" — measurements + scope arrived but no photos; PDFs #2-5
//                       (drops the forensic causation report).
// Both forensic_only and supplement_only are "minimal" modes — the dashboard
// renders a smaller surface for them. Use isMinimalReportMode() instead of
// fanned-out string-equality checks so a future third minimal mode is one
// edit, not a grep-and-add across the whole frontend.

export type ReportMode = "full" | "forensic_only" | "supplement_only" | string | null | undefined;

export function isMinimalReportMode(mode: ReportMode): boolean {
  return mode === "forensic_only" || mode === "supplement_only";
}

export function isForensicOnly(mode: ReportMode): boolean {
  return mode === "forensic_only";
}

export function isSupplementOnly(mode: ReportMode): boolean {
  return mode === "supplement_only";
}

export function reportModeLabel(mode: ReportMode): string | null {
  if (mode === "forensic_only") return "Forensic Only";
  if (mode === "supplement_only") return "Supplement Only";
  return null;
}
