import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";

export const maxDuration = 300;

const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "ymail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me",
]);

const REQUIRED_FIELDS = ["company_name", "contact_name", "address", "city_state_zip", "phone", "website", "logo_path"] as const;
type Field = typeof REQUIRED_FIELDS[number];

interface IncompleteProfile {
  user_id: string;
  email: string;
  company_name: string | null;
  contact_name: string | null;
  address: string | null;
  city_state_zip: string | null;
  phone: string | null;
  website: string | null;
  logo_path: string | null;
  settings: Record<string, unknown> | null;
  /** True when no company_profiles row existed and we need to INSERT instead of UPDATE. */
  needs_insert?: boolean;
}

interface Extracted {
  company_name?: string;
  contact_name?: string;
  address?: string;
  city_state_zip?: string;
  phone?: string;
  website?: string;
  logo_url?: string;
}

interface RunResult {
  enriched: Array<{ email: string; fields: string[]; logo: boolean; created_row: boolean }>;
  outreach_sent: string[];
  page_ready_sent: string[];
  skipped: Array<{ email: string; reason: string }>;
  errors: Array<{ email: string; error: string }>;
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function findIncompleteProfiles(targetUserIds?: string[]): Promise<IncompleteProfile[]> {
  let query = supabaseAdmin
    .from("company_profiles")
    .select("user_id, email, company_name, contact_name, address, city_state_zip, phone, website, logo_path, settings, created_at")
    .or(REQUIRED_FIELDS.map((f) => `${f}.is.null`).join(","));

  if (targetUserIds && targetUserIds.length > 0) {
    query = query.in("user_id", targetUserIds);
  } else {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", thirtyDaysAgo);
  }

  const { data, error } = await query.limit(50);
  if (error) {
    console.error("[enrich-cron] findIncompleteProfiles error:", error);
    return [];
  }

  // Fill missing emails by joining auth.users (some rows may have NULL email)
  const rows = (data || []) as IncompleteProfile[];
  const needsEmail = rows.filter((r) => !r.email);
  if (needsEmail.length > 0) {
    for (const r of needsEmail) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
      if (u?.user?.email) r.email = u.user.email;
    }
  }
  return rows.filter((r) => r.email);
}

/**
 * Find auth.users with no `company_profiles` row at all. These never made it past signup;
 * their dashboard shows "No company profile". We want to white-glove build the row for them.
 */
async function findRowlessUsers(targetUserIds?: string[], lookbackDays = 60): Promise<IncompleteProfile[]> {
  // Page through auth.users (admin API doesn't filter by created_at server-side; we filter client-side).
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const candidates: Array<{ id: string; email: string }> = [];
  const perPage = 1000;
  let page = 1;
  // Cap pages defensively to avoid runaway loops on a misconfigured project.
  for (; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[enrich-cron] listUsers page", page, "error:", error);
      break;
    }
    const users = data?.users || [];
    if (users.length === 0) break;
    for (const u of users) {
      if (!u.email) continue;
      const created = u.created_at ? Date.parse(u.created_at) : 0;
      if (created < since) continue;
      if (targetUserIds && !targetUserIds.includes(u.id)) continue;
      candidates.push({ id: u.id, email: u.email });
    }
    if (users.length < perPage) break;
  }

  if (candidates.length === 0) return [];

  // Pull existing company_profiles for these user_ids in one query.
  const ids = candidates.map((c) => c.id);
  const { data: existing } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id")
    .in("user_id", ids);
  const haveRow = new Set((existing || []).map((r) => (r as { user_id: string }).user_id));

  const rowless = candidates
    .filter((c) => !haveRow.has(c.id))
    .slice(0, 50)
    .map<IncompleteProfile>((c) => ({
      user_id: c.id,
      email: c.email,
      company_name: null,
      contact_name: null,
      address: null,
      city_state_zip: null,
      phone: null,
      website: null,
      logo_path: null,
      settings: null,
      needs_insert: true,
    }));
  return rowless;
}

async function fetchWebsiteHtml(domain: string): Promise<{ html: string; finalUrl: string } | null> {
  const candidates = [`https://www.${domain}`, `https://${domain}`];
  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("html")) continue;
      const html = (await res.text()).slice(0, 80_000);
      return { html, finalUrl: res.url };
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function extractWithClaude(html: string, knownEmail: string, finalUrl: string): Promise<Extracted | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const system = `You extract contractor business profile fields from website HTML. Output strict JSON only.

Schema:
{
  "company_name": string | null,    // Official business name from <title>, footer, header logo alt
  "contact_name": string | null,    // Owner/CEO/President name if visible
  "address": string | null,         // Street address (just street, not city/state/zip)
  "city_state_zip": string | null,  // "City, ST ZIP" format
  "phone": string | null,           // Primary phone, raw digits or formatted
  "logo_url": string | null         // Absolute URL to company logo image (prefer <img class~="logo">, og:image, apple-touch-icon)
}

Return null for any field you can't find. Don't invent. Resolve relative logo URLs against the page URL.`;

  const userMsg = `Page URL: ${finalUrl}
User email: ${knownEmail}

HTML (truncated):
${html}

Return JSON only.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error("[enrich-cron] Anthropic failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content || []).find((c) => c.type === "text")?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as Extracted;
  } catch (err) {
    console.error("[enrich-cron] extractWithClaude error:", err);
    return null;
  }
}

async function downloadAndStoreLogo(logoUrl: string, userId: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(logoUrl, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200 || buf.length > 5_000_000) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let ext = "png";
    if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
    else if (ct.includes("svg")) ext = "svg";
    else if (ct.includes("webp")) ext = "webp";
    else if (ct.includes("gif")) ext = "gif";
    const path = `${userId}/branding/logo.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from("claim-documents")
      .upload(path, buf, { contentType: ct || "image/png", upsert: true });
    if (error) {
      console.error("[enrich-cron] logo upload failed:", error);
      return null;
    }
    return path;
  } catch (err) {
    console.error("[enrich-cron] downloadAndStoreLogo error:", err);
    return null;
  }
}

function isValidUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return /\./.test(u.hostname) && !/@/.test(u.hostname);
  } catch {
    return false;
  }
}

async function sendPageReadyEmail(profile: IncompleteProfile, website: string | null): Promise<boolean> {
  try {
    const firstName = (profile.contact_name || profile.email.split("@")[0] || "there")
      .split(/\s+/)[0]
      .replace(/[^a-zA-Z]/g, "")
      || "there";
    const websitePhrase = website ? ` from ${website.replace(/^https?:\/\/(www\.)?/, "")}` : "";
    const subject = "Your DumbRoof company page is ready";
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;color:#1a1a2e;line-height:1.55;">
  <p>Hey ${firstName},</p>

  <p>Tom here from DumbRoof. I noticed you signed up but hadn't built out your company profile yet, so my team went ahead and did the white-glove version for you &mdash; we pulled your logo, address, and phone${websitePhrase} and set up your company page so any claim you process from here on out comes out fully branded.</p>

  <p><a href="https://www.dumbroof.ai/dashboard/settings" style="display:inline-block;background:#0d2137;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Review my page &rarr;</a></p>

  <p>Take 30 seconds to fix anything that's off.</p>

  <p>While I have you &mdash; want a 15-min demo so I can show you how to run your first claim? Or if you've already got a scope you're fighting, send it to <a href="mailto:claims@dumbroof.ai">claims@dumbroof.ai</a> and I'll personally walk it through with you.</p>

  <p>Just reply to this email. I read every reply.</p>

  <p>&mdash; Tom<br>CEO, DumbRoof<br>267-679-1504</p>
</div>`;

    const { error } = await getResend().emails.send({
      from: "Tom Kovack <tom@dumbroof.ai>",
      to: [profile.email],
      replyTo: "tom@dumbroof.ai",
      subject,
      html,
    });
    if (error) {
      console.error("[enrich-cron] page-ready send failed:", error);
      return false;
    }

    const newSettings = { ...(profile.settings || {}), profile_ready_email_sent_at: new Date().toISOString() };
    await supabaseAdmin.from("company_profiles").update({ settings: newSettings }).eq("user_id", profile.user_id);
    return true;
  } catch (err) {
    console.error("[enrich-cron] sendPageReadyEmail error:", err);
    return false;
  }
}

async function sendOutreachEmail(profile: IncompleteProfile): Promise<boolean> {
  try {
    const firstName = (profile.contact_name || profile.email.split("@")[0] || "there")
      .split(/\s+/)[0]
      .replace(/[^a-zA-Z]/g, "")
      || "there";
    const subject = "Finish setting up your DumbRoof profile (takes 2 min)";
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;color:#1a1a2e;line-height:1.55;">
  <p>Hey ${firstName},</p>

  <p>Tom here from DumbRoof. I noticed your account is missing some basics — company name, address, logo — which means the PDFs we generate for you come out blank on the header.</p>

  <p>That's a really bad first impression when you send the appeal to a carrier. Two-minute fix:</p>

  <p><a href="https://www.dumbroof.ai/dashboard/settings" style="display:inline-block;background:#0d2137;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Complete my profile →</a></p>

  <p>Specifically, please fill in:</p>
  <ul>
    <li>Company name + your name</li>
    <li>Company address + phone</li>
    <li>Website (if you have one)</li>
    <li>Your logo (drag-and-drop in settings)</li>
  </ul>

  <p>Once that's set, every PDF we generate from your scope going forward will look like it came from your company, not ours.</p>

  <p>Reply to this email if you need a hand — I read every reply.</p>

  <p>— Tom<br>CEO, DumbRoof</p>
</div>`;

    const { error } = await getResend().emails.send({
      from: "Tom Kovack <tom@dumbroof.ai>",
      to: [profile.email],
      replyTo: "tom@dumbroof.ai",
      subject,
      html,
    });
    if (error) {
      console.error("[enrich-cron] outreach send failed:", error);
      return false;
    }

    const newSettings = { ...(profile.settings || {}), profile_outreach_sent_at: new Date().toISOString() };
    await supabaseAdmin.from("company_profiles").update({ settings: newSettings }).eq("user_id", profile.user_id);
    return true;
  } catch (err) {
    console.error("[enrich-cron] sendOutreachEmail error:", err);
    return false;
  }
}

async function enrichOne(profile: IncompleteProfile, result: RunResult): Promise<void> {
  const domain = (profile.email.split("@")[1] || "").toLowerCase();
  if (!domain) {
    result.skipped.push({ email: profile.email, reason: "no domain" });
    return;
  }

  if (CONSUMER_DOMAINS.has(domain)) {
    const alreadySent = (profile.settings as { profile_outreach_sent_at?: string } | null)?.profile_outreach_sent_at;
    if (alreadySent) {
      result.skipped.push({ email: profile.email, reason: "outreach already sent" });
      return;
    }
    // For rowless users we must INSERT a stub row first so sendOutreachEmail's UPDATE of
    // settings.profile_outreach_sent_at lands somewhere.
    if (profile.needs_insert) {
      const { error: insErr } = await supabaseAdmin.from("company_profiles").insert({
        user_id: profile.user_id,
        email: profile.email,
      });
      if (insErr) {
        result.errors.push({ email: profile.email, error: `stub insert failed: ${insErr.message}` });
        return;
      }
    }
    const ok = await sendOutreachEmail(profile);
    if (ok) result.outreach_sent.push(profile.email);
    else result.errors.push({ email: profile.email, error: "outreach send failed" });
    return;
  }

  // Org-domain path
  const fetched = await fetchWebsiteHtml(domain);
  if (!fetched) {
    result.skipped.push({ email: profile.email, reason: `website unreachable at ${domain}` });
    return;
  }
  const extracted = await extractWithClaude(fetched.html, profile.email, fetched.finalUrl);
  if (!extracted) {
    result.skipped.push({ email: profile.email, reason: "extraction returned nothing" });
    return;
  }

  const updates: Partial<Record<Field, string>> = {};
  const filled: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    if (f === "logo_path") continue;
    if (!profile[f] && extracted[f as keyof Extracted]) {
      let value = String(extracted[f as keyof Extracted]).trim();
      if (f === "website") {
        if (!isValidUrl(value)) continue;
        if (!value.startsWith("http")) value = `https://${value}`;
      }
      updates[f] = value;
      filled.push(f);
    }
  }
  if (!profile.website && !updates.website) {
    updates.website = `https://www.${domain}`;
    filled.push("website");
  }

  let logoFilled = false;
  if (!profile.logo_path && extracted.logo_url) {
    let logoUrl = extracted.logo_url;
    if (!logoUrl.startsWith("http")) {
      try {
        logoUrl = new URL(logoUrl, fetched.finalUrl).toString();
      } catch {
        logoUrl = "";
      }
    }
    if (logoUrl) {
      const path = await downloadAndStoreLogo(logoUrl, profile.user_id);
      if (path) {
        updates.logo_path = path;
        logoFilled = true;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    result.skipped.push({ email: profile.email, reason: "nothing new to fill" });
    return;
  }

  let dbErr: { message: string } | null = null;
  if (profile.needs_insert) {
    const { error } = await supabaseAdmin
      .from("company_profiles")
      .insert({ user_id: profile.user_id, email: profile.email, ...updates });
    dbErr = error;
  } else {
    const { error } = await supabaseAdmin
      .from("company_profiles")
      .update(updates)
      .eq("user_id", profile.user_id);
    dbErr = error;
  }

  if (dbErr) {
    result.errors.push({ email: profile.email, error: dbErr.message });
    return;
  }

  result.enriched.push({
    email: profile.email,
    fields: filled,
    logo: logoFilled,
    created_row: !!profile.needs_insert,
  });

  // Page-ready outreach: only for newly-created rows (white-glove signups) and only once.
  if (profile.needs_insert) {
    const ok = await sendPageReadyEmail(profile, updates.website || null);
    if (ok) result.page_ready_sent.push(profile.email);
    else result.errors.push({ email: profile.email, error: "page-ready send failed" });
  }
}

async function sendInternalSummary(result: RunResult): Promise<void> {
  if (
    result.enriched.length === 0 &&
    result.outreach_sent.length === 0 &&
    result.page_ready_sent.length === 0 &&
    result.errors.length === 0
  ) return;
  try {
    const rows = (label: string, items: unknown[]) => `<h3>${label} (${items.length})</h3><pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${JSON.stringify(items, null, 2)}</pre>`;
    const html = `<div style="font-family:-apple-system,sans-serif;max-width:720px;">
  <h2>Profile enrichment run — ${new Date().toISOString().split("T")[0]}</h2>
  ${rows("✅ Enriched", result.enriched)}
  ${rows("🎁 Page-ready emails sent", result.page_ready_sent)}
  ${rows("📨 Outreach sent (self-serve)", result.outreach_sent)}
  ${rows("⏭️ Skipped", result.skipped)}
  ${rows("❌ Errors", result.errors)}
</div>`;
    await getResend().emails.send({
      from: "DumbRoof System <tom@dumbroof.ai>",
      to: ["tom@dumbroof.ai"],
      subject: `Profile enrichment: ${result.enriched.length} enriched, ${result.page_ready_sent.length} page-ready, ${result.outreach_sent.length} self-serve`,
      html,
    });
  } catch (err) {
    console.error("[enrich-cron] summary email failed:", err);
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Admin can target specific user_ids via ?user_ids=a,b,c (skips the 30-day filter)
  const url = new URL(req.url);
  const userIdsParam = url.searchParams.get("user_ids");
  const targetUserIds = userIdsParam ? userIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const [incomplete, rowless] = await Promise.all([
    findIncompleteProfiles(targetUserIds),
    findRowlessUsers(targetUserIds),
  ]);
  // Deduplicate by user_id in case the same user somehow appears in both buckets
  // (e.g., a row was created between the two queries by a concurrent signup).
  const seen = new Set<string>();
  const profiles: IncompleteProfile[] = [];
  for (const p of [...incomplete, ...rowless]) {
    if (seen.has(p.user_id)) continue;
    seen.add(p.user_id);
    profiles.push(p);
  }

  const result: RunResult = { enriched: [], outreach_sent: [], page_ready_sent: [], skipped: [], errors: [] };

  for (const profile of profiles) {
    try {
      await enrichOne(profile, result);
    } catch (err) {
      result.errors.push({ email: profile.email, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await sendInternalSummary(result);

  return NextResponse.json({
    processed: profiles.length,
    enriched: result.enriched.length,
    outreach_sent: result.outreach_sent.length,
    page_ready_sent: result.page_ready_sent.length,
    skipped: result.skipped.length,
    errors: result.errors.length,
    detail: result,
  });
}
