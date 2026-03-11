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

    // Verify user is admin (instead of checking path ownership)
    const { data: admin } = await supabaseAdmin
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .single();

    if (!admin) {
      return NextResponse.json({ error: "Unauthorized — admin only" }, { status: 403 });
    }

    const safeName = sanitizeFileName(fileName);
    const fullPath = `${claimPath}/${folder}/${safeName}`;

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
