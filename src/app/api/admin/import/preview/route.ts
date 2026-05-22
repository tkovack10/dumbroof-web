import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readFile, pickPaymentSheets } from "@/lib/importers/read-file";
import { buildPaymentsPreview } from "@/lib/importers/payments-importer";

export const runtime = "nodejs";       // xlsx needs Node, not Edge
export const maxDuration = 60;          // up to 60s for big files

/**
 * POST /api/admin/import/preview
 * Multipart form-data with:
 *   - file: the CSV/XLSX
 *   - kind: 'payments' | 'installs'
 *   - sheets?: comma-separated sheet names to import (XLSX only; defaults to auto-pick)
 *
 * Returns a preview { staged, unmatched, counts } WITHOUT writing to the DB.
 * Also creates an import_runs row with status='preview' so commit can reference it.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_admin || !profile.company_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profile.company_id;

  const form = await req.formData();
  const fileBlob = form.get("file");
  const kind = String(form.get("kind") || "");
  const sheetsCsv = (form.get("sheets") as string | null) || "";

  if (!(fileBlob instanceof Blob)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (kind !== "payments" && kind !== "installs") {
    return NextResponse.json(
      { error: "kind must be 'payments' or 'installs'" },
      { status: 400 }
    );
  }
  if (kind === "installs") {
    // Installs CSV path coming after Phase 1.5 (AccuLynx live sync ships first).
    return NextResponse.json(
      { error: "Installs CSV import lands after the AccuLynx live sync (Phase 1.5)." },
      { status: 501 }
    );
  }

  const filename =
    (fileBlob as File).name ||
    (form.get("filename") as string | null) ||
    "upload";

  const bytes = await fileBlob.arrayBuffer();
  const parsed = readFile(filename, bytes);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse file — expected CSV or XLSX" },
      { status: 400 }
    );
  }

  // Pick sheets — explicit param wins, else auto-detect.
  let sheetNames: string[];
  if (sheetsCsv) {
    sheetNames = sheetsCsv
      .split(",")
      .map(s => s.trim())
      .filter(s => parsed.sheetNames.includes(s));
  } else {
    sheetNames = pickPaymentSheets(parsed);
  }
  if (sheetNames.length === 0) {
    return NextResponse.json(
      {
        error:
          "No importable sheets found. Need at least one sheet with an Address column and a payment column.",
        available_sheets: parsed.sheetNames,
      },
      { status: 400 }
    );
  }

  // Fetch this company's claims for address matching.
  const { data: claims, error: claimsErr } = await supabaseAdmin
    .from("claims")
    .select("id, slug, address, company_id, claim_number, homeowner_name")
    .eq("company_id", companyId)
    .limit(5000);
  if (claimsErr) {
    return NextResponse.json({ error: claimsErr.message }, { status: 500 });
  }

  const preview = buildPaymentsPreview({
    file: parsed,
    sheetNames,
    claims: claims || [],
    companyId,
    sourceFilename: filename,
  });

  // Dedup: check which staged rows would conflict with existing check_uploads
  // by external_ref. Mark them so the commit can skip them.
  const refs = preview.staged.map(r => r.external_ref);
  let dedupSet = new Set<string>();
  if (refs.length > 0) {
    const { data: existing } = await supabaseAdmin
      .from("check_uploads")
      .select("external_ref")
      .eq("company_id", companyId)
      .in("external_ref", refs);
    dedupSet = new Set((existing || []).map(r => r.external_ref as string));
  }
  const dedupCount = preview.staged.filter(r => dedupSet.has(r.external_ref)).length;
  const willInsert = preview.staged.length - dedupCount;

  // Create the import_runs row (status='preview') so commit can reference it.
  const { data: runRow, error: runErr } = await supabaseAdmin
    .from("import_runs")
    .insert({
      company_id: companyId,
      created_by: user.id,
      kind: "payments",
      source: filename.toLowerCase().endsWith(".csv") ? "csv" : "xlsx",
      source_filename: filename,
      row_count: preview.counts.total_source_rows,
      matched_count: willInsert,
      dedup_count: dedupCount,
      unmatched_count: preview.unmatched.length,
      status: "preview",
      summary: {
        sheets: preview.counts.sheets_processed,
        total_checks_parsed: preview.counts.total_checks_parsed,
        // Persist the staged rows + unmatched rows so commit just reads them back
        // (saves the user from re-uploading the file).
        staged: preview.staged.map(r => ({
          ...r,
          _dedup: dedupSet.has(r.external_ref),
        })),
        unmatched: preview.unmatched,
      },
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return NextResponse.json(
      { error: runErr?.message || "Could not create import run" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    import_run_id: runRow.id,
    counts: {
      ...preview.counts,
      will_insert: willInsert,
      will_dedup: dedupCount,
    },
    // Send back a trimmed staged view + the unmatched rows so the user can
    // review before commit. (Full data also persisted in import_runs.summary.)
    staged_preview: preview.staged.slice(0, 50).map(r => ({
      ...r,
      _dedup: dedupSet.has(r.external_ref),
    })),
    unmatched_preview: preview.unmatched.slice(0, 100),
  });
}
