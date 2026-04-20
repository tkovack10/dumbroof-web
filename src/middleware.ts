import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { extractUtmFromUrl, serializeUtm, UTM_COOKIE, UTM_MAX_AGE } from "@/lib/utm";

// 24h — short enough to limit cross-user contamination on shared browsers
const ONE_DAY = 60 * 60 * 24;

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);

  // Capture UTM params + click IDs on first visit from ads.
  // Only set the cookie if UTM params are present AND the cookie doesn't
  // already exist (first-touch attribution — don't overwrite).
  const hasUtmCookie = request.cookies.has(UTM_COOKIE);
  if (!hasUtmCookie) {
    const utmData = extractUtmFromUrl(request.nextUrl);
    if (utmData) {
      response.cookies.set(UTM_COOKIE, serializeUtm(utmData), {
        path: "/",
        maxAge: UTM_MAX_AGE,
        httpOnly: false, // Readable by client JS for passing to API calls
        secure: true,
        sameSite: "lax",
      });
    }
  }

  // Referral + invite cookie capture — proper Next.js 15 pattern
  // (Server Component pages can't reliably set cookies around redirects).
  const pathname = request.nextUrl.pathname;
  const url = request.nextUrl;

  // /r/[code] — capture ref code from URL segment
  const refMatch = pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  if (refMatch) {
    response.cookies.set("dr_ref", refMatch[1].toUpperCase(), {
      path: "/", maxAge: ONE_DAY, httpOnly: true, secure: true, sameSite: "lax",
    });
  }

  // /signup?ref= or ?invite= — capture for auth-callback finalization
  if (pathname === "/signup") {
    const refParam = url.searchParams.get("ref");
    const inviteParam = url.searchParams.get("invite");
    if (refParam) {
      response.cookies.set("dr_ref", refParam.toUpperCase(), {
        path: "/", maxAge: ONE_DAY, httpOnly: true, secure: true, sameSite: "lax",
      });
    }
    if (inviteParam) {
      response.cookies.set("dr_invite", inviteParam, {
        path: "/", maxAge: ONE_DAY, httpOnly: true, secure: true, sameSite: "lax",
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
    "/signup",
    "/r/:path*",
    // Capture UTM params on landing pages from ads
    "/",
    "/pricing",
    "/learn/:path*",
    "/sample/:path*",
    "/inspection-club",
    "/pa-club",
    "/integrations",
  ],
};
