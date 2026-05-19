/**
 * Public email domains — users with these domains are treated as solo,
 * not as members of a "company" (so e.g. two unrelated gmail.com users
 * never see each other's claims).
 *
 * Lives in its own leaf module (NO supabase imports) so client components
 * that only need this constant don't transitively pull `supabaseAdmin`
 * into the client bundle. Importing `supabaseAdmin` from a client
 * component throws "supabaseKey is required" at hydration because the
 * service-role key is server-only.
 */
export const PUBLIC_DOMAINS: Set<string> = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "mail.com", "protonmail.com", "zoho.com", "yandex.com",
  "live.com", "msn.com", "comcast.net", "verizon.net", "att.net",
]);
