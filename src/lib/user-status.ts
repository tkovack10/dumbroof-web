import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * True if the user has at least one claim. Single source of truth for the
 * "is this a brand-new user?" check used by the auth callback / confirm
 * redirects and the /welcome guard. Previously each call site re-implemented
 * this count inline, which drifted (the confirm route diverged from callback).
 */
export async function userHasClaims(
  supabase: ServerSupabaseClient,
  userId: string
): Promise<boolean> {
  const { count } = await supabase
    .from("claims")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}
