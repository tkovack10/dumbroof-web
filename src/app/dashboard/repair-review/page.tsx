import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RepairReviewContent } from "./repair-review-content";

export default async function RepairReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <RepairReviewContent />;
}
