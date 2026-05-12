/**
 * Per-user UI version flag for the per-claim page redesign.
 *
 * Resolution order (first match wins):
 *   1. URL search param `?ui=v1|v2` — ephemeral, NOT persisted to user metadata.
 *      Used for instant testing / side-by-side comparison + as a support
 *      escape hatch.
 *   2. Supabase `auth.users.user_metadata.ui_version` — persistent preference,
 *      written by the toggle in /dashboard/settings.
 *   3. Default: `"v2"` (changed from `"v1"` 2026-05-12 — Tom called the
 *      switchover to gather analytics + feedback while v1 stays as an
 *      escape valve for any user who explicitly opts back).
 *
 * No new tables / migrations — uses Supabase user_metadata which is already
 * an open JSONB column writable by the user via supabase.auth.updateUser().
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
 * authenticated user (or null if not yet loaded). Returns "v2" when both
 * sources are absent or invalid (default flipped from v1 2026-05-12).
 */
export function resolveUiVersion(
  urlParam: string | null | undefined,
  user: User | null | undefined,
): UiVersion {
  const fromUrl = parseVersion(urlParam);
  if (fromUrl) return fromUrl;

  const fromMetadata = parseVersion(user?.user_metadata?.ui_version as string | undefined);
  if (fromMetadata) return fromMetadata;

  return "v2";
}

/**
 * Whether the toggle should be visible to this user.
 * GA as of 2026-05-12 — every authenticated user can switch between v1 / v2
 * via /dashboard/settings. Previously gated to admin emails only during the
 * Phase 2 development window.
 */
export function canSeeUiVersionToggle(user: User | null | undefined): boolean {
  return !!user;
}
