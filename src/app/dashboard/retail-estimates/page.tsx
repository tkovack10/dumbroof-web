import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetailEstimatesList } from "./retail-estimates-list";

export default async function RetailEstimatesListPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <RetailEstimatesList />;
}
