import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScopeReviewContent } from "./scope-review-content";

export default async function ScopeReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <ScopeReviewContent />;
}
