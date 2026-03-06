import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: Request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Missing application id" }, { status: 400 });
    }

    const { data: app, error: fetchError } = await supabase
      .from("inspector_applications")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !app) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      app.email,
      {
        data: {
          full_name: app.name,
          role: "inspector",
          source: "inspector_application",
        },
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://dumbroof.ai"}/auth/callback`,
      }
    );

    if (inviteError) {
      if (inviteError.message.includes("already been registered")) {
        await supabase
          .from("inspector_applications")
          .update({ status: "invited" })
          .eq("id", id);

        return NextResponse.json({
          success: true,
          note: "User already has an account. Status updated to invited.",
        });
      }
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    await supabase
      .from("inspector_applications")
      .update({ status: "invited" })
      .eq("id", id);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invite failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
