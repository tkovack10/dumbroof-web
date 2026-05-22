/**
 * Payments importer — orchestrates parse → match → dedup → stage for commit.
 *
 * Input:  a ParsedFile (one or more sheets of payment rows) + the company's claim list.
 * Output: { runRows[] for production_schedules/check_uploads, unmatched[], summary }
 *
 * NOTE: this module is pure (no DB writes). The /api/admin/import/preview
 * route runs this on every preview AND every commit; commit additionally
 * writes the run rows to the DB inside a transaction. Same code path means
 * preview shows exactly what commit will do.
 */
import { matchAddress, indexClaims, type Claim } from "./address-matcher";
import {
  parseLedgerCheckDetails,
  parsePaymentRow,
  type ParsedCheck,
} from "./parse-payments";
import type { ParsedFile, SheetRows } from "./read-file";

export type StagedCheckRow = {
  claim_id: string;
  company_id: string;
  amount_cents: number;
  received_at: string;
  payor: string | null;
  source: ParsedCheck["source"];
  external_ref: string;
  notes: string | null;
  // For preview UI only — not written to DB:
  _match_note?: string;
  _source_sheet: string;
  _source_row_index: number;
};

export type UnmatchedRow = {
  sheet: string;
  row_index: number;
  raw: Record<string, unknown>;
  reason: "no_addr_key" | "no_candidates" | "ambiguous" | "no_parseable_checks";
  // Extracted convenience fields for the triage UI:
  address: string | null;
  homeowner_name: string | null;
  carrier: string | null;
  job_number: string | null;
  claim_number: string | null;
  payment_amount_cents: number | null;
  payment_date: string | null;
  match_candidates?: Array<{ id: string; address: string }>;
};

export type PreviewSummary = {
  staged: StagedCheckRow[];
  unmatched: UnmatchedRow[];
  counts: {
    total_source_rows: number;
    total_checks_parsed: number;
    matched_checks: number;
    unmatched_rows: number;
    sheets_processed: string[];
  };
};

/* ─────────── Header name resolution ─────────── */

const HEADER_ALIASES = {
  address: ["Address", "Street", "Street Address", "Location Address", "address"],
  city: ["City", "city"],
  customer: ["Customer", "Homeowner", "Customer Name", "Insured", "homeowner_name"],
  carrier: ["Carrier", "Insurance Company", "carrier"],
  claim_number: ["Claim #", "Claim Number", "claim_number", "Claim#"],
  job_number: ["Job #", "Job Number", "Job#", "job_number"],
  ledger_details: ["Ledger Check Details", "Check Details", "Ledger Details"],
  // Per-row mode:
  amount: ["Amount", "Payment Amount", "Check Amount", "payment_amount"],
  date: ["Date", "Payment Date", "Check Date", "Received Date", "received_at"],
  payor: ["Payor", "Payer", "From", "payor"],
  check_number: ["Check #", "Check Number", "check_number"],
  source: ["Source", "Payment Source", "source"],
};

function pickHeader(
  row: Record<string, unknown>,
  aliases: string[]
): string | null {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const hit = keys.find(k => k.trim().toLowerCase() === alias.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/* ─────────── Main entry point ─────────── */

export function buildPaymentsPreview(args: {
  file: ParsedFile;
  sheetNames: string[];
  claims: Claim[];
  companyId: string;
  sourceFilename: string;
}): PreviewSummary {
  const { file, sheetNames, claims, companyId, sourceFilename } = args;
  const byKey = indexClaims(claims);

  const staged: StagedCheckRow[] = [];
  const unmatched: UnmatchedRow[] = [];
  let totalRows = 0;
  let totalChecks = 0;

  for (const sheetName of sheetNames) {
    const rows = file.sheets[sheetName] || [];
    if (!rows.length) continue;
    const sampleRow = rows[0];

    const colAddress = pickHeader(sampleRow, HEADER_ALIASES.address);
    const colCustomer = pickHeader(sampleRow, HEADER_ALIASES.customer);
    const colCarrier = pickHeader(sampleRow, HEADER_ALIASES.carrier);
    const colClaim = pickHeader(sampleRow, HEADER_ALIASES.claim_number);
    const colJob = pickHeader(sampleRow, HEADER_ALIASES.job_number);
    const colLedger = pickHeader(sampleRow, HEADER_ALIASES.ledger_details);
    const colAmount = pickHeader(sampleRow, HEADER_ALIASES.amount);
    const colDate = pickHeader(sampleRow, HEADER_ALIASES.date);
    const colPayor = pickHeader(sampleRow, HEADER_ALIASES.payor);
    const colCheck = pickHeader(sampleRow, HEADER_ALIASES.check_number);
    const colSource = pickHeader(sampleRow, HEADER_ALIASES.source);

    if (!colAddress) continue;

    rows.forEach((row, i) => {
      totalRows++;
      const rowKey = `${sourceFilename}:${sheetName}:row${i + 2}`; // +2 = 1-based + header
      const address = strOrNull(row[colAddress]);
      if (!address) return;

      const sourceClaim = colClaim ? strOrNull(row[colClaim]) : null;
      const carrier = colCarrier ? strOrNull(row[colCarrier]) : null;
      const homeowner = colCustomer ? strOrNull(row[colCustomer]) : null;
      const jobNumber = colJob ? strOrNull(row[colJob]) : null;

      // Parse the payments out of this row (returns 0..N checks)
      let checks: ParsedCheck[] = [];
      if (colLedger) {
        checks = parseLedgerCheckDetails(strOrNull(row[colLedger]), rowKey);
      }
      // Fallback: per-row columns
      if (!checks.length && colAmount && colDate) {
        const single = parsePaymentRow(
          {
            amount: row[colAmount] as number | string | null,
            date: strOrNull(row[colDate]),
            payor: colPayor ? strOrNull(row[colPayor]) : null,
            check_number: colCheck ? strOrNull(row[colCheck]) : null,
            source: colSource ? strOrNull(row[colSource]) : null,
          },
          rowKey
        );
        if (single) checks = [single];
      }

      if (!checks.length) {
        // No parseable checks — but if there's a homeowner/address we still
        // want this on the radar (could be a job with $0 payments worth tracking).
        // For now: skip silently. We can revisit if Tom wants empty-payment rows surfaced.
        return;
      }

      totalChecks += checks.length;

      // Match the row's address to a claim
      const match = matchAddress(address, sourceClaim, byKey, claims);

      if (match.status === "matched") {
        for (const chk of checks) {
          staged.push({
            claim_id: match.claim.id,
            company_id: companyId,
            amount_cents: chk.amount_cents,
            received_at: chk.received_at,
            payor: chk.payor,
            source: chk.source,
            external_ref: chk.external_ref,
            notes:
              `Imported from ${sourceFilename} (${sheetName} row ${i + 2})` +
              (chk.check_number ? `\nCheck #: ${chk.check_number}` : ""),
            _match_note: match.note,
            _source_sheet: sheetName,
            _source_row_index: i,
          });
        }
        return;
      }

      // Unmatched / ambiguous — persist for triage
      // For aggregate row → use first parsed check for the convenience fields.
      const firstCheck = checks[0];
      unmatched.push({
        sheet: sheetName,
        row_index: i,
        raw: row as Record<string, unknown>,
        reason: match.status === "ambiguous" ? "ambiguous" : match.reason as any,
        address,
        homeowner_name: homeowner,
        carrier,
        job_number: jobNumber,
        claim_number: sourceClaim,
        payment_amount_cents: firstCheck.amount_cents,
        payment_date: firstCheck.received_at,
        match_candidates:
          match.status === "ambiguous"
            ? match.candidates.map(c => ({ id: c.id, address: c.address }))
            : undefined,
      });
    });
  }

  return {
    staged,
    unmatched,
    counts: {
      total_source_rows: totalRows,
      total_checks_parsed: totalChecks,
      matched_checks: staged.length,
      unmatched_rows: unmatched.length,
      sheets_processed: sheetNames,
    },
  };
}
