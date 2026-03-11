import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { FOLDER_TO_DB_FIELD } from "@/lib/claim-constants";

export async function POST(request: Request) {
  try {
    const { claimId, folder, fileName } = await request.json();

    if (!claimId || !folder || !fileName) {
      return NextResponse.json({ error: "Missing claimId, folder, or fileName" }, { status: 400 });
    }

    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Verify user is admin
    const { data: admin } = await supabaseAdmin
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .single();

    if (!admin) {
      return NextResponse.json({ error: "Unauthorized — admin only" }, { status: 403 });
    }

    // Fetch the claim to get file_path
    const { data: claim, error: claimError } = await supabaseAdmin
      .from("claims")
      .select("id, file_path")
      .eq("id", claimId)
      .single();

    if (claimError || !claim) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }

    // Delete the blob from storage
    const storagePath = `${claim.file_path}/${folder}/${fileName}`;
    const { error: removeError } = await supabaseAdmin.storage
      .from("claim-documents")
      .remove([storagePath]);

    if (removeError) {
      return NextResponse.json({ error: `Storage delete failed: ${removeError.message}` }, { status: 500 });
    }

    // Remove fileName from the DB field array
    const dbField = FOLDER_TO_DB_FIELD[folder];
    if (!dbField) {
      return NextResponse.json({ error: `Unknown folder: ${folder}` }, { status: 400 });
    }

    // Fetch current file list, filter out the deleted file, update
    const { data: currentClaim } = await supabaseAdmin
      .from("claims")
      .select(dbField)
      .eq("id", claimId)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentFiles: string[] = ((currentClaim as any)?.[dbField] as string[]) || [];
    const updatedFiles = currentFiles.filter((f) => f !== fileName);

    const { error: updateError } = await supabaseAdmin
      .from("claims")
      .update({ [dbField]: updatedFiles })
      .eq("id", claimId);

    if (updateError) {
      return NextResponse.json({ error: `DB update failed: ${updateError.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
