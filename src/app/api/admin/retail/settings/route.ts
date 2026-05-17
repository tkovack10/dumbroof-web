import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface PriceItem {
  description: string;
  qty?: number;
  unit?: string;
  unit_price: number;
  category?: string;
}

interface RetailSettings {
  price_list: PriceItem[];
  default_tax_rate: number;
  default_deposit_pct: number;
  default_terms: string;
  default_payment_schedule: string;
}

const EMPTY_SETTINGS: RetailSettings = {
  price_list: [],
  default_tax_rate: 0,
  default_deposit_pct: 0,
  default_terms: "",
  default_payment_schedule: "",
};

/**
 * GET /api/admin/retail/settings
 * Returns company_profiles.settings.retail for the caller's profile,
 * normalized so the UI never has to deal with missing fields.
 *
 * PUT /api/admin/retail/settings
 * Body: Partial<RetailSettings>. Stores under settings.retail. Admin-only.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("settings, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  const settings = (profile?.settings ?? {}) as Record<string, unknown>;
  const retail = (settings.retail ?? {}) as Partial<RetailSettings>;

  const merged: RetailSettings = {
    price_list: Array.isArray(retail.price_list) ? retail.price_list : [],
    default_tax_rate:
      typeof retail.default_tax_rate === "number" ? retail.default_tax_rate : 0,
    default_deposit_pct:
      typeof retail.default_deposit_pct === "number"
        ? retail.default_deposit_pct
        : 0,
    default_terms:
      typeof retail.default_terms === "string" ? retail.default_terms : "",
    default_payment_schedule:
      typeof retail.default_payment_schedule === "string"
        ? retail.default_payment_schedule
        : "",
  };

  return NextResponse.json({
    settings: merged,
    can_edit: !!profile?.is_admin,
  });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("settings, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<RetailSettings>;

  // Validate + normalize. QA Phase 4.5 review (post-`70f8719`) findings:
  //   - reject negative qty (would produce credit lines in Richard estimates)
  //   - cap unit_price at $100,000 (typo guard: 52500 vs 525)
  //   - collapse internal whitespace on description so Richard's case-
  //     insensitive lookup ("Laminate shingle" vs "Laminate  shingle") works
  //   - reject malformed price_list payload (string/object) rather than
  //     silently wiping the list to empty
  const UNIT_PRICE_CEILING_DOLLARS = 100_000;
  if (body.price_list !== undefined && !Array.isArray(body.price_list)) {
    return NextResponse.json(
      { error: "price_list must be an array" },
      { status: 400 }
    );
  }
  const cleanPriceList: PriceItem[] = [];
  if (Array.isArray(body.price_list)) {
    for (const raw of body.price_list) {
      const it = raw as Partial<PriceItem>;
      const description = (it.description ?? "")
        .toString()
        .trim()
        .replace(/\s+/g, " ");
      const unit_price = Number(it.unit_price);
      if (
        !description ||
        !Number.isFinite(unit_price) ||
        unit_price < 0 ||
        unit_price > UNIT_PRICE_CEILING_DOLLARS
      ) {
        continue;
      }
      const item: PriceItem = {
        description,
        unit: it.unit ? String(it.unit).toUpperCase().slice(0, 12) : "EA",
        unit_price,
      };
      if (typeof it.qty === "number" && Number.isFinite(it.qty) && it.qty >= 0) {
        item.qty = it.qty;
      }
      if (it.category) item.category = String(it.category).slice(0, 60);
      cleanPriceList.push(item);
    }
  }

  const taxRate = Math.min(
    Math.max(Number(body.default_tax_rate) || 0, 0),
    0.5
  );
  const depositPct = Math.min(
    Math.max(Number(body.default_deposit_pct) || 0, 0),
    100
  );

  const next: RetailSettings = {
    price_list: cleanPriceList,
    default_tax_rate: taxRate,
    default_deposit_pct: depositPct,
    default_terms: (body.default_terms ?? "").toString().slice(0, 4000),
    default_payment_schedule: (body.default_payment_schedule ?? "")
      .toString()
      .slice(0, 4000),
  };

  const existing = (profile.settings ?? {}) as Record<string, unknown>;
  const updatedSettings = { ...existing, retail: next };

  const { error } = await supabaseAdmin
    .from("company_profiles")
    .update({ settings: updatedSettings })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: next });
}

const SUGGESTED_SEED: PriceItem[] = [
  // Roofing
  { description: "Laminate comp shingle (per SQ, installed)", unit: "SQ", unit_price: 525, category: "roofing" },
  { description: "Tear-off comp shingle (per SQ)", unit: "SQ", unit_price: 65, category: "roofing" },
  { description: "Ice & water shield (per SF)", unit: "SF", unit_price: 2.85, category: "roofing" },
  { description: "Synthetic underlayment (per SF)", unit: "SF", unit_price: 0.45, category: "roofing" },
  { description: "Drip edge (per LF)", unit: "LF", unit_price: 3.25, category: "roofing" },
  { description: "Starter strip (per LF)", unit: "LF", unit_price: 2.85, category: "roofing" },
  { description: "Ridge cap (per LF)", unit: "LF", unit_price: 8.5, category: "roofing" },
  { description: "Pipe boot / vent flashing (each)", unit: "EA", unit_price: 75, category: "roofing" },
  { description: "Step flashing (per LF)", unit: "LF", unit_price: 12, category: "roofing" },
  // Gutters
  { description: '5" K-style aluminum gutter (per LF, installed)', unit: "LF", unit_price: 14, category: "gutters" },
  { description: '6" K-style aluminum gutter (per LF, installed)', unit: "LF", unit_price: 17, category: "gutters" },
  { description: '3"x4" aluminum downspout (per LF)', unit: "LF", unit_price: 12, category: "gutters" },
  { description: "Gutter guards (per LF)", unit: "LF", unit_price: 9, category: "gutters" },
  // Siding
  { description: "Vinyl siding (per SQ, installed)", unit: "SQ", unit_price: 425, category: "siding" },
  { description: "House wrap (per SF)", unit: "SF", unit_price: 0.85, category: "siding" },
  { description: "J-channel & trim (per LF)", unit: "LF", unit_price: 4.5, category: "siding" },
  { description: "Window wrap (each)", unit: "EA", unit_price: 85, category: "siding" },
  // Misc / labor
  { description: "Dumpster rental (per haul)", unit: "EA", unit_price: 525, category: "misc" },
  { description: "Permit fee (varies)", unit: "EA", unit_price: 250, category: "misc" },
  { description: "Labor — laborer (per HR)", unit: "HR", unit_price: 65, category: "labor" },
  { description: "Labor — foreman (per HR)", unit: "HR", unit_price: 95, category: "labor" },
];

/**
 * POST /api/admin/retail/settings — seed mode.
 * Body: { mode: 'seed_defaults', force?: boolean }
 *
 * Replaces the price_list with a sensible 21-item starter set. Admin-only.
 * Keeps existing tax / deposit / terms intact.
 *
 * QA Phase 4.5 review fix: by default only seeds when price_list is empty.
 * Pass `force: true` to overwrite a non-empty list (the modal asks for
 * confirmation before sending force). Also snapshots the previous price_list
 * to settings.retail.previous_price_list as a one-step undo.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("settings, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.mode !== "seed_defaults") {
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  }

  const existing = (profile.settings ?? {}) as Record<string, unknown>;
  const existingRetail = (existing.retail ?? {}) as Partial<RetailSettings> & {
    previous_price_list?: PriceItem[];
  };
  const currentList = Array.isArray(existingRetail.price_list)
    ? existingRetail.price_list
    : [];

  if (currentList.length > 0 && !body.force) {
    return NextResponse.json(
      {
        error:
          "price_list is not empty. Pass force:true to overwrite (previous list will be snapshotted to settings.retail.previous_price_list).",
        existing_count: currentList.length,
      },
      { status: 409 }
    );
  }

  const merged: RetailSettings & {
    previous_price_list?: PriceItem[];
  } = {
    ...EMPTY_SETTINGS,
    ...existingRetail,
    price_list: SUGGESTED_SEED,
    // Snapshot whatever was there so an admin can recover from a force=true
    // overwrite. Only set when we actually replaced something.
    ...(currentList.length > 0 ? { previous_price_list: currentList } : {}),
  };

  const { error } = await supabaseAdmin
    .from("company_profiles")
    .update({ settings: { ...existing, retail: merged } })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    settings: merged,
    snapshotted: currentList.length > 0,
  });
}
