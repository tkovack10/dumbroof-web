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

  // Broader filter than just status='qa_review_pending'. The canonical signal
  // is "claim has unreviewed critical QA flags" — status alone is unreliable:
  //   - Reprocess after QA-block flips status back to 'processing' for ~90s;
  //     during that window the email was already sent but the claim is gone
  //     from a status-only query.
  //   - Crashes after a QA block can leave status='error' with the critical
  //     flags still set.
  // So: pull anything with critical flags that has NOT been explicitly
  // released by an admin. Released claims have qa_audit_flags.released_at
  // set by /api/admin/qa-review/[id]/release.
  const { data: rawClaims, error } = await supabaseAdmin
    .from("claims")
    .select("id, slug, address, carrier, status, qa_audit_flags, last_processed_at, user_id, contractor_rcv")
    .not("qa_audit_flags", "is", null)
    .order("last_processed_at", { ascending: false });

  if (error) {
    console.error("[qa-review] fetch error:", error);
  }

  // Server-side filter — PostgREST jsonb-array-length filters are awkward,
  // and the qa_audit_flags shape is well under 1000 claims, so just filter
  // in JS. Cheaper than a custom RPC.
  const claims = (rawClaims || []).filter((c) => {
    const flags = (c.qa_audit_flags || {}) as {
      critical?: unknown[];
      released_at?: string;
    };
    const hasCritical = Array.isArray(flags.critical) && flags.critical.length > 0;
    const wasReleased = !!flags.released_at;
    return hasCritical && !wasReleased;
  });

  return <QAReviewQueue initialClaims={claims} />;
}
