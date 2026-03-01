import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
}

export async function POST(request: Request) {
  try {
    const { folder, fileName, claimPath } = await request.json();

    if (!folder || !fileName || !claimPath) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify the user is authenticated
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Verify the claimPath starts with the user's ID
    if (!claimPath.startsWith(user.id + "/")) {
      return NextResponse.json({ error: "Unauthorized path" }, { status: 403 });
    }

    const safeName = sanitizeFileName(fileName);
    const fullPath = `${claimPath}/${folder}/${safeName}`;

    // Create signed upload URL using admin client (bypasses RLS)
    const { data, error } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUploadUrl(fullPath);

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
