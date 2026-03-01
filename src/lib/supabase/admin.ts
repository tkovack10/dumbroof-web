import { createClient } from "@supabase/supabase-js";

// Server-side admin client using service role key — bypasses RLS
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);
