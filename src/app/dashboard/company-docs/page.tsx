import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompanyDocsClient } from "./company-docs-client";

export default async function CompanyDocsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <CompanyDocsClient />;
}
