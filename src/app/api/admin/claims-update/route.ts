import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ALLOWED_FIELDS = new Set([
  "measurement_files",
  "scope_files",
  "photo_files",
  "weather_files",
  "other_files",
  "status",
  "phase",
]);

export async function POST(request: Request) {
  try {
    const { claimId, updates } = await request.json();

    if (!claimId || !updates || typeof updates !== "object") {
      return NextResponse.json({ error: "Missing claimId or updates" }, { status: 400 });
    }

    // Authenticate user via session cookies
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Verify user is admin (instead of checking claim ownership)
    const { data: admin } = await supabaseAdmin
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .single();

    if (!admin) {
      return NextResponse.json({ error: "Unauthorized — admin only" }, { status: 403 });
    }

    // Verify claim exists
    const { data: claim, error: claimError } = await supabaseAdmin
      .from("claims")
      .select("id")
      .eq("id", claimId)
      .single();

    if (claimError || !claim) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }

    // Whitelist fields
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.has(key)) {
        filtered[key] = value;
      }
    }

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin
      .from("claims")
      .update(filtered)
      .eq("id", claimId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update claim";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
