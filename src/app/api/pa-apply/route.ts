import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, phone, company_name, license_number, states_covered, experience, specialties, notes } = body;

    if (!name || !email) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }

    if (!states_covered || states_covered.length === 0) {
      return NextResponse.json({ error: "At least one state must be selected" }, { status: 400 });
    }

    const { error: dbError } = await getSb()
      .from("pa_applications")
      .insert({
        name,
        email,
        phone: phone || null,
        company_name: company_name || null,
        license_number: license_number || null,
        states_covered: states_covered || [],
        experience: experience || null,
        specialties: specialties || [],
        notes: notes || null,
      });

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Submission failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
