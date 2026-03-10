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
      return NextResponse.json({ error: "Missing signup id" }, { status: 400 });
    }

    // Get the beta signup record
    const { data: signup, error: fetchError } = await supabase
      .from("beta_signups")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !signup) {
      return NextResponse.json({ error: "Signup not found" }, { status: 404 });
    }

    // Create Supabase auth user via invite (sends them a "set password" email)
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      signup.email,
      {
        data: {
          full_name: signup.name,
          company_name: signup.company_name,
          role: signup.role,
          source: "beta_signup",
        },
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.dumbroof.ai"}/auth/callback`,
      }
    );

    if (inviteError) {
      // User might already have an auth account
      if (inviteError.message.includes("already been registered")) {
        // Still update status to invited
        await supabase
          .from("beta_signups")
          .update({ status: "invited" })
          .eq("id", id);

        return NextResponse.json({
          success: true,
          note: "User already has an account. Status updated to invited.",
        });
      }
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    // Update beta signup status to invited
    await supabase
      .from("beta_signups")
      .update({ status: "invited" })
      .eq("id", id);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invite failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
