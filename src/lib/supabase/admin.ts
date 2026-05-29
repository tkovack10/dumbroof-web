import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side admin client using service role key — bypasses RLS.
// NEVER import this module (directly or transitively) from a client
// component — it bundles into the browser and throws "supabaseKey is
// required" at hydration. Re-export server-only constants from leaf
// modules (see `@/lib/public-domains` for an example).
//
// Lazily initialized via a Proxy: createClient() runs on first PROPERTY
// ACCESS (a real request), not at module load. Without this, `next build`
// page-data collection evaluates this module with absent env vars and throws
// "supabaseUrl is required", failing the build and reddening every Vercel
// preview check. At runtime in prod the env is present, so the first
// .from()/.auth/.storage/.rpc call constructs the client fine. Callers are
// unchanged — `supabaseAdmin.from(...)` etc. all still work.
let _client: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error(
        "supabaseAdmin: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set"
      );
    }
    _client = createClient(url, key);
  }
  return _client;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getAdminClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
