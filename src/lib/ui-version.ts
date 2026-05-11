/**
 * Per-user UI version flag for the per-claim page redesign.
 *
 * Resolution order (first match wins):
 *   1. URL search param `?ui=v1|v2` — ephemeral, NOT persisted to user metadata.
 *      Used for instant testing / side-by-side comparison without polluting
 *      a saved preference.
 *   2. Supabase `auth.users.user_metadata.ui_version` — persistent preference,
 *      written by the toggle in /dashboard/settings.
 *   3. Default: `"v1"`.
 *
 * No new tables / migrations — uses Supabase user_metadata which is already
 * an open JSONB column writable by the user via supabase.auth.updateUser().
 *
 * The Phase 2 redesign (tabs + inspector + sticky highlights) is gated on
 * v2; v1 keeps the existing scrolling layout entirely unchanged.
 */

import type { User } from "@supabase/supabase-js";

export type UiVersion = "v1" | "v2";

const VALID_VERSIONS: ReadonlySet<UiVersion> = new Set(["v1", "v2"]);

function parseVersion(raw: string | null | undefined): UiVersion | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  return VALID_VERSIONS.has(v as UiVersion) ? (v as UiVersion) : null;
}

/**
 * Resolve the active UI version. Pass the URL query param value and the
 * authenticated user (or null if not yet loaded). Returns "v1" when both
 * sources are absent or invalid.
 */
export function resolveUiVersion(
  urlParam: string | null | undefined,
  user: User | null | undefined,
): UiVersion {
  const fromUrl = parseVersion(urlParam);
  if (fromUrl) return fromUrl;

  const fromMetadata = parseVersion(user?.user_metadata?.ui_version as string | undefined);
  if (fromMetadata) return fromMetadata;

  return "v1";
}

/**
 * Whether the toggle should be visible to this user. During Phase 2 development
 * the toggle is gated to admins only — once Tom signs off on v2 we drop the
 * gate and surface it to everyone.
 */
const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  "tkovack@usaroofmasters.com",
  "tom@dumbroof.ai",
]);

export function canSeeUiVersionToggle(user: User | null | undefined): boolean {
  if (!user?.email) return false;
  return ADMIN_EMAILS.has(user.email.toLowerCase());
}
