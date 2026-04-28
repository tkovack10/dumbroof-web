import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendCAPIEvent } from "@/lib/meta-capi";

// Public endpoint — accepts an anonymous file upload from the /instant-* funnels
// BEFORE the user has signed up. Stores under a UUID-prefixed anonymous path,
// drops a 24h httpOnly cookie so the post-signup /instant/continue handler can
// claim the files into a real claim record.
//
// The whole point of the funnel: ask for the artifact (PDF / photos) before the
// email. Once they upload, sunk cost commits them to the auth wall.

const COOKIE_TOKEN = "dr_instant_token";
const COOKIE_FUNNEL = "dr_instant_funnel";
const COOKIE_DOL = "dr_instant_dol";
const COOKIE_DAMAGE = "dr_instant_damage_type";
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24h

const ANON_PREFIX = "anon-instant-intake";

const VALID_DAMAGE_TYPES = new Set(["hail", "wind", "combined"]);

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
}

const VALID_FUNNELS = new Set(["forensic", "supplement"]);
const VALID_FOLDERS = new Set(["photos", "measurements", "scope"]);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const funnel = formData.get("funnel");
    const folder = formData.get("folder");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (typeof funnel !== "string" || !VALID_FUNNELS.has(funnel)) {
      return NextResponse.json({ error: "Invalid funnel" }, { status: 400 });
    }
    if (typeof folder !== "string" || !VALID_FOLDERS.has(folder)) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }
    // 50MB cap per file — carrier scope PDFs are <10MB, EagleViews <5MB.
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 50MB" }, { status: 413 });
    }

    // Reuse an existing token if the user has uploaded a previous file in this
    // session — keeps multi-file uploads (supplement = measurement + scope) under
    // the same anon directory.
    const jar = await cookies();
    const existingToken = jar.get(COOKIE_TOKEN)?.value;
    const existingFunnel = jar.get(COOKIE_FUNNEL)?.value;
    const token =
      existingToken && existingFunnel === funnel
        ? existingToken
        : randomUUID();

    const safeName = sanitizeFileName(file.name);
    const path = `${ANON_PREFIX}/${token}/${folder}/${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: storageError } = await supabaseAdmin.storage
      .from("claim-documents")
      .upload(path, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });

    if (storageError) {
      return NextResponse.json({ error: storageError.message }, { status: 500 });
    }

    const baseCookieOpts = {
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
    };
    jar.set(COOKIE_TOKEN, token, baseCookieOpts);
    jar.set(COOKIE_FUNNEL, funnel, baseCookieOpts);

    // Forensic-only metadata: forwarded from the form fields above the drop
    // zone. Validated then stashed in cookies so /api/instant-intake/claim can
    // populate the new claim row's date_of_loss + estimate_request.damage_type.
    const dol = formData.get("dol");
    if (typeof dol === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dol)) {
      jar.set(COOKIE_DOL, dol, baseCookieOpts);
    }
    const damageType = formData.get("damage_type");
    if (typeof damageType === "string" && VALID_DAMAGE_TYPES.has(damageType)) {
      jar.set(COOKIE_DAMAGE, damageType, baseCookieOpts);
    }

    // Server-side Meta CAPI Upload event. iOS 14+ blocks the browser pixel for
    // ~25-40% of users, so CAPI catches what the pixel misses. The client also
    // fires `fbq("track", "Upload", ..., { eventID })` with the same eventId
    // returned here so Meta dedupes them into one canonical event.
    const ua = request.headers.get("user-agent") || undefined;
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      undefined;
    const eventId = `instant_upload_${token}_${Date.now()}`;
    sendCAPIEvent({
      eventName: "Upload",
      eventSourceUrl: request.headers.get("referer") || undefined,
      userData: { clientUserAgent: ua, clientIpAddress: ip },
      customData: { funnel, folder, filename: safeName },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      token,
      funnel,
      folder,
      filename: safeName,
      eventId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
