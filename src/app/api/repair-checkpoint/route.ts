import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
}

export async function POST(request: Request) {
  try {
    const { fileName, repairPath, checkpointNumber } = await request.json();

    if (!fileName || !repairPath || !checkpointNumber) {
      return NextResponse.json(
        { error: "Missing required fields: fileName, repairPath, checkpointNumber" },
        { status: 400 }
      );
    }

    // Verify the user is authenticated
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Verify the repairPath starts with the user's ID
    if (!repairPath.startsWith(user.id + "/")) {
      return NextResponse.json({ error: "Unauthorized path" }, { status: 403 });
    }

    const safeName = sanitizeFileName(fileName);
    const fullPath = `${repairPath}/checkpoints/cp${checkpointNumber}/${safeName}`;

    // Create signed upload URL using admin client (bypasses RLS)
    const { data, error } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUploadUrl(fullPath, { upsert: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: fullPath,
      safeName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
