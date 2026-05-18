import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users away from protected routes
  if (
    !user &&
    request.nextUrl.pathname.startsWith("/dashboard")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Required-profile gate. Any authenticated user whose company_profiles row
  // is missing OR has no company_name AND no company_id (i.e. not part of an
  // invited team) gets bounced to /onboarding/profile. The current path is
  // carried as `?next=` so we land them where they were going after the
  // profile is filled.
  //
  // Why: brand-new signups via /instant-supplement (and any other path)
  // were producing PDFs branded as "Your Roofing Company" because the funnel
  // never asked for the contractor's company name + logo. Tom's call
  // 2026-05-10: gate AFTER files drop (sunk-cost commitment carries them
  // through the form) rather than before, so we don't lose people up-front.
  //
  // We run the gate on /dashboard/* AND /instant/continue. The latter is
  // critical: /instant/continue is the post-signup handoff that creates the
  // real claim row, and we need the company_profiles row to exist BEFORE the
  // claim is created so the processor brands PDFs correctly on the first
  // run (rather than baking in the "Your Roofing Company" placeholder and
  // requiring a reprocess later).
  const isInstantContinue = request.nextUrl.pathname === "/instant/continue";
  const requiresProfile =
    request.nextUrl.pathname.startsWith("/dashboard") || isInstantContinue;
  if (user && requiresProfile) {
    try {
      // /instant/continue is the post-signup handoff that's about to create
      // the user's FIRST claim — we want the full required set populated so
      // PDF 1 ships fully branded. /dashboard/* uses the looser company_name
      // check (existing users with partial profiles shouldn't get locked out
      // of their existing claims). The /dashboard/new-claim submit form has
      // its own CompanyProfileGate modal that enforces the strict set at
      // claim-submit time.
      const select = isInstantContinue
        ? "company_name, company_id, contact_name, phone, address, city_state_zip, logo_path"
        : "company_name, company_id";
      const { data: profile } = await supabase
        .from("company_profiles")
        .select(select)
        .eq("user_id", user.id)
        .maybeSingle<{
          company_name?: string | null;
          company_id?: string | null;
          contact_name?: string | null;
          phone?: string | null;
          address?: string | null;
          city_state_zip?: string | null;
          logo_path?: string | null;
        }>();
      const hasName = !!(profile?.company_name && profile.company_name.trim().length > 1);
      const isInvitedTeamMember = !!profile?.company_id;
      const profileComplete = isInstantContinue
        ? hasName &&
          !!(profile?.contact_name && profile.contact_name.trim().length > 1) &&
          !!(profile?.phone && profile.phone.replace(/\D/g, "").length >= 10) &&
          !!(profile?.address && profile.address.trim().length > 1) &&
          !!(profile?.city_state_zip && profile.city_state_zip.trim().length > 1) &&
          !!profile?.logo_path
        : hasName;
      if (!profileComplete && !isInvitedTeamMember) {
        const url = request.nextUrl.clone();
        url.pathname = "/onboarding/profile";
        url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
        return NextResponse.redirect(url);
      }
    } catch {
      // Soft-fail — never block the user behind a Supabase outage.
      // The PDFs will fall through to the placeholder; that's worse UX
      // than today, but better than locking the user out of the dashboard.
    }
  }

  return supabaseResponse;
}
