import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessRepair } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const { searchParams } = new URL(req.url);
  const offset = parseInt(searchParams.get("offset") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");

  // Fetch repairs (ready status only — those with completed diagnoses)
  const [repairsRes, feedbackRes] = await Promise.all([
    supabaseAdmin
      .from("repairs")
      .select("id, address, homeowner_name, repair_type, severity, total_price, file_path, photo_files, leak_description, created_at, status, output_files", { count: "exact" })
      .eq("user_id", auth.user.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    supabaseAdmin
      .from("diagnosis_feedback")
      .select("repair_id, status")
      .eq("user_id", auth.user.id),
  ]);

  if (repairsRes.error) {
    return NextResponse.json({ error: repairsRes.error.message }, { status: 500 });
  }

  const repairs = repairsRes.data || [];
  const feedbackMap = new Map(
    (feedbackRes.data || []).map((f: { repair_id: string; status: string }) => [f.repair_id, f.status])
  );

  // Sign photo URLs for each repair (first photo only for preview)
  const pathsToSign: string[] = [];
  const repairPhotoIdx: Map<number, number> = new Map();

  repairs.forEach((repair, idx) => {
    const firstPhoto = repair.photo_files?.[0];
    if (firstPhoto && repair.file_path) {
      repairPhotoIdx.set(pathsToSign.length, idx);
      pathsToSign.push(`${repair.file_path}/photos/${firstPhoto}`);
    }
  });

  const signedUrlMap = new Map<number, string>();
  if (pathsToSign.length > 0) {
    const { data: signedData } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUrls(pathsToSign, 3600);

    if (signedData) {
      signedData.forEach((item, i) => {
        if (item.signedUrl) {
          const repairIdx = repairPhotoIdx.get(i);
          if (repairIdx !== undefined) {
            signedUrlMap.set(repairIdx, item.signedUrl);
          }
        }
      });
    }
  }

  const result = repairs.map((repair, idx) => ({
    ...repair,
    photo_url: signedUrlMap.get(idx) || null,
    feedback_status: feedbackMap.get(repair.id) || null,
  }));

  return NextResponse.json({
    repairs: result,
    total: repairsRes.count || 0,
    reviewed: feedbackRes.data?.length || 0,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { repair_id, status, corrected_repair_type, corrected_severity, notes, actual_leak_source, actual_repair_performed } = body;

  if (!repair_id || !status) {
    return NextResponse.json({ error: "repair_id and status required" }, { status: 400 });
  }

  if (!["confirmed", "corrected", "wrong"].includes(status)) {
    return NextResponse.json({ error: "status must be confirmed, corrected, or wrong" }, { status: 400 });
  }

  // Verify ownership
  const authorized = await canAccessRepair(userId, repair_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized for this repair" }, { status: 403 });
  }

  // Get original repair data for the feedback record
  const { data: repair } = await supabaseAdmin
    .from("repairs")
    .select("repair_type, severity")
    .eq("id", repair_id)
    .single();

  const { error } = await supabaseAdmin.from("diagnosis_feedback").upsert(
    {
      repair_id,
      user_id: userId,
      status,
      original_repair_type: repair?.repair_type || null,
      corrected_repair_type: corrected_repair_type || null,
      original_severity: repair?.severity || null,
      corrected_severity: corrected_severity || null,
      notes: notes || null,
      actual_leak_source: actual_leak_source || null,
      actual_repair_performed: actual_repair_performed || null,
    },
    { onConflict: "repair_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
