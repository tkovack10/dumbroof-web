import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { QAReviewQueue } from "./qa-review-queue";

export const dynamic = "force-dynamic";

export default async function QAReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: admin } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .limit(1);

  if (!admin || admin.length === 0) redirect("/dashboard");

  const { data: claims } = await supabaseAdmin
    .from("claims")
    .select("id, slug, address, carrier, status, qa_audit_flags, last_processed_at, user_id, contractor_rcv, user_email")
    .eq("status", "qa_review_pending")
    .order("last_processed_at", { ascending: false });

  return <QAReviewQueue initialClaims={claims || []} />;
}
