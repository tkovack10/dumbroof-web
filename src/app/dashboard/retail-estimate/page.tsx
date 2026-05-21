import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetailEstimateClient } from "./retail-estimate-client";

export default async function RetailEstimatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <RetailEstimateClient />;
}
