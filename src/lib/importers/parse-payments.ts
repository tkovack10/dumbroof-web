/**
 * Payments parser — turns a CSV/XLSX row into 0..N individual payment records.
 *
 * Supports two formats:
 *   A. "Ledger Check Details" string format (Tom's NY_Scope_Install.xlsx):
 *      "$14,504.53 07/31/25 State Farm Fire & Casualty; $10,547.00 09/15/25 NBT Bank"
 *      → array of {amount_cents, received_at, payor}
 *
 *   B. Per-row columns (date / amount / payor / check_number / source).
 *      Used when the spreadsheet has one row per check (Kristen's NY Ledger style).
 */

export type ParsedCheck = {
  amount_cents: number;
  received_at: string;          // ISO YYYY-MM-DD
  payor: string | null;
  check_number?: string | null;
  source: "insurance" | "homeowner" | "stripe_invoice" | "other";
  external_ref: string;         // for dedup — stable across re-imports
};

/* ─────────────── A. Ledger string parser ─────────────── */

const CHECK_REGEX =
  /\$\s*([\d,]+\.?\d*)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([^;]+?)(?=\s*(?:;|$))/g;

/** Convert "07/31/25" → "2025-07-31"; "07/31/2025" → "2025-07-31". */
export function parseMixedDate(s: string): string | null {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  let yyyy = m[3];
  if (yyyy.length === 2) {
    // 2-digit year: assume 20xx for everything (no rollover concern for our window).
    yyyy = `20${yyyy}`;
  }
  // Sanity bound
  const yi = parseInt(yyyy, 10);
  if (yi < 2000 || yi > 2099) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Classify the payor string into a check_uploads.source enum value. */
export function classifyPayor(payor: string): ParsedCheck["source"] {
  const p = payor.toLowerCase();
  if (
    /insurance|insur|state farm|allstate|liberty|nationwide|travelers|geico|preferred mutual|erie|usaa|nycm|amfam|amguard|amgaurd|farmers|metlife|chubb|homesite|safeco|progressive|hartford|amica|fire & casualty/.test(p)
  ) {
    return "insurance";
  }
  if (/stripe/.test(p)) return "stripe_invoice";
  // Banks + personal checks → homeowner is the right enum slot
  if (
    /bank|fcu|federal credit union|broadview|m&t|nbt|visions|personal check|cash|homeowner/.test(p)
  ) {
    return "homeowner";
  }
  return "other";
}

/**
 * Parse a "Ledger Check Details" string into 0..N checks.
 * Example input:
 *   "$14,504.53 07/31/25 State Farm Fire & Casualty; $10,547.00 09/15/25 NBT Bank"
 *
 * @param details   the raw string
 * @param rowKey    a stable key for the source row (e.g. "ny_scope_install:row12")
 *                  used to seed external_ref so dedup works across re-uploads
 */
export function parseLedgerCheckDetails(
  details: string | null | undefined,
  rowKey: string
): ParsedCheck[] {
  if (!details || typeof details !== "string") return [];
  const out: ParsedCheck[] = [];
  let idx = 0;
  // Reset regex state for each call
  const re = new RegExp(CHECK_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(details)) !== null) {
    idx++;
    const amountStr = m[1].replace(/,/g, "");
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const dateIso = parseMixedDate(m[2]);
    if (!dateIso) continue;

    const payor = (m[3] || "").trim();
    out.push({
      amount_cents: Math.round(amount * 100),
      received_at: dateIso,
      payor: payor || null,
      source: classifyPayor(payor),
      external_ref: `${rowKey}:check${idx}`,
    });
  }
  return out;
}

/* ─────────────── B. Per-row parser ─────────────── */

export type PaymentRowInput = {
  amount?: number | string | null;
  date?: string | null;
  payor?: string | null;
  check_number?: string | null;
  source?: string | null;
};

export function parsePaymentRow(
  row: PaymentRowInput,
  rowKey: string
): ParsedCheck | null {
  // Amount
  let amount: number;
  if (typeof row.amount === "number") {
    amount = row.amount;
  } else if (typeof row.amount === "string") {
    const cleaned = row.amount.replace(/[^0-9.-]/g, "");
    amount = parseFloat(cleaned);
  } else {
    return null;
  }
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // Date
  let dateIso: string | null = null;
  if (row.date) {
    dateIso =
      parseMixedDate(row.date) ||
      (typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.date)
        ? row.date.slice(0, 10)
        : null);
  }
  if (!dateIso) return null;

  const payor = row.payor ? String(row.payor).trim() : null;
  const source = (() => {
    if (row.source) {
      const s = String(row.source).toLowerCase();
      if (s === "insurance" || s === "homeowner" || s === "stripe_invoice" || s === "other") {
        return s as ParsedCheck["source"];
      }
    }
    return payor ? classifyPayor(payor) : "other";
  })();

  return {
    amount_cents: Math.round(amount * 100),
    received_at: dateIso,
    payor,
    check_number: row.check_number ? String(row.check_number) : null,
    source,
    external_ref: row.check_number
      ? `check:${row.check_number}`
      : `${rowKey}:check1`,
  };
}
