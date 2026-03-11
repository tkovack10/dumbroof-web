import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PhotoReviewContent } from "./photo-review-content";

export default async function PhotoReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <PhotoReviewContent userId={user.id} />;
}
