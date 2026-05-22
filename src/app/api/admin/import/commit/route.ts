import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/import/commit
 * Body: { import_run_id: string }
 *
 * Reads the previously-staged rows from import_runs.summary.staged and
 * writes them in batches:
 *   - check_uploads (with import_run_id tag for rollback)
 *   - import_unmatched_rows (for triage)
 * Then flips import_runs.status = 'applied'.
 *
 * Idempotent: if status is already 'applied', returns the existing counts.
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

  const body = await req.json().catch(() => ({}));
  const importRunId: string | undefined = body.import_run_id;
  if (!importRunId) {
    return NextResponse.json({ error: "import_run_id is required" }, { status: 400 });
  }

  // Load the run; ensure it belongs to this company and is still in preview state.
  const { data: run, error: runErr } = await supabaseAdmin
    .from("import_runs")
    .select("*")
    .eq("id", importRunId)
    .maybeSingle();
  if (runErr || !run) {
    return NextResponse.json({ error: "Import run not found" }, { status: 404 });
  }
  if (run.company_id !== companyId) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (run.status === "applied") {
    return NextResponse.json({
      ok: true,
      already_applied: true,
      counts: {
        inserted: run.matched_count,
        unmatched: run.unmatched_count,
        dedup_skipped: run.dedup_count,
      },
    });
  }
  if (run.status === "rolled_back" || run.status === "failed") {
    return NextResponse.json(
      { error: `Cannot commit a ${run.status} run` },
      { status: 409 }
    );
  }
  if (run.kind !== "payments") {
    return NextResponse.json(
      { error: `Unsupported kind: ${run.kind}` },
      { status: 400 }
    );
  }

  const summary = (run.summary || {}) as {
    staged?: Array<Record<string, unknown> & { _dedup?: boolean }>;
    unmatched?: Array<Record<string, unknown>>;
    sheets?: string[];
  };
  const stagedAll = summary.staged || [];
  const unmatched = summary.unmatched || [];
  const stagedInsert = stagedAll.filter(r => !r._dedup);
  const dedupCount = stagedAll.length - stagedInsert.length;

  // Build check_uploads payloads
  const checkRows = stagedInsert.map(r => ({
    claim_id: r.claim_id as string,
    company_id: companyId,
    uploader_user_id: user.id,
    photo_path: null,
    amount_cents: r.amount_cents as number,
    received_at: r.received_at as string,
    source: r.source as string,
    payor: (r.payor as string | null) ?? null,
    external_ref: r.external_ref as string,
    notes: (r.notes as string | null) ?? null,
    import_run_id: importRunId,
  }));

  // Insert check_uploads in batches of 200.
  // Dedup is handled at preview time (_dedup flag), so a plain .insert() is
  // correct here. The unique index on (claim_id, amount_cents, received_at,
  // external_ref) WHERE external_ref IS NOT NULL is PARTIAL, and PostgREST's
  // on_conflict requires a non-partial constraint — using .upsert() here
  // raises 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
  // specification"). See /tmp/run_payments_backfill.py first failure.
  let inserted = 0;
  const insertErrors: Array<{ batch: number; error: string }> = [];
  const BATCH = 200;
  // Collect (check_upload_id, source_check_row) pairs so we can emit a
  // claim_events row per inserted check. Without this, the `$` icon on the
  // claims dashboard won't light up for imported checks — the icon reads
  // from claim_events.check_received, not check_uploads directly.
  type InsertedCheck = { id: string; claim_id: string; amount_cents: number; source: string; payor: string | null; received_at: string };
  const insertedChecks: InsertedCheck[] = [];
  for (let i = 0; i < checkRows.length; i += BATCH) {
    const batch = checkRows.slice(i, i + BATCH);
    const { data, error } = await supabaseAdmin
      .from("check_uploads")
      .insert(batch)
      .select("id, claim_id, amount_cents, source, payor, received_at");
    if (error) {
      insertErrors.push({ batch: i / BATCH, error: error.message });
    } else {
      inserted += (data || []).length;
      for (const row of data || []) insertedChecks.push(row as InsertedCheck);
    }
  }

  // Emit a claim_events row per inserted check so the dashboard `$` icon
  // lights up. Best-effort (don't fail the whole commit if event writes
  // fail — the check_uploads rows are the source of truth).
  if (insertedChecks.length > 0) {
    const eventRows = insertedChecks.map((c) => ({
      claim_id: c.claim_id,
      event_type: "check_received",
      event_category: "milestone",
      title: `Check received — $${(c.amount_cents / 100).toFixed(2)}`,
      metadata: {
        check_upload_id: c.id,
        source: c.source,
        payor: c.payor,
        amount_cents: c.amount_cents,
        import_run_id: importRunId,
      },
      occurred_at: c.received_at,
      created_by: user.id,
      source: "user",
    }));
    // Per-row insert because claim_events has a unique constraint on
    // (claim_id, event_type, occurred_at) — batched insert would roll back
    // every row in a batch if even one conflicts. Swallow 23505 (unique
    // violation) silently — it just means the $ icon is already lit for
    // that claim on that date, which is the desired end-state anyway.
    for (const row of eventRows) {
      const { error } = await supabaseAdmin.from("claim_events").insert(row);
      if (error && error.code !== "23505") {
        insertErrors.push({ batch: -2, error: `claim_events: ${error.message}` });
      }
    }
  }

  // Build unmatched rows
  const unmatchedRows = unmatched.map(u => ({
    import_run_id: importRunId,
    company_id: companyId,
    kind: "payments",
    raw: (u as { raw?: Record<string, unknown> }).raw ?? u,
    address: (u as { address?: string | null }).address ?? null,
    homeowner_name: (u as { homeowner_name?: string | null }).homeowner_name ?? null,
    payment_amount_cents:
      (u as { payment_amount_cents?: number | null }).payment_amount_cents ?? null,
    payment_date: (u as { payment_date?: string | null }).payment_date ?? null,
    carrier: (u as { carrier?: string | null }).carrier ?? null,
    job_number: (u as { job_number?: string | null }).job_number ?? null,
    claim_number: (u as { claim_number?: string | null }).claim_number ?? null,
    status: "pending",
  }));

  let unmatchedInserted = 0;
  if (unmatchedRows.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("import_unmatched_rows")
      .insert(unmatchedRows)
      .select("id");
    if (error) {
      insertErrors.push({ batch: -1, error: `unmatched: ${error.message}` });
    } else {
      unmatchedInserted = (data || []).length;
    }
  }

  // Flip the run status (or mark failed if everything errored)
  const newStatus = insertErrors.length > 0 && inserted === 0 ? "failed" : "applied";
  await supabaseAdmin
    .from("import_runs")
    .update({
      status: newStatus,
      matched_count: inserted,
      dedup_count: dedupCount,
      unmatched_count: unmatchedInserted,
      error_count: insertErrors.length,
      applied_at: newStatus === "applied" ? new Date().toISOString() : null,
      summary: {
        ...(run.summary || {}),
        // Trim staged off the persisted summary post-commit to save space;
        // keep unmatched references for traceability.
        staged: undefined,
        insert_errors: insertErrors,
      },
    })
    .eq("id", importRunId);

  return NextResponse.json({
    ok: newStatus === "applied",
    status: newStatus,
    counts: {
      inserted,
      unmatched: unmatchedInserted,
      dedup_skipped: dedupCount,
      errors: insertErrors.length,
    },
    insert_errors: insertErrors.slice(0, 10),
  });
}
