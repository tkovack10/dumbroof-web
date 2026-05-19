import { createClient } from "@supabase/supabase-js";

// Server-side admin client using service role key — bypasses RLS.
// NEVER import this module (directly or transitively) from a client
// component — it bundles into the browser and throws "supabaseKey is
// required" at hydration. Re-export server-only constants from leaf
// modules (see `@/lib/public-domains` for an example).
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
