import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// POST /api/instant-intake/claim
//
// Auth-required handoff after the user signs up via /signup?next=/instant/continue.
// Reads the dr_instant_token + dr_instant_funnel cookies (set by the public
// /api/instant-intake/upload during the anonymous funnel), creates a real claim
// row owned by the now-authenticated user, and moves the staged files from
// `claim-documents/anon-instant-intake/{token}/...` into the canonical
// `{user_id}/{slug}/{folder}/...` layout the rest of the app expects.

const COOKIE_TOKEN = "dr_instant_token";
const COOKIE_FUNNEL = "dr_instant_funnel";
const COOKIE_DOL = "dr_instant_dol";
const COOKIE_DAMAGE = "dr_instant_damage_type";
const ANON_PREFIX = "anon-instant-intake";
const BUCKET = "claim-documents";

type Funnel = "forensic" | "supplement";

function shortToken(): string {
  // 8-char base36 — collisions effectively impossible at our claim volume,
  // and the slug stays short and readable in URLs / Supabase.
  return Math.random().toString(36).slice(2, 10);
}

export async function POST() {
  const jar = await cookies();
  const token = jar.get(COOKIE_TOKEN)?.value;
  const funnelRaw = jar.get(COOKIE_FUNNEL)?.value;
  if (!token || (funnelRaw !== "forensic" && funnelRaw !== "supplement")) {
    return NextResponse.json(
      { error: "No staged upload found — start at /instant-forensic or /instant-supplement" },
      { status: 400 }
    );
  }
  const funnel = funnelRaw as Funnel;
  const dol = jar.get(COOKIE_DOL)?.value || null;
  const damageType = jar.get(COOKIE_DAMAGE)?.value || null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // List all staged files for this token
  const { data: stagedRoot, error: listErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(`${ANON_PREFIX}/${token}`, { limit: 100 });
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const subfolders = (stagedRoot || [])
    .filter((entry) => entry.id === null) // null id == folder in Supabase storage
    .map((entry) => entry.name);

  type StagedFile = { folder: string; name: string };
  const allStaged: StagedFile[] = [];
  for (const folder of subfolders) {
    const { data: files } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(`${ANON_PREFIX}/${token}/${folder}`, { limit: 100 });
    for (const f of files || []) {
      if (f.id !== null) allStaged.push({ folder, name: f.name });
    }
  }

  if (allStaged.length === 0) {
    return NextResponse.json(
      { error: "Upload session expired — please re-upload from the funnel" },
      { status: 410 }
    );
  }

  // Build slug + canonical path
  const slug = `instant-${funnel}-${shortToken()}`;
  const claimPath = `${user.id}/${slug}`;

  // Move (copy + delete) every staged file into canonical location
  const movedByFolder: Record<string, string[]> = {};
  for (const item of allStaged) {
    const fromPath = `${ANON_PREFIX}/${token}/${item.folder}/${item.name}`;
    const toPath = `${claimPath}/${item.folder}/${item.name}`;
    const { error: moveErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .move(fromPath, toPath);
    if (moveErr) {
      // Fall back to copy + ignore — better to land the user with their files
      // accessible at the staged path than to fail the whole handoff.
      console.error(`[instant-intake/claim] move failed ${fromPath} -> ${toPath}:`, moveErr.message);
      continue;
    }
    if (!movedByFolder[item.folder]) movedByFolder[item.folder] = [];
    movedByFolder[item.folder].push(item.name);
  }

  // Compose the claim insert. Phase = "pre-scope" matches the new-claim default.
  // Status = "uploaded" so the dashboard shows it the same as a normal upload.
  // Address starts as a placeholder — the dashboard will prompt the user to fill it.
  // Funnel source is recorded in user_notes (no schema change required for v1).
  const intakeNote =
    funnel === "forensic"
      ? `[instant-forensic funnel] DOL=${dol ?? "unspecified"} damage=${damageType ?? "unspecified"}`
      : `[instant-supplement funnel]`;

  const insertPayload: Record<string, unknown> = {
    user_id: user.id,
    address: "Pending — please update",
    carrier: "",
    slug,
    phase: "pre-scope",
    status: "uploaded",
    file_path: claimPath,
    measurement_files: movedByFolder.measurements || null,
    photo_files: movedByFolder.photos || null,
    scope_files: movedByFolder.scope || null,
    user_notes: intakeNote,
    ...(dol ? { date_of_loss: dol } : {}),
    ...(funnel === "forensic" && damageType
      ? {
          estimate_request: {
            damage_type: damageType,
          },
        }
      : {}),
    ...(funnel === "forensic" ? { report_mode: "forensic_only" } : {}),
  };

  const { data: inserted, error: dbError } = await supabaseAdmin
    .from("claims")
    .insert(insertPayload)
    .select("id, slug")
    .single();

  if (dbError) {
    return NextResponse.json({ error: `Claim insert failed: ${dbError.message}` }, { status: 500 });
  }

  // Clear the funnel cookies so a stale token doesn't double-claim on a
  // subsequent visit.
  jar.delete(COOKIE_TOKEN);
  jar.delete(COOKIE_FUNNEL);
  jar.delete(COOKIE_DOL);
  jar.delete(COOKIE_DAMAGE);

  return NextResponse.json({
    ok: true,
    claim_id: inserted.id,
    slug: inserted.slug,
    funnel,
  });
}
