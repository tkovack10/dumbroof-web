/**
 * Per-company attachment resolution for homeowner engagement emails.
 *
 * A template's `email_templates.default_attachments` is a GLOBAL list of
 * marketing_assets uuids — fine for the manufacturer-seeded sample books
 * (company_id IS NULL, shared by everyone). But company-private assets
 * (USARM's "About Us" PDF, FAQs, before/after galleries) live in
 * marketing_assets rows scoped by company_id. Attaching one company's
 * private asset to another company's homeowner is a data leak (the exact
 * class the 20260524 marketing_assets company-scope migration fixed for
 * the admin UI).
 *
 * This module resolves the right attachments for a given (template slug,
 * company_id) pair WITHOUT trusting the global default_attachments ids to
 * be company-correct:
 *
 *   1. Start from the template's default_attachments, but re-fetch each
 *      asset and keep ONLY rows that are global (company_id IS NULL) OR
 *      owned by this company. A foreign company's asset id is dropped.
 *   2. Layer in category/slug-based, company-scoped extras keyed off the
 *      template slug (e.g. welcome -> About-Us; sample books -> shingle
 *      samples; nearby jobs -> before/after gallery). For each desired
 *      category we prefer the COMPANY-private asset, falling back to a
 *      GLOBAL one of the same category when the company hasn't uploaded
 *      its own.
 *   3. Skip any asset whose file_path is null (file not uploaded yet —
 *      e.g. the seeded Owens Corning rows). The email still sends.
 *
 * Downloads come from the `marketing-assets` storage bucket, mirroring
 * the existing send-now route.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ResolvedAttachment {
  filename: string;
  content: Buffer;
}

interface AssetRow {
  id: string;
  slug: string;
  title: string | null;
  category: string | null;
  file_path: string | null;
  mime_type: string | null;
  company_id: string | null;
}

const ASSET_SELECT = "id, slug, title, category, file_path, mime_type, company_id";

/**
 * Per-template-slug recipe: which marketing_assets CATEGORIES this step
 * should try to attach beyond the template's own default_attachments.
 * Categories are resolved company-scoped (company asset preferred, else
 * a global asset of that category). Unknown slugs fall through to just
 * the (company-filtered) default_attachments.
 *
 * Category values come from marketing_assets.category:
 *   shingle_sample | siding_sample | faq | what_to_expect | nearby_jobs | other
 */
const SLUG_CATEGORY_RECIPE: Record<string, string[]> = {
  welcome_what_to_expect: ["what_to_expect", "faq"],
  adjuster_meeting_prep: ["what_to_expect"],
  sample_books_pick_colors: ["shingle_sample"],
  nearby_jobs_showcase: ["nearby_jobs"],
  adjuster_status_checkin: [],
  scope_status_checkin: [],
  first_check_guidance: ["faq"],
};

/** How many same-category assets to attach (avoid 30-shingle-book emails). */
const MAX_PER_CATEGORY = 4;

function extForMime(mime: string | null | undefined): string {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return "";
}

/** True when the asset is usable by this company (global or owned by it). */
function visibleToCompany(asset: AssetRow, companyId: string | null): boolean {
  return asset.company_id === null || (companyId != null && asset.company_id === companyId);
}

/**
 * Resolve marketing_assets file_paths for one homeowner email, scoped to a
 * company. Returns deduped asset rows that have a non-null file_path and are
 * visible to the company. Does NOT download — see resolveCompanyAttachments
 * for the download step.
 */
export async function resolveCompanyAssetRows(
  templateSlug: string,
  defaultAttachmentIds: string[],
  companyId: string | null,
): Promise<AssetRow[]> {
  const chosen = new Map<string, AssetRow>(); // dedupe by asset id

  // ---- 1) Company-filtered default_attachments -----------------------------
  if (defaultAttachmentIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("marketing_assets")
      .select(ASSET_SELECT)
      .in("id", defaultAttachmentIds)
      .eq("active", true);
    if (error) {
      console.warn(`[homeowner-attachments] default_attachments lookup failed:`, error.message);
    }
    for (const a of (data || []) as AssetRow[]) {
      if (!visibleToCompany(a, companyId)) continue; // never leak cross-company
      if (!a.file_path) continue; // file not uploaded yet — skip gracefully
      chosen.set(a.id, a);
    }
  }

  // ---- 2) Category-based, company-scoped extras ----------------------------
  const categories = SLUG_CATEGORY_RECIPE[templateSlug] ?? [];
  for (const category of categories) {
    // Pull both global + this company's assets in the category, prefer company.
    const orFilter =
      companyId != null
        ? `company_id.is.null,company_id.eq.${companyId}`
        : `company_id.is.null`;
    const { data, error } = await supabaseAdmin
      .from("marketing_assets")
      .select(ASSET_SELECT)
      .eq("category", category)
      .eq("active", true)
      .or(orFilter)
      .order("sort_order", { ascending: true });
    if (error) {
      console.warn(`[homeowner-attachments] category '${category}' lookup failed:`, error.message);
      continue;
    }
    const rows = ((data || []) as AssetRow[]).filter(
      (a) => visibleToCompany(a, companyId) && a.file_path,
    );
    // Company-private first, then global; cap per category.
    rows.sort((a, b) => {
      const aCompany = a.company_id === companyId ? 0 : 1;
      const bCompany = b.company_id === companyId ? 0 : 1;
      return aCompany - bCompany;
    });
    let added = 0;
    for (const a of rows) {
      if (added >= MAX_PER_CATEGORY) break;
      if (chosen.has(a.id)) continue;
      chosen.set(a.id, a);
      added++;
    }
  }

  return Array.from(chosen.values());
}

/**
 * Resolve + download attachments for a homeowner email, company-scoped.
 * Returns ready-to-send { filename, content } objects. Assets whose file
 * fails to download (or is null) are skipped — the email still sends.
 */
export async function resolveCompanyAttachments(
  templateSlug: string,
  defaultAttachmentIds: string[],
  companyId: string | null,
): Promise<{ attachments: ResolvedAttachment[]; assetSlugs: string[] }> {
  const rows = await resolveCompanyAssetRows(templateSlug, defaultAttachmentIds, companyId);
  const attachments: ResolvedAttachment[] = [];
  const assetSlugs: string[] = [];

  for (const asset of rows) {
    if (!asset.file_path) continue;
    try {
      const { data: file } = await supabaseAdmin.storage
        .from("marketing-assets")
        .download(asset.file_path);
      if (!file) {
        console.warn(`[homeowner-attachments] empty download for ${asset.slug} (${asset.file_path})`);
        continue;
      }
      const buf = Buffer.from(await file.arrayBuffer());
      attachments.push({
        filename: `${asset.slug}${extForMime(asset.mime_type)}`,
        content: buf,
      });
      assetSlugs.push(asset.slug);
    } catch (e) {
      console.warn(`[homeowner-attachments] download failed for ${asset.slug}:`, e);
    }
  }

  return { attachments, assetSlugs };
}
