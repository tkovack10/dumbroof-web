import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const users = (data?.users || []).map((u) => ({
      id: u.id,
      email: u.email || "",
    }));

    return NextResponse.json(users);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
