import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

const ALLOWED_COLUMNS = ["coc_files", "aob_files"];

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { claim_id, column, filename } = await req.json();

  if (!claim_id || !column || !filename) {
    return NextResponse.json({ error: "claim_id, column, and filename required" }, { status: 400 });
  }

  if (!ALLOWED_COLUMNS.includes(column)) {
    return NextResponse.json({ error: "Invalid column" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Get current files array, append if not already present
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select(column)
    .eq("id", claim_id)
    .single();

  const raw = claim?.[column];
  const currentFiles: string[] = Array.isArray(raw) ? raw : [];
  if (!currentFiles.includes(filename)) {
    currentFiles.push(filename);
    await supabaseAdmin
      .from("claims")
      .update({ [column]: currentFiles })
      .eq("id", claim_id);
  }

  return NextResponse.json({ ok: true, files: currentFiles });
}
