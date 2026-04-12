import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { extractUtmFromUrl, serializeUtm, UTM_COOKIE, UTM_MAX_AGE } from "@/lib/utm";

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

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
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
