import { headers } from "next/headers";

export type InAppName = "instagram" | "facebook" | "tiktok" | "linkedin" | "twitter" | null;

export type DeviceContext = {
  isMobile: boolean;
  isInAppBrowser: boolean;
  inAppName: InAppName;
  os: "ios" | "android" | "other";
  ua: string;
};

/**
 * Server-side device detection from User-Agent header.
 * Used by `app/page.tsx` and landing pages to render a mobile-first hero
 * for users coming from Instagram/Facebook/TikTok in-app browsers, where
 * file uploads and OAuth cookie persistence are unreliable.
 *
 * Anchor: see USARM-Claims-Platform funnel investigation 2026-04-06.
 */
export async function getDeviceContext(): Promise<DeviceContext> {
  const ua = (await headers()).get("user-agent") || "";

  const isInstagram = /Instagram/i.test(ua);
  const isFacebook = /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua);
  const isTikTok = /TikTok|musical_ly|Bytedance/i.test(ua);
  const isLinkedIn = /LinkedInApp/i.test(ua);
  const isTwitter = /Twitter/i.test(ua);
  const isAndroidWebView = /; wv\)/i.test(ua);

  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isAndroid || isIOS || /Mobile/i.test(ua);

  const inAppName: InAppName = isInstagram
    ? "instagram"
    : isFacebook
    ? "facebook"
    : isTikTok
    ? "tiktok"
    : isLinkedIn
    ? "linkedin"
    : isTwitter
    ? "twitter"
    : null;

  const isInAppBrowser =
    inAppName !== null || (isMobile && isAndroidWebView);

  const os: DeviceContext["os"] = isIOS ? "ios" : isAndroid ? "android" : "other";

  return { isMobile, isInAppBrowser, inAppName, os, ua };
}

/**
 * Friendly label for the in-app browser source — used in mobile hero copy.
 * Returns null if not from a known social app.
 */
export function inAppBrowserLabel(name: InAppName): string | null {
  if (!name) return null;
  const map: Record<NonNullable<InAppName>, string> = {
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    linkedin: "LinkedIn",
    twitter: "X",
  };
  return map[name];
}
