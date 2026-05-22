/**
 * File readers — return { sheets: { [name]: rows[] } } for both CSV and XLSX.
 * CSV is treated as a single sheet named "Sheet1".
 */
import Papa from "papaparse";
import * as XLSX from "xlsx";

export type SheetRows = Record<string, unknown>[];
export type ParsedFile = {
  sheets: Record<string, SheetRows>;
  sheetNames: string[];
};

export function readCsv(text: string): ParsedFile {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false, // keep strings — we parse manually
    transformHeader: h => h.trim(),
  });
  return {
    sheets: { Sheet1: parsed.data as SheetRows },
    sheetNames: ["Sheet1"],
  };
}

export function readXlsx(buf: ArrayBuffer | Buffer): ParsedFile {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheets: Record<string, SheetRows> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    // header: 1 returns array-of-arrays; we want array-of-objects with headers
    // from row 1. raw: false converts dates to strings (we parse them ourselves).
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw: false,
    });
    sheets[name] = rows;
  }
  return { sheets, sheetNames: wb.SheetNames };
}

/**
 * Auto-detect the file format from filename + magic bytes.
 * Returns null if unrecognized.
 */
export function readFile(
  filename: string,
  bytes: ArrayBuffer
): ParsedFile | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    const text = new TextDecoder().decode(bytes);
    return readCsv(text);
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return readXlsx(bytes);
  }
  // Magic-byte fallback — XLSX is a ZIP (PK\x03\x04).
  const arr = new Uint8Array(bytes);
  if (arr[0] === 0x50 && arr[1] === 0x4b) return readXlsx(bytes);
  // Otherwise assume CSV-ish text.
  try {
    const text = new TextDecoder().decode(bytes);
    return readCsv(text);
  } catch {
    return null;
  }
}

/**
 * Pick which sheet(s) to import from a multi-sheet XLSX.
 * Default: every sheet that has both an "Address" column and at least one
 * payment-like column (Payments Collected / Ledger Check Details / Amount).
 */
export function pickPaymentSheets(file: ParsedFile): string[] {
  const out: string[] = [];
  for (const name of file.sheetNames) {
    const rows = file.sheets[name];
    if (!rows || rows.length === 0) continue;
    const headers = new Set(Object.keys(rows[0]).map(h => h.toLowerCase().trim()));
    const hasAddr =
      headers.has("address") ||
      headers.has("street") ||
      headers.has("street address") ||
      headers.has("location address");
    const hasPayment =
      headers.has("ledger check details") ||
      headers.has("payments collected") ||
      headers.has("amount") ||
      headers.has("payment amount") ||
      headers.has("total paid") ||
      headers.has("total paid\n(lockdown)");
    if (hasAddr && hasPayment) out.push(name);
  }
  return out;
}
