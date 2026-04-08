import type { CheckResult, Grade, ClaimQuality } from "./types";

/**
 * QA check pipeline for the daily document quality cron.
 *
 * Each check returns a CheckResult with:
 *   - name: human-readable check name
 *   - passed: boolean
 *   - severity: "critical" | "warning" | "info"
 *   - message: explanation of pass or fail
 *
 * Source of truth ported from ~/USARM-Claims-Platform/.claude/commands/qa-audit.md
 * (the manual /qa-audit slash command). Any change to a check here should be
 * mirrored in the slash command — they are designed to produce the same output.
 */

/* ----------------------------------------------------------------------------
 * Single-claim check pipeline
 * ------------------------------------------------------------------------- */

/** Shape of the row pulled from the `claims` table — only fields we read. */
export type ClaimRow = {
  id: string;
  slug: string | null;
  address: string | null;
  carrier: string | null;
  status: string;
  phase: string | null;
  contractor_rcv: number | null;
  current_carrier_rcv: number | null;
  original_carrier_rcv: number | null;
  report_mode: string | null;
  output_files: unknown;
  trade_count: number | null;
  o_and_p_enabled: boolean | null;
  tax_rate: number | null;
  weather_data: unknown;
  scope_comparison: unknown;
  roof_sections: unknown;
  estimate_request: unknown;
  measurement_files: unknown;
  scope_files: unknown;
  photo_files: unknown;
  damage_score: number | null;
  damage_grade: string | null;
  approval_score: number | null;
  approval_grade: string | null;
  error_message: string | null;
  last_processed_at: string;
};

/** Helper: extract state code from a US address string. */
function extractState(address: string | null): string | null {
  if (!address) return null;
  // Match 2-letter state code followed by space + zip OR end of string
  const match = address.match(/,\s*([A-Z]{2})\s+\d{5}|,\s*([A-Z]{2})$/i);
  if (match) return (match[1] || match[2] || "").toUpperCase();
  return null;
}

/** Helper: count items in a JSONB array column safely. */
function jsonbArrayLength(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  return 0;
}

/** Helper: read a JSONB object property safely. */
function jsonbProp(v: unknown, key: string): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return (v as Record<string, unknown>)[key];
  }
  return undefined;
}

/* ----------------------------------------------------------------------------
 * Individual checks
 * ------------------------------------------------------------------------- */

function checkContractorRcv(claim: ClaimRow): CheckResult {
  const rcv = Number(claim.contractor_rcv ?? 0);
  if (claim.report_mode === "forensic_only") {
    return {
      name: "contractor_rcv",
      passed: true,
      severity: "info",
      message: "Forensic-only mode — RCV not required",
    };
  }
  if (rcv <= 0) {
    return {
      name: "contractor_rcv",
      passed: false,
      severity: "critical",
      message: `contractor_rcv is ${rcv} — claim has no estimated value`,
    };
  }
  if (rcv > 1_000_000) {
    return {
      name: "contractor_rcv",
      passed: false,
      severity: "warning",
      message: `contractor_rcv is ${rcv.toLocaleString()} — unusually high, verify`,
    };
  }
  return {
    name: "contractor_rcv",
    passed: true,
    severity: "info",
    message: `RCV $${rcv.toLocaleString()}`,
  };
}

function checkRcvVsRoofArea(claim: ClaimRow): CheckResult {
  const rcv = Number(claim.contractor_rcv ?? 0);
  const roofSq = Number(jsonbProp(claim.roof_sections, "total_area_sq") ?? 0);

  if (claim.report_mode === "forensic_only" || rcv <= 0 || roofSq <= 0) {
    return {
      name: "rcv_per_sq",
      passed: true,
      severity: "info",
      message: "Skipped (no measurements or forensic-only)",
    };
  }
  const perSq = rcv / roofSq;
  // Loose sanity bounds: $200/SQ to $5,000/SQ. Below = scope way too thin,
  // above = something double-counted.
  if (perSq < 200) {
    return {
      name: "rcv_per_sq",
      passed: false,
      severity: "warning",
      message: `RCV per SQ is $${perSq.toFixed(0)} (${roofSq} SQ × $${perSq.toFixed(0)} = $${rcv.toFixed(0)}). Likely missing line items.`,
    };
  }
  if (perSq > 5000) {
    return {
      name: "rcv_per_sq",
      passed: false,
      severity: "warning",
      message: `RCV per SQ is $${perSq.toFixed(0)} (${roofSq} SQ × $${perSq.toFixed(0)} = $${rcv.toFixed(0)}). Likely double-counted.`,
    };
  }
  return {
    name: "rcv_per_sq",
    passed: true,
    severity: "info",
    message: `$${perSq.toFixed(0)}/SQ across ${roofSq} SQ`,
  };
}

function checkOandP(claim: ClaimRow): CheckResult {
  const tradeCount = claim.trade_count ?? 0;
  const enabled = claim.o_and_p_enabled ?? false;
  if (claim.report_mode === "forensic_only") {
    return {
      name: "o_and_p",
      passed: true,
      severity: "info",
      message: "Skipped (forensic-only)",
    };
  }
  if (tradeCount >= 3 && !enabled) {
    return {
      name: "o_and_p",
      passed: false,
      severity: "critical",
      message: `${tradeCount} trades but O&P NOT enabled — should be 10/11 (overhead/profit)`,
    };
  }
  if (tradeCount < 3 && enabled) {
    return {
      name: "o_and_p",
      passed: false,
      severity: "warning",
      message: `Only ${tradeCount} trades but O&P enabled — should be off when <3 trades`,
    };
  }
  return {
    name: "o_and_p",
    passed: true,
    severity: "info",
    message: `${tradeCount} trades, O&P ${enabled ? "enabled" : "disabled"} — correct`,
  };
}

function checkTaxRate(claim: ClaimRow): CheckResult {
  const state = extractState(claim.address);
  const expected: Record<string, number> = {
    NY: 0.08,
    PA: 0.0,
    NJ: 0.06625,
  };
  const expectedRate = state ? expected[state] : null;
  const actual = Number(claim.tax_rate ?? 0);

  if (expectedRate == null) {
    return {
      name: "tax_rate",
      passed: true,
      severity: "info",
      message: state ? `State ${state} — no tax rule (verify manually)` : "State unknown",
    };
  }
  if (Math.abs(actual - expectedRate) > 0.0001) {
    return {
      name: "tax_rate",
      passed: false,
      severity: "warning",
      message: `Tax rate ${(actual * 100).toFixed(3)}% but ${state} should be ${(expectedRate * 100).toFixed(3)}%`,
    };
  }
  return {
    name: "tax_rate",
    passed: true,
    severity: "info",
    message: `${(actual * 100).toFixed(2)}% (${state})`,
  };
}

function checkOutputFiles(claim: ClaimRow): CheckResult {
  const files = Array.isArray(claim.output_files) ? (claim.output_files as string[]) : [];
  const phase = claim.phase || "pre-scope";
  const mode = claim.report_mode || "standard";

  // Forensic-only: should have document #1
  if (mode === "forensic_only") {
    const hasForensic = files.some((f) => /01|forensic/i.test(f));
    if (!hasForensic) {
      return {
        name: "output_files",
        passed: false,
        severity: "critical",
        message: `Forensic-only mode but no Forensic Causation Report in output_files (${files.length} files)`,
      };
    }
    return {
      name: "output_files",
      passed: true,
      severity: "info",
      message: `Forensic-only — ${files.length} files`,
    };
  }

  // Pre-scope: 3 docs minimum
  // Post-scope: 5 docs
  const minExpected = phase === "post-scope" ? 5 : 3;
  if (files.length < minExpected) {
    return {
      name: "output_files",
      passed: false,
      severity: "critical",
      message: `${phase} should have ≥${minExpected} PDFs, has ${files.length}`,
    };
  }
  return {
    name: "output_files",
    passed: true,
    severity: "info",
    message: `${files.length} files (${phase})`,
  };
}

function checkScopeComparison(claim: ClaimRow): CheckResult {
  const phase = claim.phase || "pre-scope";
  if (phase !== "post-scope") {
    return {
      name: "scope_comparison",
      passed: true,
      severity: "info",
      message: "Skipped (pre-scope)",
    };
  }
  const rows = jsonbArrayLength(claim.scope_comparison);
  if (rows === 0) {
    return {
      name: "scope_comparison",
      passed: false,
      severity: "critical",
      message: "Post-scope claim has empty scope_comparison — extraction failed",
    };
  }
  if (rows < 5) {
    return {
      name: "scope_comparison",
      passed: false,
      severity: "warning",
      message: `Only ${rows} scope comparison rows — likely incomplete`,
    };
  }
  return {
    name: "scope_comparison",
    passed: true,
    severity: "info",
    message: `${rows} comparison rows`,
  };
}

function checkWeatherData(claim: ClaimRow): CheckResult {
  const eventCount = Number(jsonbProp(claim.weather_data, "event_count") ?? 0);
  if (eventCount === 0) {
    return {
      name: "weather_data",
      passed: false,
      severity: "warning",
      message: "No weather events attached — date_of_loss may not match NOAA records",
    };
  }
  return {
    name: "weather_data",
    passed: true,
    severity: "info",
    message: `${eventCount} weather event(s) attached`,
  };
}

function checkErrorMessage(claim: ClaimRow): CheckResult {
  if (claim.error_message) {
    return {
      name: "error_message",
      passed: false,
      severity: "critical",
      message: `error_message set: ${claim.error_message.slice(0, 120)}`,
    };
  }
  return {
    name: "error_message",
    passed: true,
    severity: "info",
    message: "No errors",
  };
}

function checkRoofSectionsBug(claim: ClaimRow): CheckResult {
  const sections = jsonbProp(claim.roof_sections, "sections");
  if (!Array.isArray(sections)) {
    return {
      name: "roof_sections_dedup",
      passed: true,
      severity: "info",
      message: "No sections to check",
    };
  }
  // Check for the historic "tripling bug" — same section repeated identically
  const seen = new Set<string>();
  for (const section of sections) {
    const sig = JSON.stringify(section);
    if (seen.has(sig)) {
      return {
        name: "roof_sections_dedup",
        passed: false,
        severity: "critical",
        message: "Duplicate roof_sections detected — possible tripling bug regression",
      };
    }
    seen.add(sig);
  }
  return {
    name: "roof_sections_dedup",
    passed: true,
    severity: "info",
    message: `${sections.length} unique sections`,
  };
}

function checkEstimateRequest(claim: ClaimRow): CheckResult {
  if (claim.report_mode === "forensic_only") {
    return {
      name: "estimate_request",
      passed: true,
      severity: "info",
      message: "Skipped (forensic-only)",
    };
  }
  const roofMaterial = jsonbProp(claim.estimate_request, "roof_material");
  if (!roofMaterial) {
    return {
      name: "estimate_request",
      passed: false,
      severity: "warning",
      message: "estimate_request missing roof_material",
    };
  }
  return {
    name: "estimate_request",
    passed: true,
    severity: "info",
    message: `${roofMaterial}`,
  };
}

function checkDamageScore(claim: ClaimRow): CheckResult {
  if (claim.damage_score == null) {
    return {
      name: "damage_score",
      passed: false,
      severity: "warning",
      message: "damage_score not computed",
    };
  }
  return {
    name: "damage_score",
    passed: true,
    severity: "info",
    message: `${claim.damage_score}/100 (${claim.damage_grade || "?"})`,
  };
}

/* ----------------------------------------------------------------------------
 * Pipeline + grading
 * ------------------------------------------------------------------------- */

const ALL_CHECKS = [
  checkContractorRcv,
  checkRcvVsRoofArea,
  checkOandP,
  checkTaxRate,
  checkOutputFiles,
  checkScopeComparison,
  checkWeatherData,
  checkErrorMessage,
  checkRoofSectionsBug,
  checkEstimateRequest,
  checkDamageScore,
];

/**
 * Run all checks against a single claim row, then grade it A/B/C/F.
 *
 *   A — every check passed
 *   B — passed but 1-2 warnings (no criticals)
 *   C — 1 critical fail OR 3+ warnings
 *   F — 2+ critical fails
 */
export function gradeClaim(claim: ClaimRow): ClaimQuality {
  const checks = ALL_CHECKS.map((fn) => fn(claim));

  let critFailed = 0;
  let warnFailed = 0;
  let passed = 0;
  let topIssue: string | null = null;

  for (const c of checks) {
    if (c.passed) {
      passed++;
    } else if (c.severity === "critical") {
      critFailed++;
      if (!topIssue) topIssue = `${c.name}: ${c.message}`;
    } else if (c.severity === "warning") {
      warnFailed++;
      if (!topIssue) topIssue = `${c.name}: ${c.message}`;
    }
  }

  let grade: Grade;
  if (critFailed >= 2) grade = "F";
  else if (critFailed === 1 || warnFailed >= 3) grade = "C";
  else if (warnFailed >= 1) grade = "B";
  else grade = "A";

  return {
    claim_id: claim.id,
    slug: claim.slug || claim.id,
    address: claim.address || "(no address)",
    carrier: claim.carrier || "(no carrier)",
    contractor_rcv: Number(claim.contractor_rcv ?? 0),
    phase: claim.phase || "unknown",
    status: claim.status,
    last_processed_at: claim.last_processed_at,
    grade,
    passed_count: passed,
    warned_count: warnFailed,
    failed_count: critFailed,
    top_issue: topIssue,
    checks,
  };
}
